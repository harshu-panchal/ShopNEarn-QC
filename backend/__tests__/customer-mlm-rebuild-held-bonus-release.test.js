/**
 * Customer-MLM-rebuild Phase 12 — Held pair-bonus release acceptance.
 *
 * Verifies the invariant: when a previously REGISTERED_UNPAID member
 * activates their joining payment, every
 * `HELD_AWAITING_DOWNLINE_ACTIVATION` `MlmCommissionEvent` whose
 * `sourceUserId` is that member is:
 *
 *   1. Credited to the sponsor's earnings (`pending` bucket) via the
 *      finance ledger.
 *   2. Flipped to `status: CREDITED`.
 *   3. Drained from the activating member's `heldPairBonusForSponsor`
 *      counter back to zero.
 *
 * This is the exact contract the customer-facing Matching Report and
 * the admin held-bonus panel rely on.
 */
import { jest } from "@jest/globals";

const mockEventFind = jest.fn();
const mockEventFindOne = jest.fn();
const mockMembershipFindOne = jest.fn();
const mockMembershipUpdateOne = jest.fn();
const mockGetMembershipByUserId = jest.fn();
const mockRecordLifetimeEarning = jest.fn();
const mockCreditWallet = jest.fn();
const mockGetPlanAPairBonusForPairIndex = jest.fn();
const mockGetMlmConfig = jest.fn();
const mockGetDirectReferralMilestoneBonus = jest.fn();
const mockGetMentorRoyaltyRate = jest.fn();
const mockGetRepurchaseBonusRate = jest.fn();
const mockGetUplineChain = jest.fn();

jest.unstable_mockModule("../app/models/mlmCommissionEvent.js", () => {
  function CommissionEventMock() {}
  CommissionEventMock.find = mockEventFind;
  CommissionEventMock.findOne = mockEventFindOne;
  CommissionEventMock.create = jest.fn();
  CommissionEventMock.updateOne = jest.fn();
  return { default: CommissionEventMock };
});

jest.unstable_mockModule("../app/models/mlmMembership.js", () => {
  function MembershipMock() {}
  MembershipMock.findOne = mockMembershipFindOne;
  MembershipMock.find = jest.fn();
  MembershipMock.updateOne = mockMembershipUpdateOne;
  MembershipMock.create = jest.fn();
  return { default: MembershipMock };
});

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: { find: jest.fn(), findOne: jest.fn() },
}));

jest.unstable_mockModule("../app/services/finance/walletService.js", () => ({
  creditWallet: mockCreditWallet,
}));

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: mockGetMlmConfig,
  getPlanAPairBonusForPairIndex: mockGetPlanAPairBonusForPairIndex,
  getDirectReferralMilestoneBonus: mockGetDirectReferralMilestoneBonus,
  getMentorRoyaltyRate: mockGetMentorRoyaltyRate,
  getRepurchaseBonusRate: mockGetRepurchaseBonusRate,
}));

jest.unstable_mockModule("../app/services/mlm/mlmMembershipService.js", () => ({
  getMembershipByUserId: mockGetMembershipByUserId,
  getUplineChain: mockGetUplineChain,
  recordLifetimeEarning: mockRecordLifetimeEarning,
}));

const { releaseHeldPairBonusesForDownlineActivation } = await import(
  "../app/services/mlm/mlmBonusEngineService.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMlmConfig.mockResolvedValue({});
  mockCreditWallet.mockResolvedValue({
    ledgerEntry: { _id: "ledger-1" },
  });
  mockGetMembershipByUserId.mockResolvedValue({
    _id: "sponsor-mem",
    userId: "sponsor-user",
    status: "active",
  });
});

describe("releaseHeldPairBonusesForDownlineActivation", () => {
  test("returns [] and is a no-op when no held events exist", async () => {
    mockEventFind.mockResolvedValueOnce([]);
    const released = await releaseHeldPairBonusesForDownlineActivation({
      newActiveUserId: "joiner-user",
      session: null,
    });
    expect(released).toEqual([]);
    expect(mockCreditWallet).not.toHaveBeenCalled();
    expect(mockMembershipUpdateOne).not.toHaveBeenCalled();
  });

  test("credits each held event to the sponsor and zeros heldPairBonusForSponsor", async () => {
    const heldEventA = {
      _id: "evt-a",
      recipientId: "sponsor-user",
      bonusAmount: 100,
      planType: "A",
      meta: { pairIndex: 1 },
      status: "held_awaiting_downline_activation",
      cappedAmount: 0,
      walletBucket: "pending",
      ledgerEntryId: null,
      save: jest.fn().mockResolvedValue(true),
    };
    const heldEventB = {
      _id: "evt-b",
      recipientId: "sponsor-user",
      bonusAmount: 50,
      planType: "A",
      meta: { pairIndex: 2 },
      status: "held_awaiting_downline_activation",
      cappedAmount: 0,
      walletBucket: "pending",
      ledgerEntryId: null,
      save: jest.fn().mockResolvedValue(true),
    };
    mockEventFind.mockResolvedValueOnce([heldEventA, heldEventB]);

    const released = await releaseHeldPairBonusesForDownlineActivation({
      newActiveUserId: "joiner-user",
      session: null,
    });

    expect(released).toHaveLength(2);
    expect(mockCreditWallet).toHaveBeenCalledTimes(2);

    // Each held event should be flipped to CREDITED and saved.
    expect(heldEventA.status).toBe("credited");
    expect(heldEventA.cappedAmount).toBe(100);
    expect(heldEventA.ledgerEntryId).toBe("ledger-1");
    expect(heldEventA.save).toHaveBeenCalledTimes(1);
    expect(heldEventB.status).toBe("credited");
    expect(heldEventB.cappedAmount).toBe(50);
    expect(heldEventB.save).toHaveBeenCalledTimes(1);

    // The activating joiner's heldPairBonusForSponsor must be zeroed.
    expect(mockMembershipUpdateOne).toHaveBeenCalledWith(
      { userId: "joiner-user" },
      { $set: { heldPairBonusForSponsor: 0 } },
      { session: null },
    );
  });

  test("skips terminated recipient and never credits their wallet", async () => {
    mockGetMembershipByUserId.mockResolvedValueOnce({
      _id: "sponsor-mem",
      userId: "sponsor-user",
      status: "terminated",
    });
    const heldEvent = {
      _id: "evt-x",
      recipientId: "sponsor-user",
      bonusAmount: 100,
      planType: "A",
      meta: { pairIndex: 1 },
      status: "held_awaiting_downline_activation",
      save: jest.fn(),
    };
    mockEventFind.mockResolvedValueOnce([heldEvent]);

    const released = await releaseHeldPairBonusesForDownlineActivation({
      newActiveUserId: "joiner-user",
      session: null,
    });

    expect(released).toEqual([]);
    expect(mockCreditWallet).not.toHaveBeenCalled();
    expect(heldEvent.save).not.toHaveBeenCalled();
    // Still drains the held counter so it doesn't get stuck.
    expect(mockMembershipUpdateOne).toHaveBeenCalled();
  });
});

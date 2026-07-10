/**
 * Admin soft-delete upline income reversal.
 */
import { jest } from "@jest/globals";
import mongoose from "mongoose";

const mockEventFind = jest.fn();
const mockEventSave = jest.fn();
const mockMembershipUpdateOne = jest.fn();
const mockDebitWallet = jest.fn();

jest.unstable_mockModule("../app/models/mlmCommissionEvent.js", () => {
  function CommissionEventMock(doc = {}) {
    Object.assign(this, doc);
    this.save = mockEventSave.mockImplementation(async () => this);
  }
  CommissionEventMock.find = mockEventFind;
  return { default: CommissionEventMock };
});

jest.unstable_mockModule("../app/models/mlmMembership.js", () => ({
  default: { updateOne: mockMembershipUpdateOne },
}));

jest.unstable_mockModule("../app/services/finance/walletService.js", () => ({
  debitWallet: mockDebitWallet,
  creditWallet: jest.fn(),
  getOrCreateWallet: jest.fn(),
}));

const {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_PLAN_TYPE,
} = await import("../app/constants/mlm.js");
const { clawbackUplineBonusesOnMemberSoftDelete } = await import(
  "../app/services/mlm/mlmBonusEngineService.js"
);

const deletedUserId = new mongoose.Types.ObjectId();
const sponsorUserId = new mongoose.Types.ObjectId();
const mentorUserId = new mongoose.Types.ObjectId();

function makeEvent(doc) {
  return {
    ...doc,
    meta: doc.meta || {},
    save: mockEventSave.mockImplementation(async function save() {
      return this;
    }),
  };
}

function chainableQuery(rows) {
  const query = {
    session: jest.fn().mockReturnThis(),
    then(onFulfilled, onRejected) {
      return Promise.resolve(rows).then(onFulfilled, onRejected);
    },
  };
  return query;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDebitWallet.mockResolvedValue({});
  mockMembershipUpdateOne.mockResolvedValue({ modifiedCount: 1 });
});

describe("clawbackUplineBonusesOnMemberSoftDelete", () => {
  it("debits upline wallet for CREDITED events sourced from deleted member", async () => {
    const pairEvent = makeEvent({
      _id: new mongoose.Types.ObjectId(),
      recipientId: sponsorUserId,
      sourceUserId: deletedUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      cappedAmount: 300,
      walletBucket: "pending",
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    });

    mockEventFind
      .mockImplementationOnce(() => chainableQuery([pairEvent]))
      .mockImplementationOnce(() => chainableQuery([]));

    const result = await clawbackUplineBonusesOnMemberSoftDelete({
      sourceMemberUserId: deletedUserId,
      session: {},
      reason: "fraud",
    });

    expect(mockDebitWallet).toHaveBeenCalledTimes(1);
    expect(mockDebitWallet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: sponsorUserId,
        amount: 300,
        bucket: "pending",
      }),
    );
    expect(pairEvent.status).toBe(MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK);
    expect(pairEvent.clawbackAmount).toBe(300);
    expect(result).toMatchObject({ processed: 1, voided: 0, totalAmount: 300 });
  });

  it("voids HELD events without debiting wallet", async () => {
    const heldEvent = makeEvent({
      _id: new mongoose.Types.ObjectId(),
      recipientId: sponsorUserId,
      sourceUserId: deletedUserId,
      bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
      planType: MLM_PLAN_TYPE.A,
      bonusAmount: 250,
      cappedAmount: 0,
      status: MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
    });

    mockEventFind
      .mockImplementationOnce(() => chainableQuery([heldEvent]))
      .mockImplementationOnce(() => chainableQuery([]));

    const result = await clawbackUplineBonusesOnMemberSoftDelete({
      sourceMemberUserId: deletedUserId,
      session: {},
    });

    expect(mockDebitWallet).not.toHaveBeenCalled();
    expect(heldEvent.status).toBe(MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK);
    expect(heldEvent.clawbackAmount).toBe(0);
    expect(result).toMatchObject({ processed: 0, voided: 1 });
  });

  it("claws back mentor royalty cascaded from a repurchase event", async () => {
    const repurchaseEventId = new mongoose.Types.ObjectId();
    const repurchaseEvent = makeEvent({
      _id: repurchaseEventId,
      recipientId: sponsorUserId,
      sourceUserId: deletedUserId,
      bonusType: MLM_BONUS_TYPE.REPURCHASE_BONUS,
      planType: MLM_PLAN_TYPE.B,
      cappedAmount: 100,
      walletBucket: "pending",
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    });
    const royaltyEvent = makeEvent({
      _id: new mongoose.Types.ObjectId(),
      recipientId: mentorUserId,
      sourceUserId: sponsorUserId,
      sourceCommissionEventId: repurchaseEventId,
      bonusType: MLM_BONUS_TYPE.MENTOR_ROYALTY,
      planType: MLM_PLAN_TYPE.B,
      cappedAmount: 10,
      walletBucket: "pending",
      status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
    });

    mockEventFind
      .mockImplementationOnce(() => chainableQuery([repurchaseEvent]))
      .mockImplementationOnce(() => chainableQuery([royaltyEvent]));

    const result = await clawbackUplineBonusesOnMemberSoftDelete({
      sourceMemberUserId: deletedUserId,
      session: {},
    });

    expect(mockDebitWallet).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ processed: 2, totalAmount: 110 });
  });
});

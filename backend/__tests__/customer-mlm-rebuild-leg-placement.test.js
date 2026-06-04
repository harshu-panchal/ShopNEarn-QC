/**
 * Customer-MLM-rebuild Phase 12 — Manual leg placement acceptance test.
 *
 * Verifies that when `placeInBinaryTree` is called with
 * `forceManualPlacement: true` + `preferredPosition: "R"`, the new
 * membership is placed under the sponsor's right leg (i.e. the
 * sponsor's `binaryRightChildId` gets set to the new member's userId).
 *
 * Also verifies the deterministic spillover when the chosen leg's
 * direct slot is already occupied — placement walks DOWN the chosen
 * leg into the first vacant slot, never the opposite leg.
 */
import { jest } from "@jest/globals";

const mockGetMlmConfig = jest.fn();
const mockMembershipFindOne = jest.fn();

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: mockGetMlmConfig,
}));

jest.unstable_mockModule("../app/models/mlmMembership.js", () => {
  function MembershipMock() {}
  MembershipMock.findOne = mockMembershipFindOne;
  MembershipMock.find = jest.fn();
  MembershipMock.create = jest.fn();
  return { default: MembershipMock };
});

// Pull in the module under test AFTER mocks are wired.
const { placeInBinaryTree } = await import(
  "../app/services/mlm/mlmMembershipService.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMlmConfig.mockResolvedValue({
    binaryPlacementStrategy: "manual",
    sponsorChainMaxDepth: 10,
  });
});

function makeMembership(overrides = {}) {
  return {
    _id: overrides._id || "mem-default",
    userId: overrides.userId || "user-default",
    binaryParentId: null,
    binaryParentMembershipId: null,
    binaryPosition: null,
    binaryLeftChildId: null,
    binaryRightChildId: null,
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("placeInBinaryTree — manual placement (forceManualPlacement=true)", () => {
  test("places new member under sponsor.binaryRightChildId when leg='R'", async () => {
    const sponsor = makeMembership({
      _id: "sponsor-mem",
      userId: "sponsor-user",
      binaryLeftChildId: null,
      binaryRightChildId: null,
    });
    const newMembership = makeMembership({
      _id: "new-mem",
      userId: "new-user",
    });

    const result = await placeInBinaryTree({
      newMembership,
      sponsorMembership: sponsor,
      session: null,
      preferredPosition: "R",
      forceManualPlacement: true,
    });

    expect(result).not.toBeNull();
    expect(result.position).toBe("R");
    expect(result.legUnderSponsor).toBe("R");

    // Sponsor's right pointer must now hold the new member's userId.
    expect(sponsor.binaryRightChildId).toBe("new-user");
    expect(sponsor.binaryLeftChildId).toBeNull();
    expect(sponsor.save).toHaveBeenCalledTimes(1);

    // New membership has its parent + position wired up correctly.
    expect(newMembership.binaryParentId).toBe("sponsor-user");
    expect(newMembership.binaryParentMembershipId).toBe("sponsor-mem");
    expect(newMembership.binaryPosition).toBe("R");
  });

  test("places new member under sponsor.binaryLeftChildId when leg='L'", async () => {
    const sponsor = makeMembership({
      _id: "sponsor-mem",
      userId: "sponsor-user",
    });
    const newMembership = makeMembership({
      _id: "new-mem",
      userId: "new-user",
    });

    await placeInBinaryTree({
      newMembership,
      sponsorMembership: sponsor,
      session: null,
      preferredPosition: "L",
      forceManualPlacement: true,
    });

    expect(sponsor.binaryLeftChildId).toBe("new-user");
    expect(sponsor.binaryRightChildId).toBeNull();
    expect(newMembership.binaryPosition).toBe("L");
  });

  test("walks down the chosen leg into the first vacant slot when direct slot is full", async () => {
    // Sponsor's right slot is occupied by grandchild "rl-user".
    const sponsor = makeMembership({
      _id: "sponsor-mem",
      userId: "sponsor-user",
      binaryRightChildId: "rl-user",
    });
    const rightChild = makeMembership({
      _id: "rl-mem",
      userId: "rl-user",
      binaryRightChildId: null, // vacant slot
    });

    // First lookup: sponsor's right child.
    mockMembershipFindOne.mockResolvedValueOnce(rightChild);

    const newMembership = makeMembership({
      _id: "new-mem",
      userId: "new-user",
    });

    const result = await placeInBinaryTree({
      newMembership,
      sponsorMembership: sponsor,
      session: null,
      preferredPosition: "R",
      forceManualPlacement: true,
    });

    expect(result.position).toBe("R");
    // The placement landed under the rightChild, not under the sponsor.
    expect(rightChild.binaryRightChildId).toBe("new-user");
    expect(sponsor.binaryRightChildId).toBe("rl-user"); // unchanged
    expect(rightChild.save).toHaveBeenCalledTimes(1);
    expect(sponsor.save).not.toHaveBeenCalled();

    // New membership's parent is the grandchild, but the leg under the
    // sponsor is still "R" — proves the leg choice was preserved.
    expect(newMembership.binaryParentId).toBe("rl-user");
    expect(result.legUnderSponsor).toBe("R");
  });
});

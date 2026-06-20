/**
 * Customer-MLM-rebuild Phase 12 — Manual leg placement acceptance test.
 *
 * Verifies that when `placeInBinaryTree` is called with
 * `forceManualPlacement: true` + `preferredPosition: "R"`, the new
 * membership is placed under the sponsor's right leg (i.e. the
 * sponsor's `binaryRightChildId` gets set to the new member's userId).
 *
 * Also verifies registration-ordered BFS spillover when the chosen
 * leg's direct slot is already occupied — left slot fills before
 * right at the next level, never the opposite leg under the sponsor.
 */
import { jest } from "@jest/globals";

const mockGetMlmConfig = jest.fn();
const mockMembershipFindOne = jest.fn();

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: mockGetMlmConfig,
}));

jest.unstable_mockModule("../app/models/mlmMembership.js", () => {
  function MembershipMock() {}
  MembershipMock.findOne = (...args) => mockMembershipFindOne(...args);
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
  mockMembershipFindOne.mockImplementation(() => ({
    populate: jest.fn().mockResolvedValue(null),
  }));
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

  test("fills left-before-right via BFS when the direct leg slot is full", async () => {
    // Sponsor's right slot is occupied by "rl-user".
    const sponsor = makeMembership({
      _id: "sponsor-mem",
      userId: "sponsor-user",
      binaryRightChildId: "rl-user",
    });
    const rightChild = makeMembership({
      _id: "rl-mem",
      userId: "rl-user",
      binaryLeftChildId: null,
      binaryRightChildId: null,
    });

    mockMembershipFindOne.mockImplementation(() => ({
      populate: jest.fn().mockResolvedValue(rightChild),
    }));

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

    expect(result.position).toBe("L");
    expect(rightChild.binaryLeftChildId).toBe("new-user");
    expect(sponsor.binaryRightChildId).toBe("rl-user");
    expect(rightChild.save).toHaveBeenCalledTimes(1);
    expect(sponsor.save).not.toHaveBeenCalled();
    expect(newMembership.binaryParentId).toBe("rl-user");
    expect(result.legUnderSponsor).toBe("R");
  });
});

/**
 * mlm-binary-move.test.js — validation rules for admin tree rearrange.
 */
import { jest } from "@jest/globals";

const MEMBER_ID = "507f1f77bcf86cd799439011";
const PARENT_ID = "507f1f77bcf86cd799439012";
const OLD_PARENT_MEM_ID = "507f1f77bcf86cd799439013";
const DESC_ID = "507f1f77bcf86cd799439014";
const ROOT_ID = "507f1f77bcf86cd799439015";
const UPLINE_MEM_ID = "507f1f77bcf86cd799439016";

const USER_CHILD = "507f1f77bcf86cd799439021";
const USER_PARENT = "507f1f77bcf86cd799439022";
const USER_OLD = "507f1f77bcf86cd799439023";
const USER_ROOT = "507f1f77bcf86cd799439024";
const USER_DESC = "507f1f77bcf86cd799439025";
const USER_UP = "507f1f77bcf86cd799439026";
const USER_OLD_SPONSOR = "507f1f77bcf86cd799439027";
const USER_OTHER = "507f1f77bcf86cd799439028";
const USER_SPONSOR = "507f1f77bcf86cd799439029";

const mockFindById = jest.fn();
const mockFindOne = jest.fn();
const mockAggregate = jest.fn();
const mockCountDocuments = jest.fn();

jest.unstable_mockModule("../app/models/mlmMembership.js", () => ({
  default: {
    findById: (...args) => mockFindById(...args),
    findOne: (...args) => mockFindOne(...args),
    aggregate: (...args) => mockAggregate(...args),
    find: jest.fn(),
    updateOne: jest.fn(),
    collection: { name: "mlmmemberships" },
  },
}));

jest.unstable_mockModule("../app/models/mlmWithdrawalRequest.js", () => ({
  default: { countDocuments: (...args) => mockCountDocuments(...args) },
}));

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: jest.fn().mockResolvedValue({ sponsorChainMaxDepth: 10 }),
}));

const { previewBinaryMove } = await import(
  "../app/services/mlm/mlmBinaryMoveService.js"
);

function chainableLean(value) {
  return {
    populate: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
    lean: jest.fn().mockResolvedValue(value),
    session: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCountDocuments.mockResolvedValue(0);
  mockAggregate.mockReturnValue({
    session: jest.fn().mockResolvedValue([{ descendants: [] }]),
  });
});

describe("previewBinaryMove", () => {
  test("rejects move when target slot is occupied by another member", async () => {
    mockFindById
      .mockImplementationOnce(() =>
        chainableLean({
          _id: MEMBER_ID,
          userId: { _id: USER_CHILD, name: "Child" },
          referralCode: "CHILD1",
          binaryParentId: USER_OLD,
          binaryPosition: "L",
          sponsorId: USER_SPONSOR,
          deletedAt: null,
        }),
      )
      .mockImplementationOnce(() =>
        chainableLean({
          _id: PARENT_ID,
          userId: { _id: USER_PARENT, name: "Parent" },
          referralCode: "PARENT1",
          deletedAt: null,
        }),
      );

    mockFindOne.mockImplementation((query) => {
      if (query.binaryParentId && query.binaryPosition === "R") {
        return chainableLean({
          userId: { _id: USER_OTHER, name: "Other" },
          referralCode: "OTHER1",
        });
      }
      return chainableLean(null);
    });

    await expect(
      previewBinaryMove({
        membershipId: MEMBER_ID,
        newParentMembershipId: PARENT_ID,
        leg: "R",
        changeSponsorToNewParent: false,
      }),
    ).rejects.toMatchObject({ code: "SLOT_TAKEN", statusCode: 409 });
  });

  test("rejects move when destination is inside member subtree (cycle)", async () => {
    mockFindById
      .mockImplementationOnce(() =>
        chainableLean({
          _id: ROOT_ID,
          userId: { _id: USER_ROOT, name: "Root" },
          referralCode: "ROOT1",
          binaryParentId: null,
          binaryLeftChildId: USER_DESC,
          binaryPosition: null,
          deletedAt: null,
        }),
      )
      .mockImplementationOnce(() =>
        chainableLean({
          _id: DESC_ID,
          userId: { _id: USER_DESC, name: "Descendant" },
          referralCode: "DESC1",
          deletedAt: null,
        }),
      );

    mockAggregate.mockReturnValue({
      session: jest.fn().mockResolvedValue([
        {
          descendants: [{ userId: USER_DESC }],
        },
      ]),
    });

    mockFindOne.mockImplementation(() => chainableLean(null));

    await expect(
      previewBinaryMove({
        membershipId: ROOT_ID,
        newParentMembershipId: DESC_ID,
        leg: "L",
        changeSponsorToNewParent: false,
      }),
    ).rejects.toMatchObject({ code: "CYCLE", statusCode: 422 });
  });

  test("preview succeeds for valid empty-slot binary-only move", async () => {
    mockFindById
      .mockImplementationOnce(() =>
        chainableLean({
          _id: MEMBER_ID,
          userId: { _id: USER_CHILD, name: "Child" },
          referralCode: "CHILD1",
          status: "active",
          binaryParentId: USER_OLD,
          binaryPosition: "L",
          sponsorId: USER_SPONSOR,
          deletedAt: null,
        }),
      )
      .mockImplementationOnce(() =>
        chainableLean({
          _id: PARENT_ID,
          userId: { _id: USER_PARENT, name: "Parent" },
          referralCode: "PARENT1",
          binaryParentId: USER_UP,
          deletedAt: null,
        }),
      )
      .mockImplementationOnce(() =>
        chainableLean({
          _id: UPLINE_MEM_ID,
          userId: { _id: USER_UP, name: "Upline" },
          referralCode: "UP1",
          binaryParentId: null,
        }),
      );

    mockFindOne.mockImplementation((query) => {
      if (query.userId === USER_OLD) {
        return chainableLean({
          _id: OLD_PARENT_MEM_ID,
          userId: { _id: USER_OLD, name: "OldParent" },
          referralCode: "OLD1",
        });
      }
      if (query.binaryParentId && query.binaryPosition === "R") {
        return chainableLean(null);
      }
      return chainableLean(null);
    });

    const preview = await previewBinaryMove({
      membershipId: MEMBER_ID,
      newParentMembershipId: PARENT_ID,
      leg: "R",
      changeSponsorToNewParent: false,
    });

    expect(preview.subtreeSize).toBe(1);
    expect(preview.willChangeSponsor).toBe(false);
    expect(preview.recommendedJobIds).toContain("backfill-binary-team-pair-counts");
    expect(preview.after.binaryParent.leg).toBe("R");
  });

  test("preview flags sponsor change when requested", async () => {
    mockFindById.mockImplementation((id) => {
      if (String(id) === MEMBER_ID) {
        return chainableLean({
          _id: MEMBER_ID,
          userId: { _id: USER_CHILD, name: "Child" },
          referralCode: "CHILD1",
          status: "active",
          binaryParentId: USER_OLD,
          binaryPosition: "L",
          sponsorId: USER_OLD_SPONSOR,
          deletedAt: null,
        });
      }
      if (String(id) === PARENT_ID) {
        return chainableLean({
          _id: PARENT_ID,
          userId: { _id: USER_PARENT, name: "Parent" },
          referralCode: "PARENT1",
          binaryParentId: null,
          deletedAt: null,
        });
      }
      return chainableLean(null);
    });

    mockFindOne.mockImplementation((query) => {
      if (query.userId === USER_OLD) {
        return chainableLean({
          _id: OLD_PARENT_MEM_ID,
          userId: { _id: USER_OLD, name: "OldParent" },
        });
      }
      if (query.binaryParentId) return chainableLean(null);
      return chainableLean(null);
    });

    const MlmMembership = (await import("../app/models/mlmMembership.js")).default;
    MlmMembership.find = jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ status: "active" }]),
    });

    const preview = await previewBinaryMove({
      membershipId: MEMBER_ID,
      newParentMembershipId: PARENT_ID,
      leg: "L",
      changeSponsorToNewParent: true,
    });

    expect(preview.willChangeSponsor).toBe(true);
    expect(preview.recommendedJobIds).toContain("recalculate-downline-counters");
    expect(preview.after.sponsorId).toBe(USER_PARENT);
  });
});

/**
 * Shared MLM binary tree builder.
 *
 * BACKGROUND — why this exists
 *
 * `MlmMembership` stores the binary tree in TWO mutually-redundant
 * ways:
 *
 *   • Bottom-up   : every member knows its parent via
 *                   `binaryParentId` + `binaryPosition` (L|R).
 *   • Top-down    : every parent has `binaryLeftChildId` and
 *                   `binaryRightChildId` denormalised onto itself.
 *
 * The placement service writes to BOTH on every insert. In theory
 * they always agree. In practice, legacy data, partially-aborted
 * placements, race conditions, and at least one historical
 * placement bug where a second "L" sibling overwrote the parent's
 * `binaryLeftChildId` (instead of spilling down the existing left
 * chain) have left some roots with **stale top-down pointers**.
 *
 * Walking top-down on such roots silently truncates the tree — the
 * orphaned subtree and every descendant below it become invisible
 * even though their `binaryParentId` linkage is intact.
 *
 * THIS BUILDER walks bottom-up: it loads every descendant in a
 * single query (`sponsorChain` contains the root), groups them by
 * `binaryParentId`, picks a winner when two siblings claim the same
 * slot, and assembles the tree from the root down. Every member
 * with a valid `binaryParentId` chain back to the root is rendered.
 *
 * The two callers (customer self-view, admin member-detail view)
 * compose their own per-node payload via a `shape(node, position)`
 * callback — privacy/masking rules differ between the two surfaces.
 *
 * Drift is surfaced via the returned `drift` array so the audit
 * playbook can spot and repair the offending data (see Phase 4 of
 * the database audit plan).
 */

import MlmMembership from "../../models/mlmMembership.js";

/**
 * @typedef {Object} BinaryTreeNode
 * @property {string|null} position    "L" | "R" | null (root has null)
 * @property {Object}      raw         the populated MlmMembership lean doc
 * @property {BinaryTreeNode|null} left
 * @property {BinaryTreeNode|null} right
 */

/**
 * @typedef {Object} DriftEntry
 * @property {"slot-conflict"|"stale-top-down-left"|"stale-top-down-right"|"orphan-parent"} kind
 * @property {string}      parentUserId
 * @property {string}     [winnerMembershipId]
 * @property {string}     [loserMembershipId]
 * @property {string}     [topDownUserId]
 * @property {string}     [bottomUpUserId]
 */

/**
 * Build the binary subtree rooted at `rootMembership` by walking
 * bottom-up `binaryParentId` linkage. Returns the assembled tree
 * (capped at `depthLeft`) plus any drift diagnostics observed
 * while choosing winners between conflicting siblings.
 *
 * The returned tree always includes the root, even when depth is 0
 * (depth 0 ⇒ just the root, no children).
 *
 * @param {Object} args
 * @param {Object} args.rootMembership  MlmMembership lean/full doc; userId may or may not be populated
 * @param {number} args.depthLeft        depth cap; root counts as 0
 * @returns {Promise<{tree: BinaryTreeNode|null, drift: DriftEntry[], totalDescendants: number, renderedCount: number, orphanedCount: number}>}
 */
export async function buildBinaryTreeBottomUp({ rootMembership, depthLeft }) {
  if (!rootMembership) {
    return {
      tree: null,
      drift: [],
      totalDescendants: 0,
      renderedCount: 0,
      orphanedCount: 0,
    };
  }

  const rootUserId =
    rootMembership.userId?._id || rootMembership.userId;

  // Fetch all binary descendants in one round-trip using $graphLookup.
  // The previous implementation queried by `sponsorChain`, which is a
  // UNILEVEL field and completely ignores binary spillovers placed
  // under this root by someone further up the tree.
  const aggResult = await MlmMembership.aggregate([
    { $match: { userId: rootUserId } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        maxDepth: Math.max(0, depthLeft - 1),
      },
    },
  ]);

  let descendants = aggResult[0]?.descendants || [];
  // $graphLookup doesn't populate refs, so we populate them manually.
  descendants = await MlmMembership.populate(descendants, {
    path: "userId",
    select: "name phone userId",
  });

  // Ensure the root has its User populated for the per-node payload.
  let populatedRoot = rootMembership;
  if (!rootMembership.userId?.name && rootMembership._id) {
    populatedRoot = await MlmMembership.findById(rootMembership._id)
      .populate("userId", "name phone userId")
      .lean();
  }

  // Group children by their declared parent. When two members claim
  // the same slot (a known data-integrity defect), pick the winner
  // with the larger downline so we render as much of the real tree
  // as possible. Tie-break in favour of the candidate the parent's
  // top-down pointer agrees with, then by earliest `joinedAt`, then
  // by smallest `_id` (deterministic).
  const drift = [];
  const childrenByParent = new Map(); // parentUserIdStr → { L, R }

  const parentLookupForTopDownCheck = new Map();
  parentLookupForTopDownCheck.set(String(rootUserId), populatedRoot);
  for (const d of descendants) {
    parentLookupForTopDownCheck.set(String(d.userId?._id || d.userId), d);
  }

  const pickWinner = (existing, candidate, parentDoc, slotKey) => {
    if (!existing) return candidate;
    // Heuristics from strongest to weakest.
    const candidateMatchesTopDown =
      parentDoc &&
      String(
        slotKey === "L"
          ? parentDoc.binaryLeftChildId
          : parentDoc.binaryRightChildId,
      ) === String(candidate.userId?._id || candidate.userId);
    const existingMatchesTopDown =
      parentDoc &&
      String(
        slotKey === "L"
          ? parentDoc.binaryLeftChildId
          : parentDoc.binaryRightChildId,
      ) === String(existing.userId?._id || existing.userId);
    const candidateDownline = candidate.totalDownlineCount || 0;
    const existingDownline = existing.totalDownlineCount || 0;
    if (candidateDownline !== existingDownline) {
      return candidateDownline > existingDownline ? candidate : existing;
    }
    if (candidateMatchesTopDown !== existingMatchesTopDown) {
      return candidateMatchesTopDown ? candidate : existing;
    }
    const candidateJoined = candidate.joinedAt
      ? new Date(candidate.joinedAt).getTime()
      : Infinity;
    const existingJoined = existing.joinedAt
      ? new Date(existing.joinedAt).getTime()
      : Infinity;
    if (candidateJoined !== existingJoined) {
      return candidateJoined < existingJoined ? candidate : existing;
    }
    return String(candidate._id) < String(existing._id) ? candidate : existing;
  };

  for (const m of descendants) {
    if (!m.binaryParentId) continue;
    if (m.binaryPosition !== "L" && m.binaryPosition !== "R") continue;
    const parentKey = String(m.binaryParentId);
    let slot = childrenByParent.get(parentKey);
    if (!slot) {
      slot = { L: null, R: null };
      childrenByParent.set(parentKey, slot);
    }
    const slotKey = m.binaryPosition;
    const existing = slot[slotKey];
    const parentDoc = parentLookupForTopDownCheck.get(parentKey) || null;
    const winner = pickWinner(existing, m, parentDoc, slotKey);
    if (existing && existing !== winner) {
      drift.push({
        kind: "slot-conflict",
        parentUserId: parentKey,
        winnerMembershipId: String(winner._id),
        loserMembershipId: String(existing._id),
      });
    } else if (existing && existing === winner) {
      drift.push({
        kind: "slot-conflict",
        parentUserId: parentKey,
        winnerMembershipId: String(existing._id),
        loserMembershipId: String(m._id),
      });
    }
    slot[slotKey] = winner;
  }

  // Walk top-down from the root, but using the bottom-up children
  // map. Capped at `depthLeft` to bound payload size for distant
  // genealogies (frontend lazy-expands deeper levels by re-querying
  // with `?rootUserId=...`).
  const rendered = new Set();
  function walk(member, depth, position) {
    if (!member) return null;
    rendered.add(String(member._id));
    const node = {
      position,
      raw: member,
      left: null,
      right: null,
    };
    if (depth <= 0) return node;
    const key = String(member.userId?._id || member.userId);
    const slot = childrenByParent.get(key);
    if (!slot) return node;
    if (slot.L) node.left = walk(slot.L, depth - 1, "L");
    if (slot.R) node.right = walk(slot.R, depth - 1, "R");
    return node;
  }

  const tree = walk(populatedRoot, Math.max(0, depthLeft || 0), null);

  // Cross-check top-down pointers against bottom-up for drift
  // surfaces. We only emit one drift entry per stale pointer, even
  // when depthLeft truncated the walk before reaching the parent.
  for (const [parentKey, slot] of childrenByParent.entries()) {
    const parentDoc = parentLookupForTopDownCheck.get(parentKey);
    if (!parentDoc) continue;
    const expectedLeft = slot.L
      ? String(slot.L.userId?._id || slot.L.userId)
      : null;
    const expectedRight = slot.R
      ? String(slot.R.userId?._id || slot.R.userId)
      : null;
    const actualLeft = parentDoc.binaryLeftChildId
      ? String(parentDoc.binaryLeftChildId)
      : null;
    const actualRight = parentDoc.binaryRightChildId
      ? String(parentDoc.binaryRightChildId)
      : null;
    if (expectedLeft && actualLeft !== expectedLeft) {
      drift.push({
        kind: "stale-top-down-left",
        parentUserId: parentKey,
        topDownUserId: actualLeft,
        bottomUpUserId: expectedLeft,
      });
    }
    if (expectedRight && actualRight !== expectedRight) {
      drift.push({
        kind: "stale-top-down-right",
        parentUserId: parentKey,
        topDownUserId: actualRight,
        bottomUpUserId: expectedRight,
      });
    }
  }

  return {
    tree,
    drift,
    totalDescendants: descendants.length,
    renderedCount: rendered.size,
    orphanedCount: descendants.length + 1 - rendered.size,
  };
}

/**
 * For a given root and its direct referrals, return a Map of
 * `referralMembershipId → "L" | "R" | null` describing which leg
 * of the ROOT's tree each referral actually landed in.
 *
 * Why this exists: the naïve approach — reading
 * `referral.binaryPosition` — only works for placements directly
 * under the root. For spillover placements, `binaryPosition` is the
 * referral's position relative to its IMMEDIATE `binaryParent`
 * (some downline node), not relative to the root. A referral
 * sponsored by YASMIN but spilled under SAMAD (YASMIN's right child)
 * may have `binaryPosition === "L"` because they slotted into
 * SAMAD's left — but they're actually in YASMIN's RIGHT leg.
 *
 * Uses a single descendant query and an in-memory walk per
 * referral, so cost is O(descendants + Σ depth-of-each-direct).
 *
 * @param {Object} args
 * @param {Object} args.rootMembership   MlmMembership doc (populated or lean)
 * @param {Array<Object>} args.directReferrals  MlmMembership lean docs whose `sponsorId === root.userId`
 * @returns {Promise<Map<string, "L"|"R"|null>>}
 */
export async function classifyDirectReferralsByLegUnderRoot({
  rootMembership,
  directReferrals,
  includeDepth = false,
}) {
  const result = new Map();
  if (!rootMembership || !directReferrals?.length) return result;
  const rootUserId =
    rootMembership.userId?._id || rootMembership.userId;
  const rootKey = String(rootUserId);

  const aggResult = await MlmMembership.aggregate([
    { $match: { userId: rootUserId } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        // Bounded depth to prevent massive payload walks
        maxDepth: 64,
      },
    },
    {
      $project: {
        descendants: {
          $map: {
            input: "$descendants",
            as: "d",
            in: {
              userId: "$$d.userId",
              binaryParentId: "$$d.binaryParentId",
              binaryPosition: "$$d.binaryPosition",
            },
          },
        },
      },
    },
  ]);

  const descendants = aggResult[0]?.descendants || [];

  const parentLinkByUser = new Map();
  for (const d of descendants) {
    parentLinkByUser.set(String(d.userId), {
      parent: d.binaryParentId ? String(d.binaryParentId) : null,
      position: d.binaryPosition || null,
    });
  }

  const MAX_HOPS = 64;
  for (const ref of directReferrals) {
    const refUserKey = String(ref.userId);
    let cursorUser = refUserKey;
    let leg = null;
    let depth = 999;
    for (let i = 0; i < MAX_HOPS; i += 1) {
      const link = parentLinkByUser.get(cursorUser);
      if (!link || !link.parent) {
        // Defensive: orphan chain. Fall back to the referral's own
        // `binaryPosition` (best guess) when we can't reach root.
        if (cursorUser === refUserKey) {
          leg = ref.binaryPosition || null;
          depth = 1;
        }
        break;
      }
      if (link.parent === rootKey) {
        leg = link.position;
        depth = i + 1;
        break;
      }
      cursorUser = link.parent;
    }
    if (includeDepth) {
      result.set(String(ref._id), { leg, depth });
    } else {
      result.set(String(ref._id), leg);
    }
  }
  return result;
}

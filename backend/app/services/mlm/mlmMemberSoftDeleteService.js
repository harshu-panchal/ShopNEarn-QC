/**
 * MLM member soft-delete service.
 *
 * Removes a single `MlmMembership` from the live binary tree while
 * preserving every other row's audit trail. The operation runs
 * inside ONE mongoose transaction (per mongoose-transaction-wrap
 * skill) so a crash mid-way leaves no half-restructured tree.
 *
 * Restructuring policy (chosen by the PO):
 *
 *   1. PROMOTION RULE — when the deleted member has two children,
 *      the child with the LARGER `totalDownlineCount` wins the
 *      now-vacant slot under the grandparent. Ties broken by
 *      earliest `joinedAt`, then smallest `_id`. The other child is
 *      spilled (see #2).
 *
 *   2. SPILLOVER RULE — the "loser" child walks down the PROMOTED
 *      sibling's chain on the loser's ORIGINAL leg ("L" if loser
 *      was the deleted member's left child, "R" if right) until the
 *      first empty same-side slot. This mirrors the manual-signup
 *      placement rule so the deleted member's two subtrees stay on
 *      their respective legs.
 *
 *   3. SPONSOR REMAP — every direct referral of the deleted member
 *      (rows with `sponsorId === deleted.userId`) is re-parented to
 *      the deleted member's own sponsor. Their `sponsorChain` is
 *      rewritten via `$pull` of the deleted member's userId so the
 *      chain stays gap-free; upline counter deltas are applied
 *      atomically.
 *
 *   4. CUSTOMER LOCK — the linked `Customer` row is soft-deleted
 *      (`deletedAt`, `deletedBy`) and `isActive` flipped to false so
 *      the account can no longer authenticate.
 *
 *   5. WALLET / WITHDRAWALS — the wallet is FROZEN IN PLACE (no
 *      transfer-out). Pending withdrawal requests are auto-rejected
 *      via the canonical `rejectWithdrawalRequest` flow so the
 *      ledger reversal happens inside the same session.
 *
 * The service is purely admin-initiated: it expects an `adminId` and
 * stamps `deletedBy` / `updatedBy` on every touched row.
 */

import mongoose from "mongoose";

import MlmMembership from "../../models/mlmMembership.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import Customer from "../../models/customer.js";
import { MLM_WITHDRAWAL_STATUS } from "../../constants/mlm.js";

import { rejectWithdrawalRequest } from "./mlmWithdrawalService.js";
import { syncCustomerMlmProjection } from "./mlmMembershipService.js";
import { classifyDirectReferralsByLegUnderRoot } from "./mlmBinaryTreeBuilder.js";

const SPILLOVER_MAX_HOPS = 500;

function makeError(message, statusCode = 400, code = "SOFT_DELETE_ERROR") {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Pick the child that should be promoted into the deleted member's
 * vacated slot. Larger subtree wins; ties broken deterministically.
 */
function pickPromotedChild(leftChild, rightChild) {
  if (leftChild && !rightChild) return { promoted: leftChild, loser: null };
  if (rightChild && !leftChild) return { promoted: rightChild, loser: null };
  if (!leftChild && !rightChild) return { promoted: null, loser: null };
  const leftDown = leftChild.totalDownlineCount || 0;
  const rightDown = rightChild.totalDownlineCount || 0;
  if (leftDown !== rightDown) {
    return leftDown >= rightDown
      ? { promoted: leftChild, loser: rightChild }
      : { promoted: rightChild, loser: leftChild };
  }
  const lt = leftChild.joinedAt ? new Date(leftChild.joinedAt).getTime() : Infinity;
  const rt = rightChild.joinedAt ? new Date(rightChild.joinedAt).getTime() : Infinity;
  if (lt !== rt) {
    return lt <= rt
      ? { promoted: leftChild, loser: rightChild }
      : { promoted: rightChild, loser: leftChild };
  }
  return String(leftChild._id) < String(rightChild._id)
    ? { promoted: leftChild, loser: rightChild }
    : { promoted: rightChild, loser: leftChild };
}

/**
 * Walk DOWN from `cursor` following `direction` children (L or R)
 * until we find a node whose `direction` slot is empty. Returns that
 * node. Uses the bottom-up `binaryParentId` linkage (re-built from
 * the loaded descendant set) so it tolerates stale top-down pointers.
 */
function findSpilloverParent({
  startMembership,
  direction,
  childrenByParent,
  excludeUserId,
}) {
  let cursor = startMembership;
  for (let i = 0; i < SPILLOVER_MAX_HOPS; i += 1) {
    if (String(cursor.userId) === String(excludeUserId)) {
      throw makeError(
        `Spillover walk hit the loser itself (cycle in binary tree under ${excludeUserId})`,
        500,
        "BINARY_TREE_CYCLE",
      );
    }
    const slot = childrenByParent.get(String(cursor.userId));
    const childAtDirection = slot ? slot[direction] : null;
    if (!childAtDirection) return cursor;
    cursor = childAtDirection;
  }
  throw makeError(
    `Spillover walk exceeded ${SPILLOVER_MAX_HOPS} hops`,
    500,
    "SPILLOVER_TOO_DEEP",
  );
}

/**
 * Build a winner-aware { parentUserId → { L, R: membership } } map
 * from the supplied descendant set. This is the same algorithm the
 * tree builder uses; here we use it to drive the spillover walk
 * AFTER the deleted member's pointers have been hypothetically
 * cleared.
 */
function buildChildrenByParentMap(descendants, deletedMembershipId) {
  const map = new Map();
  for (const m of descendants) {
    if (String(m._id) === String(deletedMembershipId)) continue;
    if (!m.binaryParentId) continue;
    if (m.binaryPosition !== "L" && m.binaryPosition !== "R") continue;
    // Skip nodes whose binaryParent IS the deletedMember — they're
    // about to be re-wired and shouldn't influence the walk yet.
    const key = String(m.binaryParentId);
    if (!map.has(key)) map.set(key, { L: null, R: null });
    map.get(key)[m.binaryPosition] = m;
  }
  return map;
}

/**
 * Idempotency guard for re-runs (in case an admin double-clicks).
 * Returns the already-tombstoned membership so the controller can
 * return 200 with a clear "already deleted" payload.
 */
async function loadMembershipIncludingDeleted(membershipId, { session }) {
  return MlmMembership.findOne(
    { _id: membershipId, __includeDeleted: true },
    null,
    { session },
  );
}

/**
 * Public entry point.
 *
 * @param {Object} args
 * @param {string|mongoose.Types.ObjectId} args.membershipId  MlmMembership document id
 * @param {string|mongoose.Types.ObjectId} args.adminId       Admin _id (for audit stamping)
 * @param {string} [args.reason]                              Free-text reason (defaults to "Soft-deleted by admin")
 * @returns {Promise<Object>} summary payload
 */
export async function softDeleteMlmMember({
  membershipId,
  adminId,
  reason = "Soft-deleted by admin",
}) {
  if (!mongoose.isValidObjectId(membershipId)) {
    throw makeError("Invalid member id", 400, "MEMBERSHIP_INVALID");
  }
  if (!adminId) {
    throw makeError("Admin context required for soft-delete", 401, "ADMIN_REQUIRED");
  }

  const session = await mongoose.startSession();
  let summary;
  try {
    await session.withTransaction(async () => {
      // ---------- STEP 1 — load + guards ----------
      const target = await loadMembershipIncludingDeleted(membershipId, { session });
      if (!target) {
        throw makeError("Member not found", 404, "MEMBERSHIP_NOT_FOUND");
      }
      if (target.deletedAt) {
        summary = {
          alreadyDeleted: true,
          membershipId: String(target._id),
        };
        return;
      }
      const targetUserId = target.userId;

      // ---------- STEP 2 — collect tree neighbours ----------
      const [parentMembership, leftChild, rightChild] = await Promise.all([
        target.binaryParentMembershipId
          ? MlmMembership.findById(target.binaryParentMembershipId, null, { session })
          : null,
        target.binaryLeftChildId
          ? MlmMembership.findOne({ userId: target.binaryLeftChildId }, null, { session })
          : null,
        target.binaryRightChildId
          ? MlmMembership.findOne({ userId: target.binaryRightChildId }, null, { session })
          : null,
      ]);

      // Direct (sponsor-level) referrals — these get re-parented.
      const directReferrals = await MlmMembership.find(
        { sponsorId: targetUserId },
        null,
        { session },
      );

      // Full sponsorChain-based downline so the spillover walk has a
      // complete map without issuing per-hop DB queries.
      const downline = await MlmMembership.find(
        { sponsorChain: targetUserId },
        null,
        { session },
      );

      // ---------- STEP 3 — restructure the binary tree ----------
      const { promoted, loser } = pickPromotedChild(leftChild, rightChild);

      // Record the loser's ORIGINAL position so we know which leg to
      // spill them down under the promoted sibling.
      const loserOriginalPosition = loser
        ? loser.binaryPosition
        : null;

      // Detach all of the deleted member's binary edges first so the
      // walker doesn't see ghost children.
      target.binaryLeftChildId = null;
      target.binaryRightChildId = null;
      // Keep `binaryParentId` / `binaryPosition` on the tombstoned
      // row for audit; nothing else should ever read them once
      // `deletedAt` is set.

      if (parentMembership) {
        const wasLeft = String(parentMembership.binaryLeftChildId) === String(targetUserId);
        const wasRight = String(parentMembership.binaryRightChildId) === String(targetUserId);
        if (promoted) {
          if (wasLeft) parentMembership.binaryLeftChildId = promoted.userId;
          if (wasRight) parentMembership.binaryRightChildId = promoted.userId;
          promoted.binaryParentId = parentMembership.userId;
          promoted.binaryParentMembershipId = parentMembership._id;
          // The promoted child INHERITS the deleted member's
          // position relative to the grandparent (L or R).
          promoted.binaryPosition = wasLeft ? "L" : wasRight ? "R" : promoted.binaryPosition;
        } else {
          if (wasLeft) parentMembership.binaryLeftChildId = null;
          if (wasRight) parentMembership.binaryRightChildId = null;
        }
        parentMembership.updatedBy = adminId;
        await parentMembership.save({ session });
      } else if (promoted) {
        // Deleted member was the binary root. The promoted child
        // becomes the new root: no parent at all, no inherited
        // position.
        promoted.binaryParentId = null;
        promoted.binaryParentMembershipId = null;
        promoted.binaryPosition = null;
      }

      let loserNewParent = null;
      if (promoted && loser) {
        // Build the bottom-up children map AS IF the deleted
        // member's edges were already gone — that's exactly the
        // post-restructure state we want the spillover walk to see.
        const provisionalDownline = downline.filter(
          (m) =>
            String(m._id) !== String(loser._id) &&
            String(m._id) !== String(promoted._id),
        );
        // Inject the promoted child with its new parent so the
        // walker's first step (promoted itself) returns the right
        // children map entry.
        const childrenByParent = buildChildrenByParentMap(
          provisionalDownline,
          target._id,
        );
        loserNewParent = findSpilloverParent({
          startMembership: promoted,
          direction: loserOriginalPosition,
          childrenByParent,
          excludeUserId: loser.userId,
        });
        // Wire the loser into its new home.
        loser.binaryParentId = loserNewParent.userId;
        loser.binaryParentMembershipId = loserNewParent._id;
        loser.binaryPosition = loserOriginalPosition;
        if (loserOriginalPosition === "L") {
          loserNewParent.binaryLeftChildId = loser.userId;
        } else {
          loserNewParent.binaryRightChildId = loser.userId;
        }
        if (String(loserNewParent._id) !== String(promoted._id)) {
          loserNewParent.updatedBy = adminId;
          await loserNewParent.save({ session });
        }
      }
      if (promoted) {
        promoted.updatedBy = adminId;
        await promoted.save({ session });
      }
      if (loser && loser !== promoted) {
        loser.updatedBy = adminId;
        await loser.save({ session });
      }

      // ---------- STEP 4 — sponsor remap for direct referrals ----------
      const targetSponsorId = target.sponsorId || null;
      const targetSponsorMembershipId = target.sponsorMembershipId || null;
      const targetSponsorChain = Array.isArray(target.sponsorChain)
        ? target.sponsorChain.map((id) => String(id))
        : [];

      // We need to know which LEG of the deleted member's OWN sponsor
      // each direct referral landed in — used to bump the new
      // sponsor's leftLegDirectCount / rightLegDirectCount and the
      // old sponsor's totalDownlineCount stays unchanged (descendants
      // are still in their tree, only the tombstone is removed).
      const legByReferral = targetSponsorId
        ? await classifyDirectReferralsByLegUnderRoot({
            rootMembership: { userId: targetSponsorId },
            directReferrals,
          })
        : new Map();

      let leftIncrement = 0;
      let rightIncrement = 0;
      for (const ref of directReferrals) {
        ref.sponsorId = targetSponsorId;
        ref.sponsorMembershipId = targetSponsorMembershipId;
        ref.updatedBy = adminId;
        // Prepend new upline to the sponsorChain BUT first strip the
        // deleted member (handled in step 5 via updateMany for the
        // entire downline including direct referrals).
        await ref.save({ session });
        const leg = legByReferral.get(String(ref._id));
        if (leg === "L") leftIncrement += 1;
        else if (leg === "R") rightIncrement += 1;
      }

      // ---------- STEP 5 — strip deleted member from EVERY downline's sponsorChain ----------
      if (downline.length > 0) {
        await MlmMembership.updateMany(
          { sponsorChain: targetUserId },
          { $pull: { sponsorChain: targetUserId } },
          { session },
        );
      }

      // ---------- STEP 6 — counter adjustments ----------
      if (targetSponsorId) {
        const inc = {
          // Deleted member herself is no longer a direct referral.
          directReferralsCount: -1,
          // Her downline is unchanged (descendants stay), but SHE
          // dropped out → -1 to total downline.
          totalDownlineCount: -1,
        };
        // Old leg counter (member's slot under sponsor).
        if (target.binaryPosition === "L") inc.leftLegDirectCount = -1;
        else if (target.binaryPosition === "R") inc.rightLegDirectCount = -1;
        // New direct referrals counted under sponsor.
        inc.directReferralsCount += directReferrals.length;
        if (leftIncrement) inc.leftLegDirectCount = (inc.leftLegDirectCount || 0) + leftIncrement;
        if (rightIncrement) inc.rightLegDirectCount = (inc.rightLegDirectCount || 0) + rightIncrement;
        await MlmMembership.updateOne(
          { userId: targetSponsorId },
          { $inc: inc },
          { session },
        );
      }

      // Decrement totalDownlineCount on every ancestor in the deleted
      // member's sponsorChain BEYOND the direct sponsor (whose -1 was
      // already applied above). Each ancestor loses the deleted
      // member from their downline count.
      const tailAncestors = targetSponsorChain.slice(1);
      if (tailAncestors.length > 0) {
        await MlmMembership.updateMany(
          { userId: { $in: tailAncestors } },
          { $inc: { totalDownlineCount: -1 } },
          { session },
        );
      }

      // ---------- STEP 7 — auto-cancel pending withdrawals ----------
      const pendingWithdrawals = await MlmWithdrawalRequest.find(
        { userId: targetUserId, status: MLM_WITHDRAWAL_STATUS.PENDING },
        null,
        { session },
      );
      const withdrawalsCancelled = [];
      for (const w of pendingWithdrawals) {
        await rejectWithdrawalRequest({
          requestId: w._id,
          adminId,
          reason: `Auto-rejected: ${reason}`,
          session,
        });
        withdrawalsCancelled.push(String(w._id));
      }

      // ---------- STEP 8 — tombstone the membership and customer ----------
      const now = new Date();
      target.deletedAt = now;
      target.deletedBy = adminId;
      target.updatedBy = adminId;
      await target.save({ session });

      // `Customer.updateOne` isn't matched by the `/^find/` soft-
      // delete pre-hook, so the filter goes through as-is. We're
      // guarded against the "already tombstoned" case by the
      // `target.deletedAt` check above, so a plain `_id` match is
      // safe and correctly stamps the customer row even on the
      // first run.
      await Customer.updateOne(
        { _id: targetUserId },
        {
          $set: {
            deletedAt: now,
            deletedBy: adminId,
            updatedBy: adminId,
            isActive: false,
            "mlm.active": false,
          },
        },
        { session },
      );

      // Keep `Customer.mlm` projection consistent for any populated
      // reads that race after the transaction commits.
      await syncCustomerMlmProjection(targetUserId, { session });
      if (promoted) {
        await syncCustomerMlmProjection(promoted.userId, { session });
      }
      if (loser) {
        await syncCustomerMlmProjection(loser.userId, { session });
      }

      summary = {
        alreadyDeleted: false,
        membershipId: String(target._id),
        userId: String(targetUserId),
        deletedAt: now,
        promotion: promoted
          ? {
              promotedMembershipId: String(promoted._id),
              promotedUserId: String(promoted.userId),
              tookSlot: promoted.binaryPosition || null,
            }
          : null,
        spillover:
          loser && loserNewParent
            ? {
                loserMembershipId: String(loser._id),
                loserUserId: String(loser.userId),
                newParentMembershipId: String(loserNewParent._id),
                newParentUserId: String(loserNewParent.userId),
                position: loserOriginalPosition,
              }
            : null,
        directReferralsRemapped: directReferrals.length,
        sponsorChainEntriesPulled: downline.length,
        withdrawalsCancelled,
      };
    });
  } finally {
    await session.endSession();
  }
  return summary;
}

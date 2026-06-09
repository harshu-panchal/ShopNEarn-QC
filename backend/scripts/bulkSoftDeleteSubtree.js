/**
 * Bulk soft-delete every membership in a binary subtree, plus the
 * subtree root itself. Tombstones the linked Customer rows in the
 * same transaction. Differs from `mlmMemberSoftDeleteService`
 * (single-member delete with promotion) in that the WHOLE subtree
 * goes — there is no promotion because the chain itself is gone.
 *
 * Usage:
 *   node scripts/bulkSoftDeleteSubtree.js <referralCode>           # dry-run
 *   node scripts/bulkSoftDeleteSubtree.js <referralCode> --commit  # persist
 *   node scripts/bulkSoftDeleteSubtree.js <referralCode> --commit --allow-orphans
 *
 * Default behaviour:
 *   - Refuses if any subtree member has DIRECT REFERRALS that live
 *     OUTSIDE the subtree (would leave them dangling without a
 *     sponsor). Pass --allow-orphans to remap those referrals to
 *     the SUBTREE ROOT's own sponsor (same policy as the
 *     single-member delete).
 *   - Refuses if any subtree member has PENDING WITHDRAWAL
 *     requests. Pass --cancel-withdrawals to auto-reject them via
 *     the canonical reversal flow.
 *   - Refuses if any subtree member has NON-ZERO wallet balance.
 *     Pass --allow-balance to freeze the money on the tombstoned
 *     row (the audit trail stays intact; an admin can recover by
 *     restoring the row, since soft-delete is reversible).
 *
 * These guards are intentionally strict — a "yes I really mean it"
 * flag is cheaper than recovering from an accidental mass-delete.
 *
 * Strictly does NOT touch:
 *   - Wallet / Ledger / Commission events for tombstoned rows
 *     (unless --cancel-withdrawals is set, which only affects the
 *     PENDING withdrawal request flow).
 *   - leftLegDirectCount / rightLegDirectCount counters on upline
 *     (those are signup-time snapshots and have known drift; a
 *     dedicated recompute is the right tool, not this script).
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import MlmWithdrawalRequest from "../app/models/mlmWithdrawalRequest.js";
import Customer from "../app/models/customer.js";
import { MLM_WITHDRAWAL_STATUS } from "../app/constants/mlm.js";
import { rejectWithdrawalRequest } from "../app/services/mlm/mlmWithdrawalService.js";

const args = process.argv.slice(2);
const code = args.find((a) => !a.startsWith("--"));
const COMMIT          = args.includes("--commit");
const ALLOW_ORPHANS   = args.includes("--allow-orphans");
const CANCEL_PENDING  = args.includes("--cancel-withdrawals");
const ALLOW_BALANCE   = args.includes("--allow-balance");

if (!code) {
  console.error(
    "usage: node scripts/bulkSoftDeleteSubtree.js <referralCode> [--commit] [--allow-orphans] [--cancel-withdrawals] [--allow-balance]",
  );
  process.exit(2);
}

async function bfsBinarySubtree(rootUserId, session) {
  const visited = new Set([String(rootUserId)]);
  const order = [String(rootUserId)];
  let frontier = [String(rootUserId)];
  while (frontier.length) {
    const children = await MlmMembership.find(
      { binaryParentId: { $in: frontier } },
      { userId: 1, binaryParentId: 1 },
      { session },
    ).lean();
    const next = [];
    for (const c of children) {
      const cid = String(c.userId);
      if (visited.has(cid)) continue;
      visited.add(cid);
      next.push(cid);
      order.push(cid);
    }
    frontier = next;
  }
  return order;
}

class GuardError extends Error {
  constructor(msg) {
    super(msg);
    this.guard = true;
  }
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // ----- 1. Load root + parent -----
      const root = await MlmMembership.findOne(
        { referralCode: code.toUpperCase() },
        null,
        { session },
      ).populate("userId", "name");
      if (!root) throw new GuardError(`No membership with referralCode=${code}`);
      if (root.deletedAt) {
        console.log(`Root ${root.referralCode} is already soft-deleted.`);
        return;
      }
      const rootUid = root.userId._id;
      const parentMembership = root.binaryParentId
        ? await MlmMembership.findOne({ userId: root.binaryParentId }, null, {
            session,
          })
        : null;

      // ----- 2. BFS the binary subtree -----
      const subtreeUserIds = await bfsBinarySubtree(rootUid, session);
      const subtreeObjectIds = subtreeUserIds.map(
        (u) => new mongoose.Types.ObjectId(u),
      );
      const subtreeMembers = await MlmMembership.find(
        { userId: { $in: subtreeObjectIds } },
        null,
        { session },
      ).populate("userId", "name");

      console.log(`\nROOT: ${root.userId.name} [${root.referralCode}] uid=${rootUid}`);
      console.log(
        `PARENT: ${parentMembership ? `${parentMembership.userId} [pos was ${root.binaryPosition}]` : "(none)"}`,
      );
      console.log(`SUBTREE SIZE: ${subtreeMembers.length} (including root)`);

      // ----- 3. Guards -----

      // 3a. Outside-subtree direct referrals.
      const outsideOrphans = await MlmMembership.find(
        {
          sponsorId: { $in: subtreeObjectIds },
          userId: { $nin: subtreeObjectIds },
        },
        null,
        { session },
      );
      if (outsideOrphans.length && !ALLOW_ORPHANS) {
        throw new GuardError(
          `${outsideOrphans.length} direct referral(s) outside the subtree would lose their sponsor. ` +
            `Pass --allow-orphans to remap them to the subtree root's sponsor.`,
        );
      }

      // 3b. Pending withdrawals.
      const pendingWithdrawals = await MlmWithdrawalRequest.find(
        {
          userId: { $in: subtreeObjectIds },
          status: MLM_WITHDRAWAL_STATUS.PENDING,
        },
        null,
        { session },
      );
      if (pendingWithdrawals.length && !CANCEL_PENDING) {
        throw new GuardError(
          `${pendingWithdrawals.length} pending withdrawal(s) in subtree. ` +
            `Pass --cancel-withdrawals to auto-reject them.`,
        );
      }

      // 3c. Wallet balance.
      const customers = await Customer.find(
        { _id: { $in: subtreeObjectIds } },
        { _id: 1, walletBalance: 1, name: 1 },
        { session },
      );
      const withBalance = customers.filter((c) => (c.walletBalance || 0) > 0);
      if (withBalance.length && !ALLOW_BALANCE) {
        throw new GuardError(
          `${withBalance.length} customer(s) hold non-zero wallet balance. ` +
            `Pass --allow-balance to freeze the funds on the tombstoned rows.`,
        );
      }

      // ----- 4. Apply -----

      // 4a. Clear the parent's child pointer so no ghost pointer
      //     references the soon-to-be-deleted root.
      if (parentMembership) {
        let mutated = false;
        if (
          String(parentMembership.binaryLeftChildId) === String(rootUid)
        ) {
          parentMembership.binaryLeftChildId = null;
          mutated = true;
        }
        if (
          String(parentMembership.binaryRightChildId) === String(rootUid)
        ) {
          parentMembership.binaryRightChildId = null;
          mutated = true;
        }
        if (mutated) await parentMembership.save({ session });
      }

      // 4b. Remap outside-subtree direct referrals to the root's
      //     sponsor (if --allow-orphans is set).
      const rootSponsorId = root.sponsorId || null;
      const rootSponsorMembershipId = root.sponsorMembershipId || null;
      let remappedCount = 0;
      if (outsideOrphans.length && ALLOW_ORPHANS) {
        for (const o of outsideOrphans) {
          o.sponsorId = rootSponsorId;
          o.sponsorMembershipId = rootSponsorMembershipId;
          await o.save({ session });
          remappedCount += 1;
        }
      }

      // 4c. Strip every deleted userId from any sponsorChain that
      //     still references them (descendants of the subtree
      //     should be fully covered by step 4b, but the $pull is a
      //     defensive cleanup against historical drift).
      await MlmMembership.updateMany(
        { sponsorChain: { $in: subtreeObjectIds } },
        { $pull: { sponsorChain: { $in: subtreeObjectIds } } },
        { session },
      );

      // 4d. Auto-cancel pending withdrawals.
      let cancelledCount = 0;
      if (pendingWithdrawals.length && CANCEL_PENDING) {
        for (const w of pendingWithdrawals) {
          await rejectWithdrawalRequest({
            requestId: w._id,
            adminId: null, // script-initiated; no admin user.
            reason: `Bulk subtree soft-delete (root=${code})`,
            session,
          });
          cancelledCount += 1;
        }
      }

      // 4e. Tombstone every membership and every customer in the
      //     subtree, and clear their binary edges so no zombie
      //     pointers remain.
      const now = new Date();
      await MlmMembership.updateMany(
        { userId: { $in: subtreeObjectIds } },
        {
          $set: {
            deletedAt: now,
            // adminId is null (script-initiated). The MlmMembership
            // schema allows null `deletedBy`, matching the
            // single-member service when a script invokes it.
            deletedBy: null,
            updatedBy: null,
            binaryLeftChildId: null,
            binaryRightChildId: null,
          },
        },
        { session },
      );
      await Customer.updateMany(
        { _id: { $in: subtreeObjectIds } },
        {
          $set: {
            deletedAt: now,
            deletedBy: null,
            updatedBy: null,
            isActive: false,
            "mlm.active": false,
          },
        },
        { session },
      );

      // ----- 5. Post-condition summary -----
      console.log("\n--- SUMMARY ---");
      console.log(`  Tombstoned memberships : ${subtreeMembers.length}`);
      console.log(`  Tombstoned customers   : ${subtreeMembers.length}`);
      console.log(
        `  Parent pointer cleared : ${parentMembership ? "yes" : "no parent (root was top of tree)"}`,
      );
      console.log(`  Orphan referrals remap : ${remappedCount}`);
      console.log(`  Withdrawals cancelled  : ${cancelledCount}`);

      if (!COMMIT) {
        console.log("\n*** DRY-RUN — aborting (pass --commit to persist) ***");
        const dryRun = new Error("__DRY_RUN__");
        dryRun.dryRun = true;
        throw dryRun;
      }
    });

    if (COMMIT) {
      console.log("\n🎉 COMMITTED. Subtree soft-deleted atomically.");
    }
  } catch (err) {
    if (err.dryRun) {
      console.log("\n(Dry-run aborted. No changes written.)");
    } else if (err.guard) {
      console.error(`\n❌ ${err.message}`);
      process.exitCode = 1;
    } else {
      console.error("\n💥 UNEXPECTED ERROR:", err);
      process.exitCode = 1;
    }
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

/**
 * One-shot data repair — re-spill every slot-conflict loser into the
 * first empty slot down their declared leg.
 *
 * BACKGROUND
 *
 * The Plan A binary tree is denormalised twice:
 *
 *   • Bottom-up : every child carries `binaryParentId` + `binaryPosition`
 *   • Top-down  : every parent carries `binaryLeftChildId` /
 *                 `binaryRightChildId`
 *
 * A historical placement bug overwrote the parent's top-down pointer
 * on subsequent same-leg placements instead of spilling down the
 * existing chain. The result is that two (or more) members can both
 * claim the same slot — e.g. `binaryParentId = YASMIN, binaryPosition = L`.
 * The new bottom-up tree builder (`mlmBinaryTreeBuilder.js`) renders
 * only the winner of each conflict, so the losers (and their entire
 * subtrees) disappear from the visual tree.
 *
 * WHAT THIS DOES
 *
 * 1. Discovers all (parent, position) groups with more than one
 *    member that claims that slot — i.e. every drift the runtime
 *    builder is currently quietly resolving.
 * 2. Picks the same winner the builder does (largest subtree → wins;
 *    earliest joinedAt → tie-break; smallest _id → final tie-break).
 * 3. For every loser, walks DOWN the loser's declared leg from the
 *    contested parent (following same-direction children) until an
 *    empty slot is found, then atomically rewires
 *      • loser.binaryParentId             → new parent's userId
 *      • loser.binaryParentMembershipId   → new parent's _id
 *      • loser.binaryPosition             → unchanged (still L/R)
 *      • new parent's binaryLeftChildId / binaryRightChildId → loser.userId
 *    The loser's own subtree comes along for the ride — its members
 *    keep pointing at the loser via `binaryParentId`.
 *
 * Counters that are NOT touched (intentionally):
 *   • totalDownlineCount        — based on sponsor chain (unchanged)
 *   • directReferralsCount      — sponsor relationship (unchanged)
 *   • leftLegDirectCount / rightLegDirectCount — recorded at original
 *     placement time against `legUnderSponsor`, which is preserved
 *     because losers spill within the SAME leg of their original
 *     sponsor.
 *
 * Counters that are touched:
 *   • binaryParentId / binaryParentMembershipId / parent's child
 *     pointer on the rewired edge.
 *
 * USAGE
 *
 *   node scripts/repairBinarySlotConflicts.js                 # dry-run, all roots
 *   node scripts/repairBinarySlotConflicts.js --root=3HBQUC97 # dry-run, scoped to one root
 *   node scripts/repairBinarySlotConflicts.js --commit        # COMMIT to db, all roots
 *   node scripts/repairBinarySlotConflicts.js --root=3HBQUC97 --commit
 *
 * SAFETY
 *
 *   • Defaults to dry-run. `--commit` is required to mutate.
 *   • Each loser is repaired inside its own session.withTransaction()
 *     block so a partial failure cannot corrupt half a rewire.
 *   • Repairs run sequentially (not in parallel) so subsequent
 *     spillover walks see the updated chain produced by earlier
 *     repairs in the same run.
 */

import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";

const COMMIT = process.argv.includes("--commit");
const ROOT_REF = (
  process.argv.find((a) => a.startsWith("--root=")) || ""
).slice("--root=".length);

const MAX_SPILLOVER_HOPS = 500;

/**
 * Mirror the runtime builder's tie-break logic (see
 * `mlmBinaryTreeBuilder.js`):
 *   1. larger `totalDownlineCount` wins
 *   2. parent's denormalised top-down pointer (binaryLeftChildId /
 *      binaryRightChildId) matching the candidate wins — keeps the
 *      currently-rendered node in place when downlines tie
 *   3. earliest `joinedAt` wins
 *   4. smallest `_id` wins (deterministic)
 *
 * Mirroring is critical because the repair script must move the
 * SAME losers the runtime builder is currently hiding; otherwise we'd
 * silently swap which node appears in the tree.
 */
function pickWinner(members, parentDoc, position) {
  const topDownTarget = parentDoc
    ? position === "L"
      ? parentDoc.binaryLeftChildId
      : parentDoc.binaryRightChildId
    : null;
  const topDownStr = topDownTarget ? String(topDownTarget) : null;

  return [...members].sort((a, b) => {
    const aDown = a.totalDownlineCount || 0;
    const bDown = b.totalDownlineCount || 0;
    if (aDown !== bDown) return bDown - aDown;
    const aMatches = topDownStr && String(a.userId) === topDownStr;
    const bMatches = topDownStr && String(b.userId) === topDownStr;
    if (aMatches !== bMatches) return aMatches ? -1 : 1;
    const aT = a.joinedAt ? new Date(a.joinedAt).getTime() : Infinity;
    const bT = b.joinedAt ? new Date(b.joinedAt).getTime() : Infinity;
    if (aT !== bT) return aT - bT;
    return String(a._id) < String(b._id) ? -1 : 1;
  })[0];
}

/**
 * Build a winner-aware bottom-up children map for the scoped
 * descendants. This is identical in spirit to the production tree
 * builder: every parent maps to a `{ L, R }` slot containing the
 * canonical winner if there's a conflict, or the sole claimant if
 * not.
 *
 * Because the script mutates state inside the loop (a loser becomes
 * a winner of a deeper, currently-empty slot after we move them),
 * the caller updates this map in place after every repair.
 */
function buildChildrenByParentMap(descendants, parentDocByUserId) {
  const map = new Map();
  // Groups: parentKey|position → [members]
  const groups = new Map();
  for (const m of descendants) {
    if (!m.binaryParentId) continue;
    if (m.binaryPosition !== "L" && m.binaryPosition !== "R") continue;
    const key = `${String(m.binaryParentId)}|${m.binaryPosition}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const [key, members] of groups.entries()) {
    const [parentKey, position] = key.split("|");
    const parentDoc = parentDocByUserId.get(parentKey) || null;
    const winner = pickWinner(members, parentDoc, position);
    if (!map.has(parentKey)) map.set(parentKey, { L: null, R: null });
    map.get(parentKey)[position] = winner;
  }
  return map;
}

/**
 * Walk DOWN from `parent` following `direction` children, but use
 * the BOTTOM-UP `childrenByParent` map rather than the parent's
 * stale top-down pointers. Returns the first cursor whose `direction`
 * slot is empty in the map. Excludes the loser's own subtree so a
 * stale chain cannot make us try to place a loser under herself.
 */
function findFirstEmptySlotDownByMap({
  parent,
  direction,
  childrenByParent,
  excludeUserIdStr,
}) {
  let cursor = parent;
  for (let i = 0; i < MAX_SPILLOVER_HOPS; i += 1) {
    if (String(cursor.userId) === excludeUserIdStr) {
      throw new Error(
        `Spillover walk hit the loser itself (${excludeUserIdStr}) — cycle in binary tree?`,
      );
    }
    const slot = childrenByParent.get(String(cursor.userId));
    const childMember = slot ? slot[direction] : null;
    if (!childMember) return cursor;
    cursor = childMember;
  }
  throw new Error(
    `Spillover walk exceeded ${MAX_SPILLOVER_HOPS} hops from parent ${parent._id}`,
  );
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log(
    `\n${COMMIT ? "[COMMIT]" : "[DRY-RUN]"} Binary slot-conflict repair${ROOT_REF ? ` (scoped to root=${ROOT_REF})` : " (all roots)"}\n`,
  );

  let scope = {};
  if (ROOT_REF) {
    const root = await MlmMembership.findOne({
      referralCode: ROOT_REF.toUpperCase(),
    }).lean();
    if (!root) {
      console.error(`No membership with referralCode=${ROOT_REF}`);
      process.exit(1);
    }
    scope = { sponsorChain: root.userId };
  }

  // Pull the full scoped descendant set once. We need it both for
  // the winner-aware children map and to drive the spillover walk
  // entirely off bottom-up linkage (the top-down pointers are
  // exactly the field we're repairing — they can't be trusted as
  // input).
  const descendants = await MlmMembership.find(
    ROOT_REF ? scope : {},
    {
      _id: 1,
      userId: 1,
      referralCode: 1,
      binaryParentId: 1,
      binaryPosition: 1,
      binaryLeftChildId: 1,
      binaryRightChildId: 1,
      totalDownlineCount: 1,
      joinedAt: 1,
    },
  );
  console.log(`Scope holds ${descendants.length} membership(s).`);

  // Build a userId → membership-doc map so we can pass the parent's
  // top-down pointers into the tie-breaker. This keeps the in-memory
  // map of winners identical to what the runtime tree builder
  // computes.
  const parentDocByUserId = new Map();
  for (const m of descendants) {
    parentDocByUserId.set(String(m.userId), m);
  }

  const childrenByParent = buildChildrenByParentMap(
    descendants,
    parentDocByUserId,
  );

  // Discover contested slots by re-grouping the descendants in JS
  // (cheap; we already loaded them).
  const conflicts = [];
  const groupings = new Map();
  for (const m of descendants) {
    if (!m.binaryParentId) continue;
    if (m.binaryPosition !== "L" && m.binaryPosition !== "R") continue;
    const key = `${String(m.binaryParentId)}|${m.binaryPosition}`;
    if (!groupings.has(key)) groupings.set(key, []);
    groupings.get(key).push(m);
  }
  for (const [key, members] of groupings.entries()) {
    if (members.length < 2) continue;
    const [parentUserId, position] = key.split("|");
    conflicts.push({ parentUserId, position, members });
  }
  conflicts.sort((a, b) =>
    a.parentUserId < b.parentUserId ? -1 : 1,
  );

  if (conflicts.length === 0) {
    console.log("No slot conflicts found. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${conflicts.length} contested slot(s):\n`);

  let totalLosers = 0;
  let totalRepaired = 0;
  let totalFailed = 0;
  let totalStalePointersFixed = 0;

  // Helper: fetch a fresh membership doc (full, not lean) by userId
  // so we can pass it to the spillover walker as a cursor seed.
  const fetchByUserId = async (uid) =>
    MlmMembership.findOne({ userId: uid });

  for (const { parentUserId, position, members } of conflicts) {
    const parentDoc = await MlmMembership.findOne({ userId: parentUserId })
      .populate("userId", "name")
      .lean();
    const parentLabel =
      parentDoc?.referralCode || String(parentUserId).slice(-6);

    const winner = pickWinner(members, parentDoc, position);
    const losers = members.filter(
      (m) => String(m._id) !== String(winner._id),
    );
    totalLosers += losers.length;

    console.log(
      `Slot ${parentLabel}.${position} (${losers.length + 1} claimants):`,
    );
    console.log(
      `  ✓ keep  ${winner.referralCode} (downline=${winner.totalDownlineCount || 0})`,
    );

    // STEP 1 — normalise the parent's denormalised top-down pointer
    // so it agrees with the winner. The runtime tree builder
    // already favours bottom-up linkage so this is cosmetic, but it
    // also makes the spillover walk for subsequent losers correct
    // even if a future code path falls back to the top-down field.
    const childField =
      position === "L" ? "binaryLeftChildId" : "binaryRightChildId";
    const parentCurrentChildPointer = parentDoc
      ? parentDoc[childField]
      : null;
    if (
      parentDoc &&
      String(parentCurrentChildPointer) !== String(winner.userId)
    ) {
      console.log(
        `  ↻ parent.${childField}: ${parentCurrentChildPointer ? String(parentCurrentChildPointer).slice(-6) : "null"} → ${String(winner.userId).slice(-6)}`,
      );
      if (COMMIT) {
        await MlmMembership.updateOne(
          { _id: parentDoc._id },
          { $set: { [childField]: winner.userId } },
        );
      }
      totalStalePointersFixed += 1;
    }

    for (const loser of losers) {
      console.log(
        `  • move  ${loser.referralCode} (downline=${loser.totalDownlineCount || 0})`,
      );

      try {
        const originalParent = await fetchByUserId(parentUserId);
        if (!originalParent) {
          throw new Error(`Original parent ${parentUserId} not found`);
        }
        const newParentSeed = findFirstEmptySlotDownByMap({
          parent: originalParent,
          direction: position,
          childrenByParent,
          excludeUserIdStr: String(loser.userId),
        });
        // Resolve the seed to a populated doc for the label.
        const newParentDoc = await MlmMembership.findById(newParentSeed._id)
          .populate("userId", "name")
          .lean();
        const newParentLabel =
          newParentDoc?.referralCode || String(newParentSeed._id).slice(-6);

        console.log(
          `         → new parent: ${newParentLabel}.${position} (was empty)`,
        );

        if (COMMIT) {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              await MlmMembership.updateOne(
                { _id: loser._id },
                {
                  $set: {
                    binaryParentId: newParentSeed.userId,
                    binaryParentMembershipId: newParentSeed._id,
                    binaryPosition: position,
                  },
                },
                { session },
              );
              await MlmMembership.updateOne(
                { _id: newParentSeed._id },
                { $set: { [childField]: loser.userId } },
                { session },
              );
            });
          } finally {
            await session.endSession();
          }
          console.log(`         ✓ committed`);
        }

        // Update the in-memory map so the next loser (in this run)
        // sees the loser already placed at the new slot. The loser's
        // own subtree map entries don't need updating — they still
        // point at the loser via binaryParentId.
        const newParentKey = String(newParentSeed.userId);
        if (!childrenByParent.has(newParentKey)) {
          childrenByParent.set(newParentKey, { L: null, R: null });
        }
        // Build a lightweight "moved" membership stub so subsequent
        // walks treat it as the new slot occupant.
        childrenByParent.get(newParentKey)[position] = {
          ...loser,
          binaryParentId: newParentSeed.userId,
          binaryParentMembershipId: newParentSeed._id,
        };
        totalRepaired += 1;
      } catch (err) {
        console.log(`         ✗ FAILED: ${err.message}`);
        totalFailed += 1;
      }
    }
    console.log("");
  }

  console.log(
    `Summary: contested slots=${conflicts.length}, losers=${totalLosers}, ${COMMIT ? "committed" : "would-repair"}=${totalRepaired}, failed=${totalFailed}, stale parent pointers ${COMMIT ? "fixed" : "to-fix"}=${totalStalePointersFixed}`,
  );
  if (!COMMIT) {
    console.log("\nRe-run with --commit to apply.");
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Repair script crashed:", err);
  process.exit(1);
});

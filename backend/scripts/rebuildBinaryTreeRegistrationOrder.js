/**
 * Rebuild binary tree placement within a root's subtree by replaying every
 * member's signup in registration order (Customer.createdAt).
 *
 * Uses each member's `pendingSponsorLeg` (captured at signup) and the same
 * same-leg spine spill rules as production (`findSameLegSpineLegSlot`).
 *
 * WHY THIS EXISTS
 * ---------------
 * `repairBinarySlotConflicts.js` only fixes two members claiming the SAME
 * slot. Replays the entire subtree in registration order when placement
 * drifted from the chosen-leg spine model.
 *
 * USAGE
 *   node scripts/rebuildBinaryTreeRegistrationOrder.js --root=SEW2YHR3Y6
 *   node scripts/rebuildBinaryTreeRegistrationOrder.js --root=SEW2YHR3Y6 --commit
 *   node scripts/rebuildBinaryTreeRegistrationOrder.js --all-roots --commit
 *
 * SAFETY
 *   • Defaults to dry-run. Pass `--commit` to persist.
 *   • Does NOT recalculate leftLegDirectCount / pair bonuses — run a
 *     separate counter rebuild if finance teams need exact leg counts.
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import MlmMembership from "../app/models/mlmMembership.js";
import Customer from "../app/models/customer.js";
import {
  findSameLegSpineSlotSync,
  getMemberRegistrationTime,
  legSideKey,
} from "../app/utils/mlmBinaryTreeOrder.js";

dotenv.config();

const COMMIT = process.argv.includes("--commit");
const ALL_ROOTS = process.argv.includes("--all-roots");
const ROOT_REF = (
  process.argv.find((a) => a.startsWith("--root=")) || ""
).slice("--root=".length);

if (!ALL_ROOTS && !ROOT_REF) {
  console.error(
    "Usage: node scripts/rebuildBinaryTreeRegistrationOrder.js --root=REF [--commit]",
  );
  console.error(
    "   or: node scripts/rebuildBinaryTreeRegistrationOrder.js --all-roots [--commit]",
  );
  process.exit(1);
}

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 19);
}

function findSpineSlot(sponsor, leg, byUserId) {
  return findSameLegSpineSlotSync(sponsor, leg, (uid) =>
    byUserId.get(String(uid)),
  );
}

function inferLegUnderSponsor(member, sponsor, snapshotByUserId) {
  if (!member || !sponsor) return null;
  const sponsorUid = String(sponsor._uid || sponsor.userId);
  let cur = member;
  while (cur && String(cur.binaryParentId) !== sponsorUid) {
    cur = snapshotByUserId.get(String(cur.binaryParentId));
  }
  if (!cur) return null;
  return cur.binaryPosition === "R" ? "R" : "L";
}

function applyPlacement(child, parent, position) {
  child.binaryParentId = parent._uid;
  child.binaryParentMembershipId = parent._id;
  child.binaryPosition = position;
  const field = legSideKey(position);
  parent[field] = child._uid;
}

function printDirectLegChain(root, leg, byUserId, custByUserId, depth = 4) {
  const sideKey = legSideKey(leg);
  const rootUid = String(root._uid || root.userId);
  const lines = [];
  let cur = byUserId.get(String(root[sideKey]));
  let level = 1;
  while (cur && level <= depth) {
    const c = custByUserId.get(cur._uid || String(cur.userId));
    lines.push(
      `  ${"  ".repeat(level - 1)}${leg} ${c?.userId || "?"} ${(c?.name || "").slice(0, 22)} reg ${fmt(c?.createdAt)}`,
    );
    cur = byUserId.get(String(cur[sideKey]));
    level += 1;
  }
  if (lines.length === 0 && root[sideKey]) {
    lines.push(`  (${leg} child id ${root[sideKey]} not in scope map)`);
  }
  return lines.join("\n") || "  (empty)";
}

async function rebuildNetwork({ commit }) {
  const allMembersLean = await MlmMembership.find({}).lean();
  const allCustomers = await Customer.find(
    {},
    "userId name createdAt pendingSponsorLeg pendingSponsorReferralCode",
  ).lean();

  const custByUserId = new Map(allCustomers.map((c) => [String(c._id), c]));
  const memByReferral = new Map(
    allMembersLean.map((m) => [String(m.referralCode).toUpperCase(), m]),
  );

  const byUserId = new Map();
  for (const m of allMembersLean) {
    const copy = { ...m, _uid: String(m.userId) };
    byUserId.set(copy._uid, copy);
    const c = custByUserId.get(copy._uid);
    if (c) {
      copy.userId = { _id: copy._uid, createdAt: c.createdAt };
    }
  }

  const snapshotByUserId = new Map();
  for (const m of byUserId.values()) {
    snapshotByUserId.set(m._uid, { ...m, userId: m._uid });
  }

  const rootUids = new Set(
    [...byUserId.values()]
      .filter((m) => !m.binaryParentId)
      .map((m) => m._uid),
  );

  const oldParent = new Map();
  for (const [uid, m] of snapshotByUserId) {
    oldParent.set(uid, String(m.binaryParentId || ""));
  }

  function resolvePlacementSponsor(member, cust) {
    let sponsor = byUserId.get(String(member.sponsorId));
    if (sponsor) return sponsor;

    const pendingRef = String(cust?.pendingSponsorReferralCode || "").toUpperCase();
    if (pendingRef) {
      const sponsorLean = memByReferral.get(pendingRef);
      if (sponsorLean) {
        sponsor = byUserId.get(String(sponsorLean.userId));
        if (sponsor) return sponsor;
      }
    }
    return null;
  }

  for (const m of byUserId.values()) {
    m.binaryLeftChildId = null;
    m.binaryRightChildId = null;
    if (!rootUids.has(m._uid)) {
      m.binaryParentId = null;
      m.binaryParentMembershipId = null;
      m.binaryPosition = null;
    }
  }

  const toPlace = [...byUserId.values()]
    .filter((m) => !rootUids.has(m._uid))
    .sort(
      (a, b) => getMemberRegistrationTime(a) - getMemberRegistrationTime(b),
    );

  const skipped = [];
  const placed = [];
  let parentChanged = 0;

  for (const member of toPlace) {
    const cust = custByUserId.get(member._uid);
    const sponsor = resolvePlacementSponsor(member, cust);
    if (!sponsor) {
      skipped.push({ referralCode: member.referralCode, reason: "no sponsor" });
      continue;
    }

    let leg = cust?.pendingSponsorLeg;
    if (leg !== "L" && leg !== "R") {
      leg = inferLegUnderSponsor(
        snapshotByUserId.get(member._uid),
        snapshotByUserId.get(sponsor._uid),
        snapshotByUserId,
      );
    }
    if (leg !== "L" && leg !== "R") {
      skipped.push({
        referralCode: member.referralCode,
        reason: "no pendingSponsorLeg and could not infer leg",
      });
      continue;
    }

    const slot = findSpineSlot(sponsor, leg, byUserId);
    if (!slot) {
      skipped.push({
        referralCode: member.referralCode,
        reason: "no empty slot found",
      });
      continue;
    }

    applyPlacement(member, slot.parent, slot.position);
    placed.push(member.referralCode);
    if (oldParent.get(member._uid) !== String(member.binaryParentId || "")) {
      parentChanged += 1;
    }
  }

  console.log(
    `\nNetwork rebuild: roots=${rootUids.size} placed=${placed.length} skipped=${skipped.length} parentChanged=${parentChanged}`,
  );
  if (skipped.length) {
    console.log("\nSkipped (first 25):");
    for (const s of skipped.slice(0, 25)) {
      console.log(`  ${s.referralCode}: ${s.reason}`);
    }
  }

  if (!commit) {
    console.log("\nDry-run only. Re-run with --commit to persist.");
    return { placed: placed.length, skipped: skipped.length, parentChanged };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const m of byUserId.values()) {
        await MlmMembership.updateOne(
          { _id: m._id },
          {
            $set: {
              binaryParentId: m.binaryParentId || null,
              binaryParentMembershipId: m.binaryParentMembershipId || null,
              binaryPosition: m.binaryPosition || null,
              binaryLeftChildId: m.binaryLeftChildId || null,
              binaryRightChildId: m.binaryRightChildId || null,
            },
          },
          { session },
        );
      }
    });
    console.log(`\nCommitted ${byUserId.size} membership row(s).`);
  } finally {
    await session.endSession();
  }

  return { placed: placed.length, skipped: skipped.length, parentChanged };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  if (ALL_ROOTS) {
    console.log(
      `\n${COMMIT ? "[COMMIT]" : "[DRY-RUN]"} Rebuild entire network (same-leg spine spill)\n`,
    );
    await rebuildNetwork({ commit: COMMIT });
    await mongoose.disconnect();
    return;
  }

  console.log(
    `\n${COMMIT ? "[COMMIT]" : "[DRY-RUN]"} Rebuild binary tree by registration order (root=${ROOT_REF})\n`,
  );

  const rootCust = await Customer.findOne({
    userId: ROOT_REF.toUpperCase(),
  }).lean();
  if (!rootCust) {
    console.error(`No customer with userId=${ROOT_REF}`);
    process.exit(1);
  }

  const rootMemLean = await MlmMembership.findOne({ userId: rootCust._id }).lean();
  if (!rootMemLean) {
    console.error(`No membership for root ${ROOT_REF}`);
    process.exit(1);
  }

  const agg = await MlmMembership.aggregate([
    { $match: { userId: rootMemLean.userId } },
    {
      $graphLookup: {
        from: MlmMembership.collection.name,
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        maxDepth: 64,
      },
    },
  ]);

  const descendantLeans = agg[0]?.descendants || [];
  const scopeUserIds = [
    rootMemLean.userId,
    ...descendantLeans.map((d) => d.userId),
  ];

  const customers = await Customer.find(
    { _id: { $in: scopeUserIds } },
    "userId name createdAt pendingSponsorLeg pendingSponsorReferralCode",
  ).lean();
  const custByUserId = new Map(customers.map((c) => [String(c._id), c]));
  const memByReferral = new Map(
    [...descendantLeans, rootMemLean].map((m) => [
      String(m.referralCode).toUpperCase(),
      m,
    ]),
  );

  // Mutable in-memory copies keyed by stable user ObjectId string.
  const byUserId = new Map();
  const rootCopy = { ...rootMemLean, _uid: String(rootMemLean.userId) };
  byUserId.set(rootCopy._uid, rootCopy);
  for (const d of descendantLeans) {
    const copy = { ...d, _uid: String(d.userId) };
    byUserId.set(copy._uid, copy);
  }

  for (const m of byUserId.values()) {
    const c = custByUserId.get(m._uid);
    if (c) {
      m.userId = { _id: m._uid, createdAt: c.createdAt };
    }
  }

  // Snapshot before clearing — used for leg inference + before/after diff.
  const snapshotByUserId = new Map();
  for (const m of byUserId.values()) {
    snapshotByUserId.set(m._uid, { ...m, userId: m._uid });
  }

  const oldParent = new Map();
  for (const [uid, m] of snapshotByUserId) {
    oldParent.set(uid, String(m.binaryParentId || ""));
  }

  function resolvePlacementSponsor(member, cust) {
    let sponsor = byUserId.get(String(member.sponsorId));
    if (sponsor) return sponsor;

    const pendingRef = String(cust?.pendingSponsorReferralCode || "").toUpperCase();
    if (pendingRef) {
      const sponsorLean = memByReferral.get(pendingRef);
      if (sponsorLean) {
        sponsor = byUserId.get(String(sponsorLean.userId));
        if (sponsor) return sponsor;
      }
    }

    let cur = snapshotByUserId.get(member._uid);
    while (cur?.binaryParentId) {
      sponsor = byUserId.get(String(cur.binaryParentId));
      if (sponsor) return sponsor;
      cur = snapshotByUserId.get(String(cur.binaryParentId));
    }
    return null;
  }

  // Clear all binary edges in scope.
  for (const m of byUserId.values()) {
    m.binaryLeftChildId = null;
    m.binaryRightChildId = null;
    if (m._uid !== rootCopy._uid) {
      m.binaryParentId = null;
      m.binaryParentMembershipId = null;
      m.binaryPosition = null;
    }
  }

  const toPlace = [...byUserId.values()]
    .filter((m) => m._uid !== rootCopy._uid)
    .sort(
      (a, b) => getMemberRegistrationTime(a) - getMemberRegistrationTime(b),
    );

  const skipped = [];
  const placed = [];

  for (const member of toPlace) {
    const cust = custByUserId.get(member._uid);
    const sponsor = resolvePlacementSponsor(member, cust);
    if (!sponsor) {
      skipped.push({
        referralCode: member.referralCode,
        reason: "sponsor not in scope",
      });
      continue;
    }

    let leg = cust?.pendingSponsorLeg;
    if (leg !== "L" && leg !== "R") {
      leg = inferLegUnderSponsor(
        snapshotByUserId.get(member._uid),
        snapshotByUserId.get(sponsor._uid),
        snapshotByUserId,
      );
    }
    if (leg !== "L" && leg !== "R") {
      skipped.push({
        referralCode: member.referralCode,
        reason: "no pendingSponsorLeg and could not infer leg",
      });
      continue;
    }

    const slot = findSpineSlot(sponsor, leg, byUserId);
    if (!slot) {
      skipped.push({
        referralCode: member.referralCode,
        reason: "no empty slot found",
      });
      continue;
    }

    applyPlacement(member, slot.parent, slot.position);
    placed.push({
      referralCode: member.referralCode,
      reg: fmt(cust?.createdAt),
      leg,
      parent: slot.parent.referralCode,
      position: slot.position,
    });
  }

  console.log("=== BEFORE (left spine under root) ===");
  const beforeRoot = { ...rootMemLean, _uid: String(rootMemLean.userId) };
  console.log(printDirectLegChain(beforeRoot, "L", snapshotByUserId, custByUserId));

  console.log("\n=== AFTER (left spine under root) ===");
  console.log(printDirectLegChain(rootCopy, "L", byUserId, custByUserId));

  const moved = placed.filter((p) => {
    const m = byUserId.get(
      String(descendantLeans.find((d) => d.referralCode === p.referralCode)?.userId),
    );
    const uid = String(m?.userId);
    return oldParent.get(uid) !== String(m?.binaryParentId || "");
  });

  console.log(`\nPlaced: ${placed.length}, skipped: ${skipped.length}, parent changed: ${moved.length}`);
  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped.slice(0, 20)) {
      console.log(`  ${s.referralCode}: ${s.reason}`);
    }
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  console.log("\nSamad direct-left referrals (pendingSponsorLeg=L):");
  for (const m of toPlace.filter((x) => String(x.sponsorId) === rootCopy._uid)) {
    const c = custByUserId.get(m._uid);
    if (c?.pendingSponsorLeg !== "L") continue;
    const cur = byUserId.get(m._uid);
    const par = byUserId.get(String(cur.binaryParentId));
    console.log(
      `  ${c.userId} reg ${fmt(c.createdAt)} → parent ${par?.referralCode || "?"} . ${cur.binaryPosition}`,
    );
  }

  if (!COMMIT) {
    console.log("\nDry-run only. Re-run with --commit to persist.");
    await mongoose.disconnect();
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const m of byUserId.values()) {
        await MlmMembership.updateOne(
          { _id: m._id },
          {
            $set: {
              binaryParentId: m.binaryParentId || null,
              binaryParentMembershipId: m.binaryParentMembershipId || null,
              binaryPosition: m.binaryPosition || null,
              binaryLeftChildId: m.binaryLeftChildId || null,
              binaryRightChildId: m.binaryRightChildId || null,
            },
          },
          { session },
        );
      }
    });
    console.log(`\nCommitted ${byUserId.size} membership row(s).`);
  } finally {
    await session.endSession();
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Rebuild failed:", err);
  process.exit(1);
});

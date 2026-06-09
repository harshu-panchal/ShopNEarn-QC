/**
 * Read-only inspection — prints the current binary-tree state of a
 * comma-separated list of member names so an operator can plan a
 * subtree move (or any other manual restructure) without guessing.
 *
 * Usage:
 *   node scripts/inspectMemberMove.js "Abdulwahab A Shaikh,Yasminbanu A Shaikh,Samad shaikh,Akbar"
 *
 * For each match the script prints:
 *   - referralCode + userId + customer name
 *   - status / planType / deletedAt
 *   - binaryParent (userId + name) + binaryPosition under that parent
 *   - left / right children (userId + name) — pulled by ACTUAL
 *     binaryParentId linkage (bottom-up) rather than the parent's
 *     possibly-stale binaryLeftChildId / binaryRightChildId
 *     pointers, so the print matches what the genealogy canvas
 *     actually renders
 *   - totalDownlineCount + directReferralsCount
 *
 * Strictly read-only — no writes. Safe to run against production.
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";

const nameArg = process.argv[2];
if (!nameArg) {
  console.error(
    'usage: node scripts/inspectMemberMove.js "Name One,Name Two,Name Three"',
  );
  process.exit(2);
}

const names = nameArg
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function fmtMembership(m) {
  if (!m) return "—";
  const name = m.userId?.name || "(no customer)";
  const code = m.referralCode || "(no code)";
  const uid = m.userId?._id || m.userId;
  return `${name} [${code}] (userId=${uid})`;
}

async function findActualChild(parentUserId, position) {
  if (!parentUserId) return null;
  return MlmMembership.findOne({
    binaryParentId: parentUserId,
    binaryPosition: position,
  })
    .populate("userId", "name")
    .lean();
}

async function findByName(name) {
  // Case-insensitive exact-trim match on Customer.name, then walk
  // back to MlmMembership via userId. We use a regex anchored to
  // the full string so "Akbar" doesn't accidentally pull in
  // "Akbar Khan" or "Mohammed Akbar".
  const Customer = mongoose.model("User");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const customers = await Customer.find({
    name: { $regex: `^${escaped}$`, $options: "i" },
  })
    .select("_id name userId")
    .lean();
  if (customers.length === 0) {
    // Try a partial match as a fallback so the operator can still
    // see candidates when the spelling drifts.
    const partial = await Customer.find({
      name: { $regex: escaped, $options: "i" },
    })
      .select("_id name userId")
      .limit(5)
      .lean();
    return { exact: [], partial };
  }
  return { exact: customers, partial: [] };
}

async function inspect(name) {
  console.log("\n" + "=".repeat(80));
  console.log(`SEARCH: "${name}"`);
  console.log("=".repeat(80));

  const { exact, partial } = await findByName(name);
  if (exact.length === 0) {
    if (partial.length === 0) {
      console.log("  ❌ No customers match (exact OR partial).");
      return;
    }
    console.log("  ⚠️  No exact match. Partial matches (top 5):");
    for (const p of partial) {
      console.log(`     - "${p.name}" (userId=${p.userId || p._id})`);
    }
    return;
  }
  if (exact.length > 1) {
    console.log(`  ⚠️  ${exact.length} customers share this exact name:`);
    for (const c of exact) {
      console.log(`     - userId=${c.userId || c._id}`);
    }
  }

  for (const c of exact) {
    const m = await MlmMembership.findOne({ userId: c._id })
      .populate("userId", "name")
      .lean();
    if (!m) {
      console.log(`  ❌ No MlmMembership row for customer ${c._id}`);
      continue;
    }

    console.log(`\n  MEMBER: ${fmtMembership(m)}`);
    console.log(
      `    status=${m.status} planType=${m.planType} deletedAt=${m.deletedAt || "—"}`,
    );
    console.log(
      `    totalDownlineCount=${m.totalDownlineCount || 0}  directReferralsCount=${m.directReferralsCount || 0}`,
    );

    // ----- parent / position -----
    let parent = null;
    if (m.binaryParentId) {
      parent = await MlmMembership.findOne({ userId: m.binaryParentId })
        .populate("userId", "name")
        .lean();
    }
    console.log(
      `    binaryParent  : ${fmtMembership(parent)} on slot ${m.binaryPosition || "—"}`,
    );

    // ----- actual children (bottom-up linkage, ignores stale pointers) -----
    const [actualL, actualR] = await Promise.all([
      findActualChild(m.userId._id || m.userId, "L"),
      findActualChild(m.userId._id || m.userId, "R"),
    ]);
    console.log(`    actualLeft    : ${fmtMembership(actualL)}`);
    console.log(`    actualRight   : ${fmtMembership(actualR)}`);

    // ----- stale top-down pointer check (for drift visibility) -----
    if (m.binaryLeftChildId && (!actualL || String(actualL.userId?._id) !== String(m.binaryLeftChildId))) {
      console.log(
        `    ⚠️  binaryLeftChildId pointer (${m.binaryLeftChildId}) ≠ actualLeft.userId`,
      );
    }
    if (m.binaryRightChildId && (!actualR || String(actualR.userId?._id) !== String(m.binaryRightChildId))) {
      console.log(
        `    ⚠️  binaryRightChildId pointer (${m.binaryRightChildId}) ≠ actualRight.userId`,
      );
    }
  }
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });
  for (const n of names) {
    await inspect(n);
  }
  console.log("\nDONE.\n");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

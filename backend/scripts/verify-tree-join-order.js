import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";

dotenv.config();

const ROOT_PUB = process.argv[2] || "SEW2YHR3Y6";

function fmt(d) {
  if (!d) return "—";
  return new Date(d).toISOString().replace("T", " ").slice(0, 19);
}

function registrationDate(m, custById) {
  const c = custById[String(m.userId)] || {};
  return c.createdAt || m.createdAt || null;
}

await connectDB();

const rootCust = await Customer.findOne({ userId: ROOT_PUB }).lean();
if (!rootCust) {
  console.log("Root not found:", ROOT_PUB);
  process.exit(1);
}

const rootMem = await MlmMembership.findOne({ userId: rootCust._id }).lean();

const allInTree = await MlmMembership.aggregate([
  { $match: { userId: rootCust._id } },
  {
    $graphLookup: {
      from: MlmMembership.collection.name,
      startWith: "$userId",
      connectFromField: "userId",
      connectToField: "binaryParentId",
      as: "desc",
      maxDepth: 20,
    },
  },
  { $project: { desc: 1 } },
]);

const members = [rootMem, ...(allInTree[0]?.desc || [])];
const userIds = members.map((m) => m.userId);
const customers = await Customer.find(
  { _id: { $in: userIds } },
  "userId name createdAt",
).lean();
const custById = Object.fromEntries(customers.map((c) => [String(c._id), c]));

const byUser = Object.fromEntries(members.map((m) => [String(m.userId), m]));

function legLabel(child) {
  const pid = String(child.binaryParentId || "");
  const p = byUser[pid];
  if (!p) return "?";
  if (String(p.binaryLeftChildId) === String(child.userId)) return "L";
  if (String(p.binaryRightChildId) === String(child.userId)) return "R";
  return "spill?";
}

function depthFromRoot(userId, seen = new Set()) {
  let d = 0;
  let cur = byUser[String(userId)];
  while (cur && cur.binaryParentId) {
    const key = String(cur.userId);
    if (seen.has(key)) break;
    seen.add(key);
    d += 1;
    cur = byUser[String(cur.binaryParentId)];
  }
  return d;
}

const USE_REGISTRATION = process.argv.includes("--registration");

const rows = members
  .map((m) => {
    const c = custById[String(m.userId)] || {};
    const registeredAt = registrationDate(m, custById);
    const planAJoinedAt = m.planAJoinedAt || m.joinedAt || null;
    const sortDate = USE_REGISTRATION
      ? registeredAt
      : planAJoinedAt || registeredAt;
    return {
      pubId: c.userId || String(m.userId),
      name: (c.name || "").slice(0, 24),
      depth: depthFromRoot(m.userId),
      leg: m.userId.equals(rootCust._id) ? "ROOT" : legLabel(m),
      status: m.status,
      sortDate,
      registeredAt,
      planAJoinedAt,
      binaryParent: byUser[String(m.binaryParentId)]
        ? custById[String(m.binaryParentId)]?.userId
        : null,
    };
  })
  .sort((a, b) => new Date(a.sortDate || 0) - new Date(b.sortDate || 0));

console.log("=== ROOT:", ROOT_PUB, custById[String(rootCust._id)]?.name, "===");
console.log("Total in binary subtree:", rows.length);
console.log("");
const dateLabel = USE_REGISTRATION ? "registeredAt (UTC)" : "planAJoinedAt (UTC)";
console.log(`CHRONOLOGICAL (earliest ${USE_REGISTRATION ? "registration" : "Plan A join"} first):`);
console.log(
  `depth | leg  | pubId        | name                 | ${dateLabel.padEnd(26)} | parent`,
);
for (const r of rows) {
  console.log(
    String(r.depth).padStart(5),
    (r.leg || "").padEnd(4),
    (r.pubId || "").padEnd(12),
    (r.name || "").padEnd(22),
    fmt(USE_REGISTRATION ? r.registeredAt : r.planAJoinedAt),
    r.binaryParent || "",
  );
}

const FOCUS = [
  "SEW2YHR3Y6",
  "SE72567210",
  "SE5SX3GFX8",
  "SE14407570",
  "SEJC7RDHX5",
  "SE03177385",
  "SE92592488",
];
console.log("");
console.log("=== FOCUS MEMBERS (screenshot area) ===");
for (const id of FOCUS) {
  const r = rows.find((x) => x.pubId === id);
  if (!r) continue;
  console.log(
    `depth ${r.depth} ${r.leg} ${r.pubId} ${r.name} | registered ${fmt(r.registeredAt)} | planA ${fmt(r.planAJoinedAt)} | parent ${r.binaryParent || ""}`,
  );
}

console.log("");
console.log("=== BY TREE DEPTH (visual top-to-bottom) ===");
const byDepth = [...rows].sort(
  (a, b) => a.depth - b.depth || new Date(a.sortDate) - new Date(b.sortDate),
);
for (const r of byDepth) {
  console.log(
    "  ".repeat(r.depth) +
      `${r.leg} ${r.pubId} ${r.name} registered ${fmt(r.registeredAt)}`,
  );
}

console.log("");
const dateKind = USE_REGISTRATION ? "registered" : "Plan A joined";
console.log(`=== ANOMALY: child ${dateKind} BEFORE parent? ===`);
let childBeforeParent = 0;
for (const m of members) {
  if (!m.binaryParentId) continue;
  const child = m;
  const parent = byUser[String(m.binaryParentId)];
  if (!parent) continue;
  const cCust = custById[String(child.userId)];
  const pCust = custById[String(parent.userId)];
  const cDate = new Date(
    USE_REGISTRATION
      ? registrationDate(child, custById)
      : child.planAJoinedAt || child.joinedAt || cCust?.createdAt || 0,
  );
  const pDate = new Date(
    USE_REGISTRATION
      ? registrationDate(parent, custById)
      : parent.planAJoinedAt || parent.joinedAt || pCust?.createdAt || 0,
  );
  if (cDate < pDate) {
    childBeforeParent += 1;
    if (
      FOCUS.includes(cCust?.userId) ||
      FOCUS.includes(pCust?.userId)
    ) {
      console.log(
        "CHILD BEFORE PARENT:",
        cCust?.userId,
        dateKind,
        fmt(cDate),
        "< parent",
        pCust?.userId,
        fmt(pDate),
      );
    }
  }
}
console.log(`Total child-before-parent (${dateKind}): ${childBeforeParent}`);

console.log("");
console.log(`=== ANOMALY: earlier ${dateKind} shown DEEPER than later? ===`);
let depthInversions = 0;
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const earlier = rows[i];
    const later = rows[j];
    if (earlier.depth > later.depth) {
      depthInversions += 1;
    }
  }
}
console.log(`Total depth inversions vs ${dateKind} order: ${depthInversions}`);

process.exit(0);

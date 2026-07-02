/**
 * Dump raw ledger rows + commission events for one member and pinpoint
 * any wallet money that is NOT backed by a ledger row / commission event.
 *
 *   node scripts/dump-member-ledger.js SE12169918
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { MLM_COMMISSION_EVENT_STATUS } from "../app/constants/mlm.js";
import { OWNER_TYPE, LEDGER_DIRECTION } from "../app/constants/finance.js";

dotenv.config();

const code = process.argv[2] || "SE12169918";

function r2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function ts(d) {
  return d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) : "-";
}
// Best-effort bucket inference from ledger transaction type.
function bucketOf(type) {
  const t = String(type || "").toUpperCase();
  if (t.includes("SHOPPING") || t.includes("JOINING_PACKAGE")) return "shopping";
  if (t.includes("WITHDRAW") || t.includes("PAYOUT")) return "earnings";
  return "earnings"; // all MLM bonus credits land in earnings/pending
}

await connectDB();

const membership = await MlmMembership.findOne({ referralCode: code }).lean();
if (!membership) {
  console.error("Not found:", code);
  process.exit(1);
}
const userId = membership.userId;
const userOid = new mongoose.Types.ObjectId(userId);

const [wallet, ledger, events] = await Promise.all([
  Wallet.findOne({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: userId }).lean(),
  LedgerEntry.find({ actorType: OWNER_TYPE.CUSTOMER, actorId: userOid })
    .sort({ createdAt: 1 })
    .lean(),
  MlmCommissionEvent.find({ recipientId: userId }).sort({ createdAt: 1 }).lean(),
]);

console.log(`\n========== ${code}  (userId ${userId}) ==========`);
console.log("WALLET:", {
  earnings: r2(wallet?.earningsBalance),
  shopping: r2(wallet?.shoppingBalance),
  pending: r2(wallet?.pendingBalance),
  available: r2(wallet?.availableBalance),
  cashInHand: r2(wallet?.cashInHand),
  totalCredited: r2(wallet?.totalCredited),
  totalDebited: r2(wallet?.totalDebited),
});
if (wallet?.meta && Object.keys(wallet.meta).length) {
  console.log("WALLET.meta:", wallet.meta);
}

// ── Ledger rows ────────────────────────────────────────────────────
console.log(`\n----- LEDGER ROWS (${ledger.length}) -----`);
const ledgerById = new Map(ledger.map((l) => [String(l._id), l]));
let ledgerCredit = 0;
let ledgerDebit = 0;
const ledgerByBucket = {};
for (const l of ledger) {
  const signed =
    l.direction === LEDGER_DIRECTION.CREDIT ? l.amount : -l.amount;
  if (l.direction === LEDGER_DIRECTION.CREDIT) ledgerCredit += l.amount;
  else ledgerDebit += l.amount;
  const b = bucketOf(l.type);
  ledgerByBucket[b] = r2((ledgerByBucket[b] || 0) + signed);
  console.log(
    `${ts(l.createdAt)} | ${l.direction.padEnd(6)} | ${String(l.amount).padStart(7)} | ${b.padEnd(8)} | ${l.type} | ref=${l.reference || "-"} | idem=${l.idempotencyKey || "-"}`,
  );
}
console.log("Ledger totals:", {
  credit: r2(ledgerCredit),
  debit: r2(ledgerDebit),
  net: r2(ledgerCredit - ledgerDebit),
  byBucket: ledgerByBucket,
});

// ── Commission events ──────────────────────────────────────────────
console.log(`\n----- COMMISSION EVENTS (${events.length}) -----`);
let eventEarn = 0;
let eventShop = 0;
const eventsMissingLedger = [];
for (const e of events) {
  const linked = e.ledgerEntryId ? ledgerById.get(String(e.ledgerEntryId)) : null;
  const backed = !!linked;
  if (e.status === MLM_COMMISSION_EVENT_STATUS.CREDITED) {
    if (["earnings", "pending"].includes(e.walletBucket))
      eventEarn += e.cappedAmount || 0;
    else if (e.walletBucket === "shopping") eventShop += e.cappedAmount || 0;
    if (!backed) eventsMissingLedger.push(e);
  }
  console.log(
    `${ts(e.createdAt)} | ${String(e.status).padEnd(10)} | ${e.walletBucket.padEnd(8)} | ${String(e.cappedAmount).padStart(6)} | ${e.bonusType} | ledger=${backed ? "yes" : "MISSING"} | idem=${e.idempotencyKey || "-"}`,
  );
}
console.log("Credited event totals:", {
  earningsBucket: r2(eventEarn),
  shoppingBucket: r2(eventShop),
});

// ── Reconciliation ─────────────────────────────────────────────────
const walletEarn = r2(wallet?.earningsBalance);
const walletShop = r2(wallet?.shoppingBalance);
const walletPend = r2(wallet?.pendingBalance);
const walletTotal = r2(walletEarn + walletShop + walletPend);
const ledgerNet = r2(ledgerCredit - ledgerDebit);

console.log(`\n----- RECONCILIATION -----`);
console.log({
  walletEarningsPlusPending: r2(walletEarn + walletPend),
  creditedEventsEarnings: r2(eventEarn),
  earningsGap: r2(walletEarn + walletPend - eventEarn),
  walletShopping: walletShop,
  creditedEventsShopping_plusJoining: "see ledger shopping bucket",
  walletTotal,
  ledgerNet,
  walletMinusLedger: r2(walletTotal - ledgerNet),
});

if (eventsMissingLedger.length) {
  console.log(
    `\n⚠ ${eventsMissingLedger.length} CREDITED event(s) have NO linked ledger row:`,
  );
  for (const e of eventsMissingLedger)
    console.log(`   ${ts(e.createdAt)} ${e.bonusType} ${e.cappedAmount} idem=${e.idempotencyKey}`);
} else {
  console.log("\n✓ Every CREDITED event is linked to a ledger row.");
}

// Ledger rows not referenced by any event (joining credits, manual, etc.)
const eventLedgerIds = new Set(
  events.filter((e) => e.ledgerEntryId).map((e) => String(e.ledgerEntryId)),
);
const ledgerOnly = ledger.filter((l) => !eventLedgerIds.has(String(l._id)));
console.log(`\n----- LEDGER ROWS WITH NO COMMISSION EVENT (${ledgerOnly.length}) -----`);
for (const l of ledgerOnly)
  console.log(`   ${ts(l.createdAt)} ${l.direction} ${l.amount} ${l.type} ref=${l.reference || "-"}`);

await mongoose.connection.close();

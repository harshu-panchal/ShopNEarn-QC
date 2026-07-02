/**
 * Classify every MLM member as SEEDED vs GENUINE.
 *
 * The definitive signal: the bonus engine ALWAYS writes a LedgerEntry alongside
 * every wallet credit. So a member whose wallet holds money but has ZERO ledger
 * entries (or a wallet balance that does not match its own ledger) was created by
 * a direct seed/import that bypassed the ledger. A member whose wallet matches its
 * ledger was built organically through the real flows.
 *
 *   node scripts/classify-seeded-vs-genuine.js
 *   node scripts/classify-seeded-vs-genuine.js --out report.json   (write full list)
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import fs from "fs";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import { MLM_COMMISSION_EVENT_STATUS } from "../app/constants/mlm.js";
import { OWNER_TYPE, LEDGER_DIRECTION } from "../app/constants/finance.js";

dotenv.config();

const TOL = 1; // ₹1
const outIdx = process.argv.indexOf("--out");
const OUT_FILE = outIdx >= 0 ? process.argv[outIdx + 1] : null;

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function main() {
  await connectDB();

  const members = await MlmMembership.find(
    {},
    { userId: 1, referralCode: 1, status: 1, createdAt: 1 },
  ).lean();

  const codeByUser = new Map(
    members.map((m) => [String(m.userId), m.referralCode || String(m.userId)]),
  );

  const [wallets, ledgerRows, eventRows] = await Promise.all([
    Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER }).lean(),
    // LedgerEntry keys off actorType/actorId (there is NO ownerType/bucket
    // field on this schema). Net credit-minus-debit per actor + entry count.
    LedgerEntry.aggregate([
      { $match: { actorType: OWNER_TYPE.CUSTOMER } },
      {
        $group: {
          _id: "$actorId",
          net: {
            $sum: {
              $cond: [
                { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
                "$amount",
                { $multiply: ["$amount", -1] },
              ],
            },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    MlmCommissionEvent.aggregate([
      { $match: { status: MLM_COMMISSION_EVENT_STATUS.CREDITED } },
      { $group: { _id: "$recipientId", count: { $sum: 1 } } },
    ]),
  ]);

  const walletByUser = new Map(
    wallets.map((w) => [
      String(w.ownerId),
      {
        earnings: round2(w.earningsBalance),
        shopping: round2(w.shoppingBalance),
        pending: round2(w.pendingBalance),
      },
    ]),
  );

  // actorId -> { count, net }
  const ledgerByUser = new Map(
    ledgerRows.map((r) => [
      String(r._id),
      { count: Number(r.count) || 0, net: round2(r.net) },
    ]),
  );

  const eventCountByUser = new Map(
    eventRows.map((r) => [String(r._id), Number(r.count) || 0]),
  );

  const buckets = {
    GENUINE: [],
    MIXED: [],
    SEEDED: [],
    SEEDED_EMPTY: [],
  };

  for (const m of members) {
    const uid = String(m.userId);
    const code = codeByUser.get(uid) || uid;
    const wallet = walletByUser.get(uid) || {
      earnings: 0,
      shopping: 0,
      pending: 0,
    };
    const ledger = ledgerByUser.get(uid) || { count: 0, net: 0 };
    const eventCount = eventCountByUser.get(uid) || 0;

    const walletTotal = round2(
      wallet.earnings + wallet.shopping + wallet.pending,
    );

    const rec = {
      referralCode: code,
      userId: uid,
      status: m.status,
      createdAt: m.createdAt,
      ledgerEntries: ledger.count,
      ledgerNet: round2(ledger.net),
      creditedEvents: eventCount,
      wallet,
    };

    const walletVsLedgerGap = round2(walletTotal - ledger.net);
    rec.walletVsLedgerGap = walletVsLedgerGap;

    if (ledger.count > 0) {
      // Has real ledger rows → built through the actual money flows.
      if (Math.abs(walletVsLedgerGap) > TOL) {
        buckets.MIXED.push(rec); // ledger-backed but wallet drifted from ledger net
      } else {
        buckets.GENUINE.push(rec); // ledger-backed and consistent
      }
    } else {
      // Zero ledger rows for this actor.
      if (walletTotal <= TOL && eventCount === 0) {
        buckets.SEEDED_EMPTY.push(rec); // registered skeleton, no money & no ledger
      } else {
        buckets.SEEDED.push(rec); // has money and/or events but no ledger → seeded/imported
      }
    }
  }

  const memberUserIds = new Set(members.map((m) => String(m.userId)));
  const membersWithLedger = members.filter(
    (m) => (ledgerByUser.get(String(m.userId))?.count || 0) > 0,
  ).length;
  const ledgerActorsNotMembers = [...ledgerByUser.keys()].filter(
    (id) => !memberUserIds.has(id),
  ).length;

  const summary = {
    scannedAt: new Date().toISOString(),
    membersScanned: members.length,
    membersWithLedgerEntries: membersWithLedger,
    membersWithZeroLedgerEntries: members.length - membersWithLedger,
    ledgerActorsNotInMembership: ledgerActorsNotMembers,
    classification: {
      GENUINE: buckets.GENUINE.length,
      GENUINE_WITH_DRIFT_MIXED: buckets.MIXED.length,
      SEEDED: buckets.SEEDED.length,
      SEEDED_EMPTY: buckets.SEEDED_EMPTY.length,
    },
    legend: {
      GENUINE:
        "Ledger-backed and wallet total matches ledger net — organic, healthy.",
      MIXED:
        "Ledger-backed (genuine) but wallet total drifted from ledger net — real member, needs a small reconciliation.",
      SEEDED:
        "Wallet has money and/or credited events but ZERO ledger entries — written directly, bypassing the ledger.",
      SEEDED_EMPTY:
        "No wallet money, no events, no ledger — registered skeleton account (typically unpaid/registered).",
    },
    samples: {
      GENUINE: buckets.GENUINE.slice(0, 5),
      MIXED: buckets.MIXED.sort(
        (a, b) => Math.abs(b.walletVsLedgerGap) - Math.abs(a.walletVsLedgerGap),
      ).slice(0, 25),
      SEEDED: buckets.SEEDED.slice(0, 10),
    },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (OUT_FILE) {
    fs.writeFileSync(OUT_FILE, JSON.stringify(buckets, null, 2));
    console.log(`\nFull classification written to ${OUT_FILE}`);
  }

  await mongoose.connection.close();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});

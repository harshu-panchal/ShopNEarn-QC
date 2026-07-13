/**
 * Audit: active Plan A members missing ₹5000 joining shopping credit.
 *
 * Usage: node scripts/audit-active-plan-a-missing-5000.js
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import {
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";

function hasJoiningCreditLedger(ledgerRows) {
  return ledgerRows.some(
    (row) =>
      row.type === LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT
      || row.description === "Plan A Activation Bonus"
      || String(row.idempotencyKey || "").startsWith(
        `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-`,
      )
      || String(row.idempotencyKey || "").startsWith("MLM-JPC-"),
  );
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const cfg = await getMlmConfig();
  const expectedCredit = Number(cfg.joiningPackageShoppingWalletCredit) || 5000;

  const activePlanA = await MlmMembership.find({
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  })
    .select({ userId: 1, planAJoinedAt: 1, createdAt: 1 })
    .lean();

  const userIds = activePlanA.map((m) => m.userId);
  const customers = await Customer.find({ _id: { $in: userIds } })
    .select({ userId: 1, name: 1, phone: 1, deletedAt: 1 })
    .lean();
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const ledgers = await LedgerEntry.find({
    actorId: { $in: userIds },
    direction: "CREDIT",
    $or: [
      { type: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT },
      { description: "Plan A Activation Bonus" },
      { idempotencyKey: { $regex: /^MLM-JPC-/ } },
    ],
  })
    .select({ actorId: 1, type: 1, amount: 1, idempotencyKey: 1, description: 1 })
    .lean();

  const ledgerByUser = new Map();
  for (const row of ledgers) {
    const key = String(row.actorId);
    if (!ledgerByUser.has(key)) ledgerByUser.set(key, []);
    ledgerByUser.get(key).push(row);
  }

  const wallets = await Wallet.find({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: { $in: userIds },
  })
    .select({ ownerId: 1, shoppingBalance: 1 })
    .lean();
  const walletByUser = new Map(wallets.map((w) => [String(w.ownerId), w]));

  const credited = [];
  const missing = [];

  for (const membership of activePlanA) {
    const uid = String(membership.userId);
    const customer = customerById.get(uid);
    if (customer?.deletedAt) continue;

    const rows = ledgerByUser.get(uid) || [];
    const wallet = walletByUser.get(uid);
    const entry = {
      userId: customer?.userId || uid,
      name: customer?.name || null,
      phone: customer?.phone || null,
      membershipId: String(membership._id),
      planAJoinedAt: membership.planAJoinedAt || membership.createdAt,
      shoppingBalance: wallet?.shoppingBalance ?? 0,
      joiningCreditLedger: rows.map((r) => ({
        amount: r.amount,
        type: r.type,
        idempotencyKey: r.idempotencyKey,
      })),
    };

    if (hasJoiningCreditLedger(rows)) {
      credited.push(entry);
    } else {
      missing.push(entry);
    }
  }

  console.log(
    JSON.stringify(
      {
        expectedJoiningCredit: expectedCredit,
        totalActivePlanA: activePlanA.length,
        creditedWith5000Ledger: credited.length,
        missing5000Credit: missing.length,
        missingMembers: missing,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});

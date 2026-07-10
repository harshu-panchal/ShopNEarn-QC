/**
 * One-off fix: credit missing Plan A joining shopping wallet for a member.
 *
 * Usage:
 *   node scripts/credit-missing-plan-a-shopping.js SE75369933
 *   node scripts/credit-missing-plan-a-shopping.js SE75369933 --apply
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
import { MLM_IDEMPOTENCY_PREFIX, MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import { getMlmConfig } from "../app/services/mlm/mlmConfigService.js";

const targetUserId = process.argv[2];
const apply = process.argv.includes("--apply");

if (!targetUserId) {
  console.error("Usage: node scripts/credit-missing-plan-a-shopping.js <userId> [--apply]");
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);

  const customer = await Customer.findOne({ userId: targetUserId });
  if (!customer) {
    throw new Error(`Customer ${targetUserId} not found`);
  }

  const membership = await MlmMembership.findOne({ userId: customer._id });
  if (!membership) {
    throw new Error(`No MLM membership for ${targetUserId}`);
  }
  if (membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
    throw new Error(`Membership status is ${membership.status}, expected active`);
  }

  const cfg = await getMlmConfig();
  const amount = Number(cfg.joiningPackageShoppingWalletCredit) || 5000;

  const idempotencyKeys = [
    `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-ADMIN-${membership._id}`,
    `${MLM_IDEMPOTENCY_PREFIX.JOINING_PACKAGE_CREDIT}-FIX-${targetUserId}`,
  ];

  const existing = await LedgerEntry.findOne({
    actorId: customer._id,
    direction: "CREDIT",
    $or: [
      { idempotencyKey: { $in: idempotencyKeys } },
      { type: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT },
    ],
  }).lean();

  const wallet = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: customer._id,
  }).lean();

  console.log({
    userId: targetUserId,
    customerObjectId: String(customer._id),
    membershipId: String(membership._id),
    status: membership.status,
    planAJoinedAt: membership.planAJoinedAt,
    expectedCredit: amount,
    shoppingBalanceBefore: wallet?.shoppingBalance ?? 0,
    alreadyCredited: !!existing,
    existingLedger: existing
      ? {
          type: existing.type,
          amount: existing.amount,
          idempotencyKey: existing.idempotencyKey,
        }
      : null,
    apply,
  });

  if (existing) {
    console.log("No action needed — joining shopping credit already recorded.");
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log("Dry run only. Re-run with --apply to credit the wallet.");
    await mongoose.disconnect();
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await creditWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: customer._id,
        amount,
        bucket: "shopping",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
        ledgerReference: idempotencyKeys[1],
        ledgerDescription: "MLM joining package shopping wallet seed (missing credit fix)",
        idempotencyKey: idempotencyKeys[1],
        metadata: {
          mlmEvent: "JOINING_PACKAGE_ACTIVATED",
          fixScript: "credit-missing-plan-a-shopping",
          targetUserId,
          membershipId: String(membership._id),
        },
        syncUserWalletBalance: false,
      });
    });
  } finally {
    await session.endSession();
  }

  const walletAfter = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: customer._id,
  }).lean();

  console.log({
    credited: amount,
    shoppingBalanceAfter: walletAfter?.shoppingBalance ?? 0,
  });

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

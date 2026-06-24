/**
 * restore-first-pair-income-after-recalc.js
 *
 * Repairs sponsors whose earnings were zeroed by `recalc-mlm-earnings-wallet.js`
 * (MLM-EARN-RECALC-2026 / MLM-EARN-RECALC-TREE-2026) without re-crediting
 * first direct-pair referral activation income (₹200).
 *
 * Credits once per sponsor when:
 *   - An earnings-bucket recalc RESET debit exists for their wallet, and
 *   - They have at least one active direct on L and one on R, and
 *   - No FIRST-DIRECT-PAIR or prior restore ledger credit exists.
 *
 * Usage:
 *   node backend/scripts/restore-first-pair-income-after-recalc.js
 *   node backend/scripts/restore-first-pair-income-after-recalc.js --apply
 *   node backend/scripts/restore-first-pair-income-after-recalc.js --apply --verbose
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { classifyDirectReferralsByLegUnderRoot } from "../app/services/mlm/mlmBinaryTreeBuilder.js";
import {
  countDirectReferralLegPairsFromLegMap,
  directReferralActivationFirstPairIdempotencyKey,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { getDirectReferralActivationConfig } from "../app/services/mlm/mlmConfigService.js";
import { creditWallet } from "../app/services/finance/walletService.js";
import { syncCustomerMlmProjection } from "../app/services/mlm/mlmMembershipService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const MIGRATION_ID = "MLM-DRA-RESTORE-RECALC-2026";

function tag(...args) {
  console.log("[restore-first-pair-income-after-recalc]", ...args);
}

function restoreIdempotencyKey(userId) {
  return `${MIGRATION_ID}-${String(userId)}`;
}

async function ledgerExists(idempotencyKey, session) {
  const row = await LedgerEntry.findOne({ idempotencyKey: String(idempotencyKey) }).session(
    session || null,
  );
  return Boolean(row);
}

async function alreadyHasFirstPairIncomeCredit(userId, session) {
  const keys = [
    directReferralActivationFirstPairIdempotencyKey(userId),
    restoreIdempotencyKey(userId),
  ];
  const existingLedger = await LedgerEntry.findOne({
    idempotencyKey: { $in: keys },
    type: LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
  }).session(session || null);
  if (existingLedger) return true;

  const existingEvent = await MlmCommissionEvent.findOne({
    idempotencyKey: { $in: keys },
    status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
  }).session(session || null);
  return Boolean(existingEvent);
}

async function findRecalcAffectedUserIds() {
  const resets = await LedgerEntry.find({
    type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
    direction: "DEBIT",
    idempotencyKey: /^MLM-EARN-RECALC/,
  })
    .select("walletId idempotencyKey")
    .lean();

  const walletIds = [...new Set(resets.map((r) => String(r.walletId)).filter(Boolean))];
  if (!walletIds.length) return [];

  const wallets = await Wallet.find({
    _id: { $in: walletIds },
    ownerType: OWNER_TYPE.CUSTOMER,
  })
    .select("ownerId")
    .lean();

  return [...new Set(wallets.map((w) => String(w.ownerId)))];
}

async function loadDirectLegPairs(sponsorMembership) {
  const activeDirects = await MlmMembership.find({
    sponsorId: sponsorMembership.userId,
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
    planType: MLM_PLAN_TYPE.A,
  })
    .select("_id userId")
    .lean();

  const legByReferralId = await classifyDirectReferralsByLegUnderRoot({
    rootMembership: sponsorMembership,
    directReferrals: activeDirects,
  });
  return {
    activeDirects,
    legPairs: countDirectReferralLegPairsFromLegMap(activeDirects, legByReferralId),
  };
}

async function creditRestore({
  sponsorMembership,
  amount,
  session,
}) {
  const userId = sponsorMembership.userId;
  const idempotencyKey = restoreIdempotencyKey(userId);

  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
    amount,
    bucket: "earnings",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
    ledgerReference: idempotencyKey,
    ledgerDescription: "Restore first direct-pair income after earnings recalc",
    idempotencyKey,
    correlationId: MIGRATION_ID,
    metadata: {
      mlmEvent: "DIRECT_REFERRAL_ACTIVATION",
      migrationId: MIGRATION_ID,
      pairIndex: 1,
    },
    syncUserWalletBalance: false,
  });

  await MlmCommissionEvent.create(
    [
      {
        recipientId: userId,
        recipientMembershipId: sponsorMembership._id,
        sourceUserId: null,
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        planType: sponsorMembership.planType || MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: amount,
        rolloverAmount: 0,
        walletBucket: "earnings",
        ledgerEntryId: creditResult?.ledgerEntry?._id || null,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey,
        correlationId: MIGRATION_ID,
        description: "Restore first direct-pair income after earnings recalc",
        meta: {
          mlmEvent: "DIRECT_REFERRAL_ACTIVATION",
          migrationId: MIGRATION_ID,
          pairIndex: 1,
          restoreAfterRecalc: true,
        },
      },
    ],
    { session },
  );

  await syncCustomerMlmProjection(userId, { session });
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  const cfg = await getDirectReferralActivationConfig();
  if (!cfg.firstPair.enabled || cfg.firstPair.amount <= 0) {
    tag("Direct referral activation bonus is disabled or zero — aborting.");
    process.exit(1);
  }
  tag(`Restore amount per sponsor: ₹${cfg.firstPair.amount}`);

  const affectedUserIds = await findRecalcAffectedUserIds();
  tag(`Recalc-affected members found: ${affectedUserIds.length}`);

  const totals = {
    scanned: affectedUserIds.length,
    alreadyRestored: 0,
    pairNotComplete: 0,
    ineligible: 0,
    wouldCredit: 0,
    credited: 0,
    errors: 0,
    totalAmount: 0,
  };

  for (const userIdStr of affectedUserIds) {
    const sponsor = await MlmMembership.findOne({ userId: userIdStr })
      .select("_id userId referralCode status planType")
      .lean();

    if (!sponsor) {
      totals.ineligible += 1;
      if (VERBOSE) tag(`SKIP ${userIdStr} — no membership`);
      continue;
    }
    if (
      sponsor.status === MLM_MEMBERSHIP_STATUS.SUSPENDED
      || sponsor.status === MLM_MEMBERSHIP_STATUS.TERMINATED
    ) {
      totals.ineligible += 1;
      continue;
    }

    if (await alreadyHasFirstPairIncomeCredit(sponsor.userId)) {
      totals.alreadyRestored += 1;
      if (VERBOSE) tag(`SKIP ${sponsor.referralCode} — already has first-pair credit`);
      continue;
    }

    const { legPairs } = await loadDirectLegPairs(sponsor);
    if (legPairs.pairs < 1) {
      totals.pairNotComplete += 1;
      if (VERBOSE) {
        tag(
          `SKIP ${sponsor.referralCode} — first pair not complete (L=${legPairs.left} R=${legPairs.right})`,
        );
      }
      continue;
    }

    const amount = roundCurrency(cfg.firstPair.amount);

    if (!APPLY) {
      totals.wouldCredit += 1;
      totals.totalAmount += amount;
      if (VERBOSE) {
        tag(`WOULD CREDIT ${sponsor.referralCode} +₹${amount}`);
      }
      continue;
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (await alreadyHasFirstPairIncomeCredit(sponsor.userId, session)) {
          totals.alreadyRestored += 1;
          return;
        }
        if (await ledgerExists(restoreIdempotencyKey(sponsor.userId), session)) {
          totals.alreadyRestored += 1;
          return;
        }
        await creditRestore({
          sponsorMembership: sponsor,
          amount,
          session,
        });
      });
      totals.credited += 1;
      totals.totalAmount += amount;
      if (VERBOSE) tag(`OK ${sponsor.referralCode} +₹${amount}`);
    } catch (err) {
      totals.errors += 1;
      tag(`ERROR ${sponsor.referralCode}: ${err.message}`);
    } finally {
      await session.endSession();
    }
  }

  tag("Summary:", JSON.stringify(totals, null, 2));
  await mongoose.disconnect();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[restore-first-pair-income-after-recalc] FATAL:", err);
  process.exit(1);
});

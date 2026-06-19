/**
 * fix-mlm-wallet-mismatches.js
 *
 * Idempotent repair for MLM shopping-wallet drift and missing bonus credits:
 *   1. Credit missing self signup bonus (₹100 → shopping)
 *   2. Credit missing sponsor signup bonus (₹50 per direct referral → shopping)
 *   3. Credit missing Plan A activation shopping seed (₹5000 → active members)
 *   4. Reconcile wallet.shoppingBalance to ledger-derived net
 *
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/fix-mlm-wallet-mismatches.js
 *   node scripts/fix-mlm-wallet-mismatches.js --apply
 *   node scripts/fix-mlm-wallet-mismatches.js --apply --verbose
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
  LEDGER_DIRECTION,
  OWNER_TYPE,
} from "../app/constants/finance.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../app/constants/mlm.js";
import { creditWallet, debitWallet } from "../app/services/finance/walletService.js";
import { getSignupBonusConfig, getMlmConfig } from "../app/services/mlm/mlmConfigService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

const SHOPPING_CREDIT_TYPES = new Set([
  LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
  LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
  LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
  LEDGER_TRANSACTION_TYPE.MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT,
]);

const FIX_PLAN_A_PREFIX = "MLM-WALLET-FIX-PLANA";
const FIX_RECON_PREFIX = "MLM-WALLET-FIX-RECON";

function log(...args) {
  console.log("[fix-mlm-wallet-mismatches]", ...args);
}

async function ledgerExists(idempotencyKey, session) {
  if (!idempotencyKey) return false;
  const row = await LedgerEntry.findOne({ idempotencyKey: String(idempotencyKey) }).session(
    session || null,
  );
  return Boolean(row);
}

async function creditSignupBonus({
  recipientUserId,
  recipientMembership,
  amount,
  bonusType,
  ledgerType,
  idempotencyKey,
  ledgerDescription,
  sourceUserId,
  correlationId,
  session,
}) {
  if (await ledgerExists(idempotencyKey, session)) {
    return { skipped: true };
  }

  const creditResult = await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: recipientUserId,
    amount,
    bucket: "shopping",
    session,
    ledgerType,
    ledgerReference: idempotencyKey,
    ledgerDescription,
    idempotencyKey,
    correlationId,
    metadata: { mlmEvent: bonusType, fixScript: true },
    syncUserWalletBalance: false,
  });

  await MlmCommissionEvent.create(
    [
      {
        recipientId: recipientUserId,
        recipientMembershipId: recipientMembership?._id || null,
        sourceUserId: sourceUserId || null,
        bonusType,
        planType: MLM_PLAN_TYPE.A,
        baseAmount: amount,
        bonusAmount: amount,
        cappedAmount: amount,
        rolloverAmount: 0,
        walletBucket: "shopping",
        ledgerEntryId: creditResult?.ledgerEntry?._id || null,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        idempotencyKey,
        correlationId,
        description: ledgerDescription,
        meta: { fixScript: true },
      },
    ],
    { session },
  );

  return { credited: amount, after: creditResult?.after };
}

function isPlanALedgerRow(row) {
  if (row.type === LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT) return true;
  if (
    row.type === LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT &&
    /plan\s*a|activation|joining\s*package/i.test(row.description || "")
  ) {
    return true;
  }
  return false;
}

function isShoppingCreditRow(row) {
  if (row.direction !== LEDGER_DIRECTION.CREDIT) return false;
  if (SHOPPING_CREDIT_TYPES.has(row.type)) return true;
  if (row.type === LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT) {
    return /plan\s*a|activation|joining|shopping|reconciliation.*credit/i.test(
      row.description || "",
    );
  }
  if (row.type === LEDGER_TRANSACTION_TYPE.ADJUSTMENT) {
    return /shopping|signup|migration.*credit/i.test(row.description || "");
  }
  return false;
}

function isShoppingDebitRow(row) {
  if (row.direction !== LEDGER_DIRECTION.DEBIT) return false;
  // Pass-1 recon debits targeted phantom wallet inflation; they must not
  // reduce the bonus-derived expected balance (see cleanup script).
  if (String(row.idempotencyKey || "").startsWith("MLM-WALLET-FIX-RECON-")) {
    return false;
  }
  if (row.metadata?.bucketDrained === "shopping") return true;
  if (/shopping|checkout.*wallet|wallet.*checkout/i.test(row.description || "")) return true;
  if (
    row.type === LEDGER_TRANSACTION_TYPE.ADJUSTMENT ||
    row.type === LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT
  ) {
    return /shopping|phantom|reconciliation.*debit|migration.*debit/i.test(
      row.description || "",
    );
  }
  return false;
}

async function computeExpectedShopping(userId) {
  const rows = await LedgerEntry.find({
    actorId: userId,
    actorType: OWNER_TYPE.CUSTOMER,
  }).lean();

  let credits = 0;
  let debits = 0;
  for (const row of rows) {
    if (isShoppingCreditRow(row)) credits += row.amount || 0;
    if (isShoppingDebitRow(row)) debits += row.amount || 0;
  }
  return roundCurrency(credits - debits);
}

async function reconcileShoppingWallet(userId, session, totals) {
  const wallet = await Wallet.findOne({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
  }).session(session);

  if (!wallet) return;

  const expected = await computeExpectedShopping(userId);
  const actual = roundCurrency(wallet.shoppingBalance || 0);
  const gap = roundCurrency(actual - expected);

  if (Math.abs(gap) < 0.01) return;

  const correlationId = `wallet-fix-recon-${String(userId)}`;

  if (gap > 0) {
    const idempotencyKey = `${FIX_RECON_PREFIX}-DEBIT-${String(userId)}`;
    if (await ledgerExists(idempotencyKey, session)) {
      totals.reconSkipped += 1;
      return;
    }
    if (!APPLY) {
      totals.reconWouldDebit += 1;
      totals.reconDebitAmount += gap;
      if (VERBOSE) log(`WOULD DEBIT ₹${gap} shopping for ${String(userId)} (actual ₹${actual} > expected ₹${expected})`);
      return;
    }
    await debitWallet({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: userId,
      amount: gap,
      bucket: "shopping",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
      ledgerReference: idempotencyKey,
      ledgerDescription: "Wallet fix: remove phantom shopping balance (reconciliation)",
      idempotencyKey,
      correlationId,
      metadata: { fixScript: true, expectedShopping: expected, actualShopping: actual },
      syncUserWalletBalance: false,
    });
    totals.reconDebited += 1;
    totals.reconDebitAmount += gap;
    if (VERBOSE) log(`DEBITED ₹${gap} shopping for ${String(userId)}`);
    return;
  }

  const shortfall = roundCurrency(-gap);
  const idempotencyKey = `${FIX_RECON_PREFIX}-CREDIT-${String(userId)}`;
  if (await ledgerExists(idempotencyKey, session)) {
    totals.reconSkipped += 1;
    return;
  }
  if (!APPLY) {
    totals.reconWouldCredit += 1;
    totals.reconCreditAmount += shortfall;
    if (VERBOSE) log(`WOULD CREDIT ₹${shortfall} shopping for ${String(userId)} (actual ₹${actual} < expected ₹${expected})`);
    return;
  }
  await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: userId,
    amount: shortfall,
    bucket: "shopping",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
    ledgerReference: idempotencyKey,
    ledgerDescription: "Wallet fix: restore missing shopping balance (reconciliation)",
    idempotencyKey,
    correlationId,
    metadata: { fixScript: true, expectedShopping: expected, actualShopping: actual },
    syncUserWalletBalance: false,
  });
  totals.reconCredited += 1;
  totals.reconCreditAmount += shortfall;
  if (VERBOSE) log(`CREDITED ₹${shortfall} shopping for ${String(userId)}`);
}

async function main() {
  await connectDB();
  log(APPLY ? "APPLY mode" : "DRY-RUN mode");

  const signupCfg = await getSignupBonusConfig();
  const mlmCfg = await getMlmConfig();
  const planAAmount = Number(mlmCfg.joiningPackageShoppingWalletCredit) || 5000;

  log(
    `Config: self=₹${signupCfg.selfAmount} sponsor=₹${signupCfg.sponsorAmount} planA=₹${planAAmount}`,
  );

  const totals = {
    scanned: 0,
    selfCredited: 0,
    selfWouldCredit: 0,
    selfSkipped: 0,
    sponsorCredited: 0,
    sponsorWouldCredit: 0,
    sponsorSkipped: 0,
    planACredited: 0,
    planAWouldCredit: 0,
    planASkipped: 0,
    reconDebited: 0,
    reconWouldDebit: 0,
    reconDebitAmount: 0,
    reconCredited: 0,
    reconWouldCredit: 0,
    reconCreditAmount: 0,
    reconSkipped: 0,
    errors: 0,
  };

  const memberships = await MlmMembership.find({}).sort({ _id: 1 });

  // ── Phase 1: missing self bonuses ─────────────────────────────────
  for (const membership of memberships) {
    totals.scanned += 1;
    const userId = membership.userId;
    const selfKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SELF}-${String(userId)}`;

    try {
      const hasSelf = await LedgerEntry.exists({
        actorId: userId,
        type: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
        direction: LEDGER_DIRECTION.CREDIT,
      });

      if (!hasSelf && signupCfg.enabled && signupCfg.selfAmount > 0) {
        if (!APPLY) {
          totals.selfWouldCredit += 1;
          if (VERBOSE) log(`WOULD credit self ₹${signupCfg.selfAmount} → ${String(userId)}`);
        } else {
          const session = await mongoose.startSession();
          try {
            await session.withTransaction(async () => {
              const res = await creditSignupBonus({
                recipientUserId: userId,
                recipientMembership: membership,
                amount: signupCfg.selfAmount,
                bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SELF,
                ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
                idempotencyKey: selfKey,
                ledgerDescription: "MLM signup bonus — welcome credit (wallet fix backfill)",
                sourceUserId: membership.sponsorId || null,
                correlationId: `wallet-fix-self-${String(userId)}`,
                session,
              });
              if (res.skipped) totals.selfSkipped += 1;
              else totals.selfCredited += 1;
              if (!membership.signupBonusCreditedAt) {
                membership.signupBonusCreditedAt = new Date();
                await membership.save({ session });
              }
            });
          } finally {
            await session.endSession();
          }
          if (VERBOSE) log(`Credited self bonus → ${String(userId)}`);
        }
      }
    } catch (err) {
      totals.errors += 1;
      log(`ERROR self ${String(userId)}: ${err.message}`);
    }
  }

  // ── Phase 2: missing sponsor bonuses (per referral) ─────────────────
  for (const referral of memberships) {
    if (!referral.sponsorId || !signupCfg.enabled || signupCfg.sponsorAmount <= 0) continue;
    if (String(referral.sponsorId) === String(referral.userId)) continue;

    const sponsorKey = `${MLM_IDEMPOTENCY_PREFIX.SIGNUP_BONUS_SPONSOR}-${String(referral.sponsorId)}-${String(referral.userId)}`;

    try {
      const hasSponsor = await LedgerEntry.exists({ idempotencyKey: sponsorKey });
      if (hasSponsor) continue;

      if (!APPLY) {
        totals.sponsorWouldCredit += 1;
        if (VERBOSE) {
          log(
            `WOULD credit sponsor ₹${signupCfg.sponsorAmount} → ${String(referral.sponsorId)} for referral ${String(referral.userId)}`,
          );
        }
        continue;
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const sponsorMembership = await MlmMembership.findOne({
            userId: referral.sponsorId,
          }).session(session);

          const res = await creditSignupBonus({
            recipientUserId: referral.sponsorId,
            recipientMembership: sponsorMembership,
            amount: signupCfg.sponsorAmount,
            bonusType: MLM_BONUS_TYPE.SIGNUP_BONUS_SPONSOR,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
            idempotencyKey: sponsorKey,
            ledgerDescription: "MLM signup bonus — referral acquired (wallet fix backfill)",
            sourceUserId: referral.userId,
            correlationId: `wallet-fix-sponsor-${String(referral.sponsorId)}-${String(referral.userId)}`,
            session,
          });
          if (res.skipped) totals.sponsorSkipped += 1;
          else totals.sponsorCredited += 1;
        });
      } finally {
        await session.endSession();
      }
      if (VERBOSE) {
        log(`Credited sponsor bonus → ${String(referral.sponsorId)} for ${String(referral.userId)}`);
      }
    } catch (err) {
      totals.errors += 1;
      log(`ERROR sponsor ${String(referral.sponsorId)} ref ${String(referral.userId)}: ${err.message}`);
    }
  }

  // ── Phase 3: missing Plan A shopping seed (active members only) ───
  for (const membership of memberships) {
    if (membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE || planAAmount <= 0) continue;

    const userId = membership.userId;
    const planAKey = `${FIX_PLAN_A_PREFIX}-${String(userId)}`;

    try {
      const planARows = await LedgerEntry.find({
        actorId: userId,
        direction: LEDGER_DIRECTION.CREDIT,
      }).lean();
      const planACredited = planARows.some(isPlanALedgerRow);
      if (planACredited) continue;

      if (!APPLY) {
        totals.planAWouldCredit += 1;
        if (VERBOSE) log(`WOULD credit Plan A ₹${planAAmount} → ${String(userId)}`);
        continue;
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (await ledgerExists(planAKey, session)) {
            totals.planASkipped += 1;
            return;
          }
          await creditWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: userId,
            amount: planAAmount,
            bucket: "shopping",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
            ledgerReference: planAKey,
            ledgerDescription: "MLM joining package shopping wallet seed (wallet fix backfill)",
            idempotencyKey: planAKey,
            correlationId: `wallet-fix-plana-${String(userId)}`,
            metadata: { fixScript: true, mlmEvent: "JOINING_PACKAGE_ACTIVATED" },
            syncUserWalletBalance: false,
          });
          totals.planACredited += 1;
        });
      } finally {
        await session.endSession();
      }
      if (VERBOSE) log(`Credited Plan A → ${String(userId)}`);
    } catch (err) {
      totals.errors += 1;
      log(`ERROR planA ${String(userId)}: ${err.message}`);
    }
  }

  // ── Phase 4: reconcile shopping balance to ledger ─────────────────
  const userIds = [...new Set(memberships.map((m) => String(m.userId)))];
  for (const userId of userIds) {
    try {
      if (!APPLY) {
        const wallet = await Wallet.findOne({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: userId,
        }).lean();
        if (!wallet) continue;
        const expected = await computeExpectedShopping(userId);
        const actual = roundCurrency(wallet.shoppingBalance || 0);
        const gap = roundCurrency(actual - expected);
        if (Math.abs(gap) < 0.01) continue;
        if (gap > 0) {
          totals.reconWouldDebit += 1;
          totals.reconDebitAmount += gap;
        } else {
          totals.reconWouldCredit += 1;
          totals.reconCreditAmount += -gap;
        }
        if (VERBOSE) {
          log(`WOULD reconcile ${userId}: actual ₹${actual} expected ₹${expected} gap ₹${gap}`);
        }
        continue;
      }

      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          await reconcileShoppingWallet(userId, session, totals);
        });
      } finally {
        await session.endSession();
      }
    } catch (err) {
      totals.errors += 1;
      log(`ERROR recon ${userId}: ${err.message}`);
    }
  }

  log("Summary:", JSON.stringify(totals, null, 2));
  if (!APPLY) {
    log("Dry-run only — re-run with `--apply` to write fixes.");
  }

  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log("FATAL", err?.stack || err?.message || err);
  process.exit(1);
});

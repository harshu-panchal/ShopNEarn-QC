/**
 * backfill-asari-first-topup.js
 *
 * One-off correction for franchise partner "Asari shardaben"
 * (6a869f8511299322a16c668e), registered 2026-08-20. Her registration
 * deposit (₹50,000) was approved via the old code path, which created
 * no linked FranchiseWalletTopUp row — so admin manually credited her
 * wallet ₹100,000 (₹50,000 × the 2x multiplier) directly, bypassing
 * the top-up review pipeline entirely. That left her wallet funded but
 * gave admin no way to select/dispatch products against it, since the
 * dispatch flow only exists on FranchiseWalletTopUp approval.
 *
 * This script:
 *   1. Reverses the manual ₹100,000 credit (debit back to 0 — this is
 *      the entirety of her wallet history, confirmed via totalCredited).
 *   2. Creates the linked FranchiseWalletTopUp row (PENDING_REVIEW,
 *      isFirstTopup: true, amount: 50000) that the new
 *      `createFirstTopUpFromRegistration` code path would have created
 *      automatically had it existed at approval time.
 *
 * After this runs, she appears in Admin > Home Shoppy > Top-Ups with
 * the "1st Top-Up" badge, and admin can use the existing
 * "Select Products & Approve" flow — which re-credits the wallet
 * (₹50,000 × multiplier) AND dispatches the chosen products, exactly
 * as if the fixed code had handled her registration from the start.
 *
 * Usage:
 *   node backend/scripts/backfill-asari-first-topup.js              # dry-run
 *   node backend/scripts/backfill-asari-first-topup.js --apply      # write
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import FranchiseRegistrationPayment from "../app/models/franchiseRegistrationPayment.js";
import FranchiseWalletTopUp from "../app/models/franchiseWalletTopUp.js";
import Wallet from "../app/models/wallet.js";
import { OWNER_TYPE, LEDGER_TRANSACTION_TYPE } from "../app/constants/finance.js";
import { FRANCHISE_TOPUP_STATUS } from "../app/constants/franchise.js";
import { debitWallet } from "../app/services/finance/walletService.js";
import { getFranchiseConfig } from "../app/services/franchise/franchiseConfigService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const PARTNER_ID = "6a869f8511299322a16c668e";

async function main() {
  await connectDB();

  const partner = await FranchisePartner.findById(PARTNER_ID).lean();
  if (!partner) throw new Error("Partner not found");

  const payment = await FranchiseRegistrationPayment.findById(partner.registrationPaymentId).lean();
  if (!payment) throw new Error("Registration payment not found");

  const wallet = await Wallet.findOne({ ownerType: OWNER_TYPE.FRANCHISE, ownerId: PARTNER_ID }).lean();
  const idempotencyKey = `fr-topup-from-reg-${payment._id}`;
  const existingTopUp = await FranchiseWalletTopUp.findOne({ idempotencyKey }).lean();

  const summary = {
    apply: APPLY,
    partner: partner.displayName,
    hasCompletedFirstTopup: partner.hasCompletedFirstTopup,
    walletAvailableBalance: wallet?.availableBalance ?? 0,
    registrationAmount: payment.registrationPriceSnapshot,
    willDebitReversal: wallet?.availableBalance || 0,
    topUpAlreadyExists: !!existingTopUp,
  };

  if (existingTopUp) {
    console.log("[backfill-asari-first-topup] Linked top-up already exists; nothing to do.");
    console.table(summary);
    process.exit(0);
  }

  console.log(APPLY ? "[backfill-asari-first-topup] Applying..." : "[backfill-asari-first-topup] (dry-run)");
  console.table(summary);

  if (!APPLY) {
    process.exit(0);
  }

  if (wallet && wallet.availableBalance > 0) {
    const reversal = await debitWallet({
      ownerType: OWNER_TYPE.FRANCHISE,
      ownerId: PARTNER_ID,
      amount: wallet.availableBalance,
      bucket: "available",
      ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT,
      ledgerReference: `reversal-manual-adjustment-${partner._id}`,
      ledgerDescription: "Reversal: manual wallet credit superseded by proper first-topup dispatch flow",
      idempotencyKey: `fr-reversal-manual-${partner._id}`,
      metadata: { reason: "backfill-asari-first-topup", originalAmount: wallet.availableBalance },
      syncUserWalletBalance: false,
    });
    console.log("Reversed manual credit:", reversal.before, "->", reversal.after);
  }

  const cfg = await getFranchiseConfig();
  const topUp = await FranchiseWalletTopUp.create({
    franchisePartnerId: partner._id,
    userId: payment.customer,
    amount: payment.registrationPriceSnapshot,
    creditMultiplierSnapshot: Number(cfg.walletCreditMultiplier) || 2,
    status: FRANCHISE_TOPUP_STATUS.PENDING_REVIEW,
    paymentMode: payment.paymentMode,
    manualPaymentDetails: {
      transactionId: payment.manualPaymentDetails?.transactionId || "",
      screenshotUrl: payment.manualPaymentDetails?.screenshotUrl || "",
      paidAmount: payment.manualPaymentDetails?.paidAmount ?? null,
      submittedAt: payment.manualPaymentDetails?.submittedAt || null,
    },
    isFirstTopup: true,
    idempotencyKey,
  });
  console.log("Created linked top-up:", String(topUp._id));

  console.table({ ...summary, created: true });
  process.exit(0);
}

main().catch((error) => {
  console.error("[backfill-asari-first-topup] FAILED:", error);
  process.exit(1);
});

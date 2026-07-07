import crypto from "crypto";
import mongoose from "mongoose";

import MlmMembership from "../../models/mlmMembership.js";
import MlmUpgradePayment from "../../models/mlmUpgradePayment.js";
import {
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
  MLM_IDEMPOTENCY_PREFIX,
  MLM_UPGRADE_PAYMENT_MODE,
} from "../../constants/mlm.js";
import {
  LEDGER_TRANSACTION_TYPE,
  OWNER_TYPE,
} from "../../constants/finance.js";
import {
  PAYMENT_EVENT_SOURCE,
  PAYMENT_STATUS,
  canTransitionPaymentStatus,
} from "../../constants/payment.js";
import { debitWallet, getOrCreateWallet } from "../finance/walletService.js";
import { applyPlanBUpgrade } from "./mlmActivationService.js";
import { getManualQrConfig, getMlmConfig } from "./mlmConfigService.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import logger from "../logger.js";

const MERCHANT_ORDER_PREFIX = "MLM-UPG";

function buildUpgradeMerchantOrderId(paymentId) {
  return `${MERCHANT_ORDER_PREFIX}-${String(paymentId).slice(-12).toUpperCase()}`;
}

function buildClickIdempotencyKey(userId, paymentMethod) {
  return `mlm-upgrade-${paymentMethod}-${userId}-${crypto.randomBytes(6).toString("hex")}`;
}

function resolveUpgradeAmounts(cfg) {
  const topup = cfg.binaryTopupPairIncome || {};
  const payAmount = Number(topup.payAmount) || 0;
  const shoppingCredit =
    Number(topup.shoppingWalletCredit)
    || Number(cfg.premiumUpgradeShoppingWalletTopup)
    || 0;
  return { payAmount, shoppingCredit };
}

function resolveUpgradeEligibilityThreshold(cfg) {
  return Number(cfg.planBAutoUpgradeAtPlanALifetimeEarnings) || 0;
}

async function assertUpgradeEligible(membership, cfg) {
  if (!membership) {
    const err = new Error("MLM membership not found.");
    err.statusCode = 404;
    err.code = "MEMBERSHIP_NOT_FOUND";
    throw err;
  }
  if (membership.status !== MLM_MEMBERSHIP_STATUS.ACTIVE) {
    const err = new Error("Only active members can upgrade to Plan B.");
    err.statusCode = 422;
    err.code = "NOT_ACTIVE_MEMBER";
    throw err;
  }
  if (membership.planType !== MLM_PLAN_TYPE.A) {
    const err = new Error("You are already on Plan B or not eligible.");
    err.statusCode = 409;
    err.code = "ALREADY_PLAN_B";
    throw err;
  }
  const threshold = resolveUpgradeEligibilityThreshold(cfg);
  const lifetimePlanA = Number(membership.lifetimePlanAEarnings) || 0;
  if (threshold > 0 && lifetimePlanA < threshold) {
    const err = new Error(
      `You need at least ₹${threshold} lifetime Plan A earnings to upgrade.`,
    );
    err.statusCode = 422;
    err.code = "THRESHOLD_NOT_REACHED";
    throw err;
  }
}

async function transitionStatus(payment, {
  nextStatus,
  source,
  reason = "",
}) {
  const currentStatus = payment.status || PAYMENT_STATUS.CREATED;
  if (currentStatus === nextStatus) {
    await payment.save();
    return payment;
  }

  if (!canTransitionPaymentStatus(currentStatus, nextStatus)) {
    const err = new Error(
      `Invalid upgrade payment transition ${currentStatus} -> ${nextStatus}`,
    );
    err.statusCode = 409;
    throw err;
  }

  payment.status = nextStatus;
  payment.statusHistory.push({
    fromStatus: currentStatus,
    toStatus: nextStatus,
    source,
    reason,
    changedAt: new Date(),
  });
  if (nextStatus === PAYMENT_STATUS.CAPTURED) {
    payment.capturedAt = new Date();
  } else if (
    nextStatus === PAYMENT_STATUS.FAILED
    || nextStatus === PAYMENT_STATUS.CANCELLED
  ) {
    payment.failedAt = new Date();
    payment.failureReason = reason || payment.failureReason;
  }
  await payment.save();
  return payment;
}

async function applyUpgradeFromPayment(payment, { session } = {}) {
  if (payment.upgradeApplied) {
    return { upgraded: false, reason: "already_applied" };
  }

  const result = await applyPlanBUpgrade(payment.customer, { session });
  if (!result.upgraded && result.reason !== "not_eligible") {
    const err = new Error("Plan B upgrade could not be applied.");
    err.statusCode = 500;
    err.code = "UPGRADE_APPLY_FAILED";
    throw err;
  }

  payment.upgradeApplied = true;
  payment.upgradeCompletedAt = new Date();
  payment.upgradeError = null;
  await payment.save({ session });

  return result;
}

async function runInSession(externalSession, fn) {
  if (externalSession) return fn(externalSession);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

/**
 * Initiate a Plan B upgrade payment.
 * `paymentMethod`: `wallet` | `manual_qr`
 */
export async function initiateUpgradePayment({
  userId,
  paymentMethod,
  idempotencyKey = null,
}) {
  if (!userId) {
    const err = new Error("Authentication required");
    err.statusCode = 401;
    err.code = "AUTH_REQUIRED";
    throw err;
  }

  const normalizedMethod = String(paymentMethod || "").trim().toLowerCase();
  if (
    normalizedMethod !== MLM_UPGRADE_PAYMENT_MODE.WALLET
    && normalizedMethod !== MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR
  ) {
    const err = new Error("paymentMethod must be wallet or manual_qr.");
    err.statusCode = 422;
    err.code = "INVALID_PAYMENT_METHOD";
    throw err;
  }

  const cfg = await getMlmConfig();
  if (!cfg.enabled) {
    const err = new Error("Rewards program is not active.");
    err.statusCode = 422;
    err.code = "MLM_DISABLED";
    throw err;
  }

  const { payAmount, shoppingCredit } = resolveUpgradeAmounts(cfg);
  if (payAmount <= 0) {
    const err = new Error("Plan B upgrade price is not configured.");
    err.statusCode = 422;
    err.code = "UPGRADE_PRICE_UNCONFIGURED";
    throw err;
  }

  const membership = await MlmMembership.findOne({ userId });
  await assertUpgradeEligible(membership, cfg);

  const effectiveIdempotencyKey =
    idempotencyKey || buildClickIdempotencyKey(userId, normalizedMethod);

  const existingForKey = await MlmUpgradePayment.findOne({
    customer: userId,
    idempotencyKey: effectiveIdempotencyKey,
  });
  if (existingForKey) {
    return formatInitiateResponse(existingForKey, cfg, { duplicate: true });
  }

  const amountPaise = Math.round(payAmount * 100);
  const paymentId = new mongoose.Types.ObjectId();
  const merchantOrderId = buildUpgradeMerchantOrderId(paymentId);

  if (normalizedMethod === MLM_UPGRADE_PAYMENT_MODE.WALLET) {
    return runInSession(null, async (session) => {
      const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, userId, { session });
      const earningsBalance = Number(wallet.earningsBalance) || 0;
      if (earningsBalance < payAmount) {
        const err = new Error(
          "Insufficient earning wallet balance. Please pay via QR code.",
        );
        err.statusCode = 422;
        err.code = "INSUFFICIENT_EARNINGS";
        throw err;
      }

      const feeKey = `${MLM_IDEMPOTENCY_PREFIX.PLAN_B_UPGRADE_FEE}-${userId}`;
      await debitWallet({
        ownerType: OWNER_TYPE.CUSTOMER,
        ownerId: userId,
        amount: payAmount,
        bucket: "earnings",
        session,
        ledgerType: LEDGER_TRANSACTION_TYPE.MLM_PLAN_B_UPGRADE_FEE,
        ledgerReference: feeKey,
        ledgerDescription: "Plan B upgrade fee",
        idempotencyKey: feeKey,
        metadata: {
          mlmEvent: "PLAN_B_UPGRADE_FEE",
          paymentId: String(paymentId),
        },
        syncUserWalletBalance: false,
      });

      const payment = await MlmUpgradePayment.create(
        [
          {
            _id: paymentId,
            customer: userId,
            paymentMode: MLM_UPGRADE_PAYMENT_MODE.WALLET,
            gatewayOrderId: merchantOrderId,
            amountPaise,
            currency: "INR",
            status: PAYMENT_STATUS.CREATED,
            payAmountSnapshot: payAmount,
            shoppingCreditSnapshot: shoppingCredit,
            idempotencyKey: effectiveIdempotencyKey,
            statusHistory: [
              {
                fromStatus: PAYMENT_STATUS.CREATED,
                toStatus: PAYMENT_STATUS.CREATED,
                source: PAYMENT_EVENT_SOURCE.SYSTEM,
                reason: "Wallet upgrade payment initiated",
              },
            ],
          },
        ],
        { session },
      ).then((rows) => rows[0]);

      await transitionStatus(payment, {
        nextStatus: PAYMENT_STATUS.CAPTURED,
        source: PAYMENT_EVENT_SOURCE.SYSTEM,
        reason: "Earning wallet debit captured",
      });

      await applyUpgradeFromPayment(payment, { session });

      try {
        emitNotificationEvent(NOTIFICATION_EVENTS.MLM_PLAN_B_UPGRADED, {
          userId: String(userId),
          data: {
            paymentId: String(payment._id),
            topupAmount: shoppingCredit,
            paymentMode: MLM_UPGRADE_PAYMENT_MODE.WALLET,
          },
        });
      } catch (_) {
        /* non-fatal */
      }

      logger.info("mlm_upgrade_payment_wallet_captured", {
        paymentId: payment._id.toString(),
        userId: String(userId),
        payAmount,
      });

      return formatInitiateResponse(payment, cfg, {
        duplicate: false,
        upgraded: true,
      });
    });
  }

  const openStatuses = [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW];
  const existingOpen = await MlmUpgradePayment.findOne({
    customer: userId,
    paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
    status: { $in: openStatuses },
  }).sort({ createdAt: -1 });
  if (existingOpen) {
    return formatInitiateResponse(existingOpen, cfg, { duplicate: true });
  }

  const manualQr = await getManualQrConfig();
  const customerRedirectUrl = `${process.env.FRONTEND_URL || ""}/mlm/upgrade-payment/${paymentId.toString()}`;

  const payment = await MlmUpgradePayment.create({
    _id: paymentId,
    customer: userId,
    paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
    gatewayOrderId: merchantOrderId,
    amountPaise,
    currency: "INR",
    status: PAYMENT_STATUS.CREATED,
    payAmountSnapshot: payAmount,
    shoppingCreditSnapshot: shoppingCredit,
    idempotencyKey: effectiveIdempotencyKey,
    rawGatewayResponse: {
      redirectUrl: customerRedirectUrl,
      merchantOrderId,
      amountPaise,
      manualQrSnapshot: manualQr,
    },
    statusHistory: [
      {
        fromStatus: PAYMENT_STATUS.CREATED,
        toStatus: PAYMENT_STATUS.CREATED,
        source: PAYMENT_EVENT_SOURCE.SYSTEM,
        reason: "Manual QR upgrade intent created",
      },
    ],
  });

  logger.info("mlm_upgrade_payment_created", {
    paymentId: payment._id.toString(),
    merchantOrderId,
    amountPaise,
    paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
  });

  return formatInitiateResponse(payment, cfg, { duplicate: false });
}

async function formatInitiateResponse(payment, cfg, { duplicate, upgraded = false } = {}) {
  const manualQr =
    payment.paymentMode === MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR
      ? await getManualQrConfig()
      : undefined;

  return {
    paymentId: String(payment._id),
    merchantOrderId: payment.gatewayOrderId,
    redirectUrl:
      payment.rawGatewayResponse?.redirectUrl
      || (payment.paymentMode === MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR
        ? `${process.env.FRONTEND_URL || ""}/mlm/upgrade-payment/${payment._id}`
        : null),
    paymentMode: payment.paymentMode,
    payAmount: payment.payAmountSnapshot,
    shoppingCredit: payment.shoppingCreditSnapshot,
    status: payment.status,
    manualQr,
    duplicate: !!duplicate,
    upgraded: !!upgraded,
    upgradeEligible: true,
    eligibilityThreshold: resolveUpgradeEligibilityThreshold(cfg),
  };
}

export async function submitUpgradeManualProof({
  paymentId,
  customerId,
  transactionId,
  screenshotUrl,
  paidAmount = null,
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }

  const trimmedTxn = String(transactionId || "").trim().toUpperCase();
  if (!trimmedTxn) {
    const err = new Error("Transaction ID is required.");
    err.statusCode = 422;
    err.code = "TRANSACTION_ID_REQUIRED";
    throw err;
  }

  const trimmedScreenshot = String(screenshotUrl || "").trim();
  if (!trimmedScreenshot) {
    const err = new Error("Payment screenshot is required.");
    err.statusCode = 422;
    err.code = "SCREENSHOT_REQUIRED";
    throw err;
  }

  const payment = await MlmUpgradePayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Upgrade payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }

  if (String(payment.customer) !== String(customerId)) {
    const err = new Error("Not authorized to submit proof for this payment.");
    err.statusCode = 403;
    err.code = "NOT_PAYMENT_OWNER";
    throw err;
  }

  if (payment.paymentMode !== MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("This payment is not a manual-QR submission.");
    err.statusCode = 422;
    err.code = "NOT_MANUAL_QR";
    throw err;
  }

  if (payment.status !== PAYMENT_STATUS.CREATED) {
    const err = new Error(
      payment.status === PAYMENT_STATUS.PENDING_REVIEW
        ? "Proof has already been submitted; awaiting admin review."
        : `Cannot submit proof for a ${payment.status} payment.`,
    );
    err.statusCode = 409;
    err.code = "INVALID_STATUS";
    throw err;
  }

  payment.manualPaymentDetails = {
    transactionId: trimmedTxn,
    screenshotUrl: trimmedScreenshot,
    paidAmount:
      paidAmount != null && Number.isFinite(Number(paidAmount))
        ? Number(paidAmount)
        : payment.payAmountSnapshot,
    submittedAt: new Date(),
  };

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.PENDING_REVIEW,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: "Customer submitted Plan B upgrade payment proof",
  });

  logger.info("mlm_upgrade_payment_proof_submitted", {
    paymentId: payment._id.toString(),
    customerId: String(customerId),
  });

  return payment;
}

export async function approveUpgradePayment({
  paymentId,
  adminId,
  adminRemarks = "",
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }
  if (!adminId) {
    const err = new Error("adminId is required");
    err.statusCode = 401;
    throw err;
  }

  return runInSession(null, async (session) => {
    const payment = await MlmUpgradePayment.findById(paymentId).session(session);
    if (!payment) {
      const err = new Error("Upgrade payment not found.");
      err.statusCode = 404;
      err.code = "PAYMENT_NOT_FOUND";
      throw err;
    }

    if (payment.paymentMode !== MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR) {
      const err = new Error("Only manual-QR upgrade payments require admin approval.");
      err.statusCode = 422;
      err.code = "NOT_MANUAL_QR";
      throw err;
    }

    if (
      payment.status !== PAYMENT_STATUS.PENDING_REVIEW
      && payment.status !== PAYMENT_STATUS.CAPTURED
    ) {
      const err = new Error(
        `Cannot approve a payment in status ${payment.status}.`,
      );
      err.statusCode = 409;
      err.code = "INVALID_STATUS";
      throw err;
    }

    payment.reviewedBy = adminId;
    payment.reviewedAt = new Date();
    if (adminRemarks) payment.adminRemarks = String(adminRemarks).slice(0, 1000);

    await transitionStatus(payment, {
      nextStatus: PAYMENT_STATUS.CAPTURED,
      source: PAYMENT_EVENT_SOURCE.SYSTEM,
      reason: `Admin approved Plan B upgrade${adminRemarks ? `: ${adminRemarks}` : ""}`,
    });

    try {
      await applyUpgradeFromPayment(payment, { session });
    } catch (error) {
      payment.upgradeError = error.message;
      await payment.save({ session });
      throw error;
    }

    try {
      emitNotificationEvent(NOTIFICATION_EVENTS.MLM_PLAN_B_UPGRADED, {
        userId: String(payment.customer),
        data: {
          paymentId: payment._id.toString(),
          topupAmount: payment.shoppingCreditSnapshot,
          paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
        },
      });
    } catch (_) {
      /* non-fatal */
    }

    logger.info("mlm_upgrade_payment_approved", {
      paymentId: payment._id.toString(),
      adminId: String(adminId),
    });

    return payment;
  });
}

export async function rejectUpgradePayment({
  paymentId,
  adminId,
  reason,
}) {
  if (!paymentId) {
    const err = new Error("paymentId is required");
    err.statusCode = 422;
    throw err;
  }
  if (!adminId) {
    const err = new Error("adminId is required");
    err.statusCode = 401;
    throw err;
  }
  const trimmedReason = String(reason || "").trim();
  if (!trimmedReason || trimmedReason.length < 3) {
    const err = new Error("Rejection reason is required (>=3 characters).");
    err.statusCode = 422;
    err.code = "REASON_REQUIRED";
    throw err;
  }

  const payment = await MlmUpgradePayment.findById(paymentId);
  if (!payment) {
    const err = new Error("Upgrade payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }

  if (payment.paymentMode !== MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR) {
    const err = new Error("Only manual-QR upgrade payments can be rejected here.");
    err.statusCode = 422;
    err.code = "NOT_MANUAL_QR";
    throw err;
  }

  if (
    payment.status !== PAYMENT_STATUS.PENDING_REVIEW
    && payment.status !== PAYMENT_STATUS.CREATED
  ) {
    const err = new Error(
      `Cannot reject a payment in status ${payment.status}.`,
    );
    err.statusCode = 409;
    err.code = "INVALID_STATUS";
    throw err;
  }

  payment.reviewedBy = adminId;
  payment.reviewedAt = new Date();
  payment.adminRemarks = trimmedReason.slice(0, 1000);
  payment.failureReason = trimmedReason.slice(0, 1000);

  await transitionStatus(payment, {
    nextStatus: PAYMENT_STATUS.FAILED,
    source: PAYMENT_EVENT_SOURCE.SYSTEM,
    reason: `Admin rejected Plan B upgrade: ${trimmedReason}`,
  });

  logger.info("mlm_upgrade_payment_rejected", {
    paymentId: payment._id.toString(),
    adminId: String(adminId),
  });

  return payment;
}

export async function getUpgradePaymentForCustomer({ paymentId, customerId }) {
  const payment = await MlmUpgradePayment.findById(paymentId).lean();
  if (!payment) {
    const err = new Error("Upgrade payment not found.");
    err.statusCode = 404;
    err.code = "PAYMENT_NOT_FOUND";
    throw err;
  }
  if (String(payment.customer) !== String(customerId)) {
    const err = new Error("Not authorized to view this payment.");
    err.statusCode = 403;
    err.code = "NOT_PAYMENT_OWNER";
    throw err;
  }
  return payment;
}

export async function getLatestPendingUpgradePaymentForCustomer(customerId) {
  if (!customerId) return null;

  const open = await MlmUpgradePayment.findOne({
    customer: customerId,
    paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
    status: { $in: [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.PENDING_REVIEW] },
  })
    .sort({ createdAt: -1 })
    .lean();
  if (open) return open;

  const lastTerminal = await MlmUpgradePayment.findOne({
    customer: customerId,
    paymentMode: MLM_UPGRADE_PAYMENT_MODE.MANUAL_QR,
  })
    .sort({ createdAt: -1 })
    .lean();
  if (lastTerminal?.status === PAYMENT_STATUS.FAILED) {
    return lastTerminal;
  }
  return null;
}

export function computeUpgradeEligibility(membership, cfg, wallet = null) {
  if (!membership || membership.planType !== MLM_PLAN_TYPE.A) {
    return {
      upgradeEligible: false,
      upgradePayAmount: resolveUpgradeAmounts(cfg).payAmount,
      upgradeShoppingCredit: resolveUpgradeAmounts(cfg).shoppingCredit,
      eligibilityThreshold: resolveUpgradeEligibilityThreshold(cfg),
      canPayViaWallet: false,
    };
  }

  const threshold = resolveUpgradeEligibilityThreshold(cfg);
  const lifetimePlanA = Number(membership.lifetimePlanAEarnings) || 0;
  const eligible =
    membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE
    && (threshold <= 0 || lifetimePlanA >= threshold);
  const { payAmount, shoppingCredit } = resolveUpgradeAmounts(cfg);
  const earningsBalance = Number(wallet?.earningsBalance) || 0;

  return {
    upgradeEligible: eligible,
    upgradePayAmount: payAmount,
    upgradeShoppingCredit: shoppingCredit,
    eligibilityThreshold: threshold,
    canPayViaWallet: eligible && earningsBalance >= payAmount,
    earningsBalance,
  };
}

export const __internals = {
  buildUpgradeMerchantOrderId,
  resolveUpgradeAmounts,
  computeUpgradeEligibility,
};

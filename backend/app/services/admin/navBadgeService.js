import MlmJoiningPayment from "../../models/mlmJoiningPayment.js";
import MlmUpgradePayment from "../../models/mlmUpgradePayment.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import Seller from "../../models/seller.js";
import Product from "../../models/product.js";
import Order from "../../models/order.js";
import Transaction from "../../models/transaction.js";
import FranchiseRegistrationPayment from "../../models/franchiseRegistrationPayment.js";
import FranchiseWalletTopUp from "../../models/franchiseWalletTopUp.js";
import { PAYMENT_STATUS } from "../../constants/payment.js";
import { MLM_WITHDRAWAL_STATUS } from "../../constants/mlm.js";
import { FRANCHISE_TOPUP_STATUS } from "../../constants/franchise.js";
import { PRODUCT_APPROVAL_STATUS } from "../productModerationService.js";

/**
 * Stable API keys for admin sidebar "new since last visit" badges.
 * Frontend maps these onto nav paths in NavBadgeContext.
 */
export const ADMIN_NAV_BADGE_KEYS = Object.freeze([
  "joiningReviews",
  "upgradeReviews",
  "mlmWithdrawals",
  "sellersPending",
  "productsModeration",
  "ordersPending",
  "moneyRequests",
  "franchiseRegistrations",
  "franchiseTopups",
]);

function parseSince(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function sinceFilter(sinceByKey, key, field = "createdAt") {
  const since = parseSince(sinceByKey?.[key]);
  if (!since) return null;
  return { [field]: { $gt: since } };
}

async function countOrZero(filterPromise) {
  if (!filterPromise) return 0;
  return filterPromise;
}

/**
 * Count actionable queue items created after each key's `since` timestamp.
 * Missing / invalid since for a key → 0 (client seeds lastSeen on first login).
 *
 * @param {Record<string, string>} sinceByKey
 * @returns {Promise<{ counts: Record<string, number> }>}
 */
export async function getAdminNavBadgeCounts(sinceByKey = {}) {
  const joiningSince = sinceFilter(sinceByKey, "joiningReviews");
  const upgradeSince = sinceFilter(sinceByKey, "upgradeReviews");
  const mlmWdSince = sinceFilter(sinceByKey, "mlmWithdrawals");
  const sellersSince = sinceFilter(sinceByKey, "sellersPending");
  const productsSince = sinceFilter(sinceByKey, "productsModeration");
  const ordersSince = sinceFilter(sinceByKey, "ordersPending");
  const moneySince = sinceFilter(sinceByKey, "moneyRequests");
  const franchiseRegSince = sinceFilter(sinceByKey, "franchiseRegistrations");
  const franchiseTopupSince = sinceFilter(sinceByKey, "franchiseTopups");

  const [
    joiningReviews,
    upgradeReviews,
    mlmWithdrawals,
    sellersPending,
    productsModeration,
    ordersPending,
    moneyRequests,
    franchiseRegistrations,
    franchiseTopups,
  ] = await Promise.all([
    countOrZero(
      joiningSince &&
        MlmJoiningPayment.countDocuments({
          status: PAYMENT_STATUS.PENDING_REVIEW,
          ...joiningSince,
        }),
    ),
    countOrZero(
      upgradeSince &&
        MlmUpgradePayment.countDocuments({
          status: PAYMENT_STATUS.PENDING_REVIEW,
          ...upgradeSince,
        }),
    ),
    countOrZero(
      mlmWdSince &&
        MlmWithdrawalRequest.countDocuments({
          status: MLM_WITHDRAWAL_STATUS.PENDING,
          ...mlmWdSince,
        }),
    ),
    countOrZero(
      sellersSince &&
        Seller.countDocuments({
          isVerified: { $ne: true },
          $or: [
            { applicationStatus: "pending" },
            { applicationStatus: { $exists: false } },
            { applicationStatus: null },
          ],
          ...sellersSince,
        }),
    ),
    countOrZero(
      productsSince &&
        Product.countDocuments({
          approvalStatus: PRODUCT_APPROVAL_STATUS.PENDING,
          ...productsSince,
        }),
    ),
    countOrZero(
      ordersSince &&
        Order.countDocuments({
          status: "pending",
          ...ordersSince,
        }),
    ),
    countOrZero(
      moneySince &&
        Transaction.countDocuments({
          type: "Withdrawal",
          status: "Pending",
          ...moneySince,
        }),
    ),
    countOrZero(
      franchiseRegSince &&
        FranchiseRegistrationPayment.countDocuments({
          status: PAYMENT_STATUS.PENDING_REVIEW,
          ...franchiseRegSince,
        }),
    ),
    countOrZero(
      franchiseTopupSince &&
        FranchiseWalletTopUp.countDocuments({
          status: FRANCHISE_TOPUP_STATUS.PENDING_REVIEW,
          ...franchiseTopupSince,
        }),
    ),
  ]);

  return {
    counts: {
      joiningReviews,
      upgradeReviews,
      mlmWithdrawals,
      sellersPending,
      productsModeration,
      ordersPending,
      moneyRequests,
      franchiseRegistrations,
      franchiseTopups,
    },
  };
}

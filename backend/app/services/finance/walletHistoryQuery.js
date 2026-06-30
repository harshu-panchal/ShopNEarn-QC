import mongoose from "mongoose";
import { LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../../constants/finance.js";

export const WALLET_HISTORY_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "earnings", label: "Earnings" },
  { value: "shopping", label: "Shopping" },
  { value: "signup", label: "Signup Bonuses" },
  { value: "withdrawals", label: "Withdrawals" },
];

const EARNINGS_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_ACTIVATION,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_PER_ACTIVATION,
  LEDGER_TRANSACTION_TYPE.MLM_DIRECT_REFERRAL_MILESTONE,
  LEDGER_TRANSACTION_TYPE.MLM_REPURCHASE_BONUS,
  LEDGER_TRANSACTION_TYPE.MLM_MENTOR_ROYALTY,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_RELEASED,
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH_HELD_PENDING,
  LEDGER_TRANSACTION_TYPE.MLM_BINARY_PAIR_MATCH_RELEASED_ON_DOWNLINE_ACTIVATION,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_CLAWBACK_ON_RETURN,
  LEDGER_TRANSACTION_TYPE.MLM_BONUS_CAPPED_ROLLOVER,
];

const SHOPPING_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
  LEDGER_TRANSACTION_TYPE.MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT,
  LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,
  LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
];

const SIGNUP_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
  LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
];

const WITHDRAWAL_LEDGER_TYPES = [
  LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_GROSS_DEBIT,
  LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_ADMIN_CHARGE,
  LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_GST_CHARGE,
  LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_NET_PAYOUT_QUEUED,
  LEDGER_TRANSACTION_TYPE.MLM_WITHDRAWAL_REVERSAL,
];

function categoryTypeFilter(category) {
  switch (String(category || "").toLowerCase()) {
    case "earnings":
      return {
        $or: [
          { type: { $in: EARNINGS_LEDGER_TYPES } },
          {
            type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            "metadata.bucket": { $in: ["earnings", "pending"] },
          },
        ],
      };
    case "shopping":
      return {
        $or: [
          { type: { $in: SHOPPING_LEDGER_TYPES } },
          {
            type: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            $or: [
              { "metadata.bucket": "shopping" },
              { "metadata.bucket": { $exists: false } },
              { "metadata.bucket": null },
            ],
          },
        ],
      };
    case "signup":
      return { type: { $in: SIGNUP_LEDGER_TYPES } };
    case "withdrawals":
      return { type: { $in: WITHDRAWAL_LEDGER_TYPES } };
    default:
      return null;
  }
}

/**
 * Build a LedgerEntry query for customer wallet history.
 */
export function buildWalletHistoryQuery({
  userId,
  type = null,
  direction = null,
  category = null,
}) {
  const query = {
    actorType: OWNER_TYPE.CUSTOMER,
    actorId: new mongoose.Types.ObjectId(String(userId)),
  };

  if (type) {
    query.type = String(type);
    return query;
  }

  if (
    direction &&
    ["CREDIT", "DEBIT"].includes(String(direction).toUpperCase())
  ) {
    query.direction = String(direction).toUpperCase();
  }

  const categoryFilter = categoryTypeFilter(category);
  if (categoryFilter) {
    return { $and: [query, categoryFilter] };
  }

  return query;
}

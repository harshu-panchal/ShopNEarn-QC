import mongoose from "mongoose";
import { ALL_OWNER_TYPES, ALL_WALLET_STATUSES, CURRENCY } from "../constants/finance.js";

const walletSchema = new mongoose.Schema(
  {
    ownerType: {
      type: String,
      enum: ALL_OWNER_TYPES,
      required: true,
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    currency: {
      type: String,
      default: CURRENCY,
      uppercase: true,
      trim: true,
    },
    availableBalance: {
      type: Number,
      default: 0,
    },
    pendingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    cashInHand: {
      type: Number,
      default: 0,
      min: 0,
    },
    // MLM Phase 1: split customer wallet into two logical pools.
    // `shoppingBalance` is seeded by joining-package activation, premium
    // upgrade, and (Phase 4) shopping-credit milestone rewards. It is
    // usable ONLY at checkout — withdrawals can never touch it.
    // `earningsBalance` is credited by every bonus type (direct referral,
    // repurchase, mentor royalty, home shopping) once the return window
    // releases the pending bucket. Withdrawals draw only from here.
    //
    // For non-MLM and pre-MLM customers these stay at 0 and the legacy
    // `availableBalance` continues to work unchanged. The buckets are
    // additive — no existing call site needs to migrate.
    shoppingBalance: {
      type: Number,
      default: 0,
    },
    earningsBalance: {
      type: Number,
      default: 0,
    },
    totalCredited: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalDebited: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ALL_WALLET_STATUSES,
      default: "ACTIVE",
    },
    meta: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true },
);

walletSchema.index(
  { ownerType: 1, ownerId: 1 },
  { unique: true, partialFilterExpression: { ownerType: { $exists: true } } },
);

export default mongoose.model("Wallet", walletSchema);

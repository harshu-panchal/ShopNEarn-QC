import mongoose from "mongoose";
import { WORKFLOW_STATUS } from "../constants/orderWorkflow.js";
import {
  ALL_ORDER_PAYMENT_STATUSES,
  ALL_ORDER_SETTLEMENT_STATUSES,
  ALL_PAYMENT_MODES,
  CURRENCY,
} from "../constants/finance.js";

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: String,
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
        },
        variantSlot: String,
        image: String,
      },
    ],
    address: {
      type: {
        type: String,
        enum: ["Home", "Work", "Other"],
        default: "Home",
      },
      name: String,
      address: String,
      city: String,
      phone: String,
      landmark: String,
      location: {
        lat: Number,
        lng: Number,
      },
    },
    /**
     * @deprecated Phase 4 (P4-7). Use the canonical `paymentMode` +
     * `paymentStatus` top-level fields and the `paymentBreakdown` nested
     * doc instead. This nested doc remains as a legacy mirror for the
     * frontend; the `pre('save')`/`pre('findOneAndUpdate')` sync hooks
     * keep `payment.method` / `payment.status` aligned with the canonical
     * fields. Will be removed in Phase 7.
     */
    payment: {
      method: {
        type: String,
        enum: ["cash", "online", "wallet"],
        default: "cash",
      },
      status: {
        type: String,
        enum: ["pending", "completed", "failed", "refunded"],
        default: "pending",
      },
      transactionId: String,
    },
    /**
     * @deprecated Phase 4 (P4-7). Use the canonical `paymentBreakdown`
     * nested doc (frozen finance snapshot) instead. Kept as a read-only
     * mirror for legacy clients. Writes here propagate via the pre('save')
     * snapshot logic; new flows should write to `paymentBreakdown.*`.
     */
    pricing: {
      subtotal: Number,
      deliveryFee: Number,
      platformFee: Number,
      gst: Number,
      tip: {
        type: Number,
        default: 0,
      },
      discount: {
        type: Number,
        default: 0,
      },
      total: Number,
      walletAmount: {
        type: Number,
        default: 0,
      },
    },
    paymentMode: {
      type: String,
      enum: ALL_PAYMENT_MODES,
      default: "COD",
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ALL_ORDER_PAYMENT_STATUSES,
      default: "CREATED",
      index: true,
    },
    stockReservation: {
      status: {
        type: String,
        enum: ["RESERVED", "COMMITTED", "RELEASED"],
        default: "COMMITTED",
        index: true,
      },
      reservedAt: {
        type: Date,
        default: Date.now,
      },
      expiresAt: {
        type: Date,
        default: null,
      },
      releasedAt: {
        type: Date,
        default: null,
      },
    },
    checkoutGroupId: {
      type: String,
      index: true,
      default: null,
    },
    checkoutGroupSize: {
      type: Number,
      default: 1,
    },
    checkoutGroupIndex: {
      type: Number,
      default: 0,
    },
    placement: {
      idempotencyKey: {
        type: String,
        default: undefined,
      },
      idempotencyKeyExpiry: {
        type: Date,
        default: null,
      },
      createdFrom: {
        type: String,
        enum: ["DIRECT_ITEMS", "CART"],
        default: "DIRECT_ITEMS",
      },
    },
    orderStatus: {
      type: String,
      default: "pending",
      index: true,
    },
    settlementStatus: {
      overall: {
        type: String,
        enum: ALL_ORDER_SETTLEMENT_STATUSES,
        default: "PENDING",
      },
      sellerPayout: {
        type: String,
        enum: ["NOT_APPLICABLE", "HOLD", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"],
        default: "PENDING",
      },
      riderPayout: {
        type: String,
        enum: ["NOT_APPLICABLE", "PENDING", "PROCESSING", "COMPLETED", "FAILED"],
        default: "PENDING",
      },
      adminEarningCredited: {
        type: Boolean,
        default: false,
      },
      reconciledAt: {
        type: Date,
        default: null,
      },
    },
    distanceSnapshot: {
      distanceKmActual: { type: Number, default: 0 },
      distanceKmRounded: { type: Number, default: 0 },
      source: { type: String, default: "haversine" },
    },
    pricingSnapshot: {
      deliverySettings: {
        type: Object,
        default: {},
      },
      handlingFeeStrategy: {
        type: String,
        default: null,
      },
      handlingCategoryUsed: {
        type: Object,
        default: {},
      },
      categoryCommissionSettings: {
        type: Array,
        default: [],
      },
    },
    paymentBreakdown: {
      currency: { type: String, default: CURRENCY },
      productSubtotal: { type: Number, default: 0 },
      deliveryFeeCharged: { type: Number, default: 0 },
      handlingFeeCharged: { type: Number, default: 0 },
      tipTotal: { type: Number, default: 0 },
      discountTotal: { type: Number, default: 0 },
      taxTotal: { type: Number, default: 0 },
      grandTotal: { type: Number, default: 0 },
      sellerPayoutTotal: { type: Number, default: 0 },
      adminProductCommissionTotal: { type: Number, default: 0 },
      riderPayoutBase: { type: Number, default: 0 },
      riderPayoutDistance: { type: Number, default: 0 },
      riderPayoutBonus: { type: Number, default: 0 },
      riderTipAmount: { type: Number, default: 0 },
      riderPayoutTotal: { type: Number, default: 0 },
      platformLogisticsMargin: { type: Number, default: 0 },
      platformTotalEarning: { type: Number, default: 0 },
      codCollectedAmount: { type: Number, default: 0 },
      codRemittedAmount: { type: Number, default: 0 },
      codPendingAmount: { type: Number, default: 0 },
      walletAmount: { type: Number, default: 0 },
      // MLM Phase 1: per-bucket split of the wallet redemption applied
      // at checkout. Refund flow uses this to credit back to the same
      // source buckets (shoppingBalance refunds to shoppingBalance,
      // earningsBalance refunds to earningsBalance). For non-MLM orders
      // both default to 0 and `walletAmount` continues to be the source
      // of truth.
      walletSplit: {
        shopping: { type: Number, default: 0 },
        earnings: { type: Number, default: 0 },
        // MLM Phase 1: include the legacy `available` bucket portion too
        // so refunds can fully reconstitute the source buckets without
        // having to subtract from `walletAmount`. For non-MLM customers
        // this equals `paymentBreakdown.walletAmount`.
        available: { type: Number, default: 0 },
      },
      distanceKmActual: { type: Number, default: 0 },
      distanceKmRounded: { type: Number, default: 0 },
      snapshots: {
        deliverySettings: { type: Object, default: {} },
        categoryCommissionSettings: { type: Array, default: [] },
        handlingFeeStrategy: { type: String, default: null },
        handlingCategoryUsed: { type: Object, default: {} },
      },
      lineItems: {
        type: Array,
        default: [],
      },
    },
    financeFlags: {
      onlinePaymentCaptured: { type: Boolean, default: false },
      codMarkedCollected: { type: Boolean, default: false },
      deliveredSettlementApplied: { type: Boolean, default: false },
      sellerPayoutQueued: { type: Boolean, default: false },
      riderPayoutQueued: { type: Boolean, default: false },
      adminEarningCredited: { type: Boolean, default: false },
      // Added in Phase 1 (audit-plan ticket P1-3). These flags were
      // already written and read by orderController, orderFinanceService,
      // orderWorkflowController, and returnWindowReleaseJob, but they
      // weren't declared on the schema, so Mongoose silently dropped
      // every write. Declaring them here makes the existing logic
      // actually take effect; no code change is needed elsewhere.
      sellerPayoutHeld: { type: Boolean, default: false },
      returnPickupCommissionPaid: { type: Boolean, default: false },
      // Audit Phase 3 (C-3): set by `reverseOrderFinanceOnCancellation`
      // inside the same transaction that issues the wallet refund and the
      // gateway debit. Acts as the idempotency guard so that every v2
      // cancellation entry point (sellerRejectAtomic, seller/delivery
      // timeout jobs, customerCancelV2, orderAutoCancelJob) can call the
      // reversal through `compensateOrderCancellation` without risk of
      // double-refunding when retries fire. Pre-existing cancelled orders
      // default to `false`; their reversal has never run and they will
      // refund on the next call. If that is undesired for a historical
      // dataset, gate the v2 call with `paymentBreakdown.grandTotal != null`
      // (already enforced) and an operational backfill.
      cancellationReversalApplied: { type: Boolean, default: false },
    },
    // Audit Phase 5 (C-2 + C-4 + H-2 + H-6 + H-7): canonical coupon
    // reference + frozen rule snapshot persisted at place-order so the
    // discount decision can be audited and per-user usage counts can be
    // computed from real data. Both fields are additive and default to
    // null — historical orders are unaffected. Populated only when the
    // `SERVER_SIDE_COUPON_ENGINE` feature flag is on; legacy/off-flag
    // orders keep these fields empty.
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
      index: true,
    },
    couponSnapshot: {
      couponId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Coupon",
        default: null,
      },
      code: { type: String, default: null },
      title: { type: String, default: null },
      discountType: { type: String, default: null },
      discountValue: { type: Number, default: 0 },
      maxDiscount: { type: Number, default: null },
      couponType: { type: String, default: null },
      minOrderValue: { type: Number, default: 0 },
      minItems: { type: Number, default: 0 },
      perUserLimit: { type: Number, default: null },
      usageLimit: { type: Number, default: null },
      validFrom: { type: Date, default: null },
      validTill: { type: Date, default: null },
      // Resolved at apply time so the snapshot is a self-contained record.
      cartSubtotalAtApply: { type: Number, default: 0 },
      discountAmountApplied: { type: Number, default: 0 },
      freeDeliveryApplied: { type: Boolean, default: false },
      appliedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "packed",
        "out_for_delivery",
        "delivered",
        "cancelled",
      ],
      default: "pending",
    },
    workflowStatus: {
      type: String,
      enum: Object.values(WORKFLOW_STATUS),
    },
    workflowVersion: {
      type: Number,
      default: 1,
    },
    sellerPendingExpiresAt: Date,
    deliverySearchExpiresAt: Date,
    sellerAcceptedAt: Date,
    assignedAt: Date,
    assignmentVersion: {
      type: Number,
      default: 0,
    },
    deliverySearchMeta: {
      radiusMeters: { type: Number, default: 5000 },
      attempt: { type: Number, default: 1 },
      lastBroadcastAt: Date,
    },
    pickupConfirmedAt: Date,
    pickupReadyAt: Date,
    outForDeliveryAt: Date,
    deliveryRiderStep: {
      type: Number,
      min: 1,
      max: 4,
    },
    timeSlot: {
      type: String,
      default: "now",
    },
    deliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
    },
    /**
     * @deprecated Phase 4 (P4-9). Use the canonical `deliveryBoy` field.
     * All indexes and the workflow state machine reference `deliveryBoy`.
     * The pre('save') and pre('findOneAndUpdate') hooks mirror writes
     * between the two until Phase 7 drops this field. NEW code should
     * read/write `deliveryBoy` only.
     */
    deliveryPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
    },
    cancelledBy: {
      type: String,
      enum: ["customer", "seller", "admin", "system"],
    },
    cancelReason: String,
    deviceType: {
      type: String,
      enum: ["Mobile", "Desktop", "Tablet"],
      default: "Mobile",
    },
    trafficSource: {
      type: String,
      enum: ["Direct", "Search", "Social", "Referral"],
      default: "Direct",
    },
    // MLM Phase 4+: order-type flag for the home-shopping Plan B
    // exclusive flow. Joining-package purchases are no longer modelled
    // as Orders — they live in the dedicated `MlmJoiningPayment`
    // collection. The `isJoiningPackageOrder` and `mlmActivationApplied`
    // fields previously here were removed in the direct-join refactor;
    // the migrate-mlm-joining-cleanup script archives any pre-existing
    // values into MlmJoiningPayment before this schema drop.
    isHomeShoppingOrder: {
      type: Boolean,
      default: false,
      index: true,
    },
    // MLM Phase 2+: idempotency guard for repurchase + home-shopping
    // bonus chains fired from `settleDeliveredOrder`. Set true after the
    // first successful disbursement.
    mlmBonusesDisbursed: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Home Shoppy franchise routing
    franchisePartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FranchisePartner",
      default: null,
      index: true,
    },
    franchiseRoutedAt: { type: Date, default: null },
    franchiseStatus: {
      type: String,
      enum: ["pending", "accepted", "rejected", "fulfilled"],
      default: null,
      index: true,
    },
    /** Set when franchise partner accepts; Harsh's Hub must accept next. */
    hubAcceptanceStatus: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: null,
      index: true,
    },
    hubAcceptedAt: { type: Date, default: null },
    /** Franchise partner creates shipment after hub acceptance. */
    shipmentStatus: {
      type: String,
      enum: ["pending", "created"],
      default: null,
      index: true,
    },
    shipmentCreatedAt: { type: Date, default: null },
    shipmentReference: { type: String, default: null, trim: true },
    isFranchiseStockOrder: {
      type: Boolean,
      default: false,
      index: true,
    },
    /** True after franchise ledger was decremented for customer-order fulfillment. */
    franchiseStockConsumed: {
      type: Boolean,
      default: false,
      index: true,
    },
    expiresAt: {
      type: Date,
    },
    acceptedAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
    skippedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Delivery",
      },
    ],
    returnStatus: {
      type: String,
      enum: [
        "none",
        "return_requested",
        "return_approved",
        "return_rejected",
        "return_pickup_assigned",
        "return_in_transit",
        "return_drop_pending",
        "returned",
        "qc_passed",
        "qc_failed",
        "refund_completed",
      ],
      default: "none",
    },
    returnRequestedAt: {
      type: Date,
    },
    returnEligibleAt: {
      type: Date,
    },
    returnWindowExpiresAt: {
      type: Date,
    },
    returnDeadline: {
      type: Date,
    },
    returnReason: {
      type: String,
    },
    returnReasonDetail: {
      type: String,
    },
    returnConditionAssurance: {
      type: Boolean,
      default: false,
    },
    returnImages: [{ type: String }],
    returnItems: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        name: String,
        quantity: {
          type: Number,
          required: true,
          min: 1,
        },
        price: {
          type: Number,
          required: true,
        },
        variantSlot: String,
        itemIndex: {
          type: Number,
        },
        status: {
          type: String,
          enum: ["requested", "approved", "rejected", "returned"],
          default: "requested",
        },
      },
    ],
    returnRejectedReason: {
      type: String,
    },
    returnDeliveryBoy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
    },
    // Return-pickup assignment workflow (mirrors deliverySearch*). Only
    // populated while `returnStatus === "return_pickup_assigned"` and the
    // pickup is in the broadcast / radius-expansion phase.
    returnSearchExpiresAt: Date,
    returnSearchMeta: {
      radiusMeters: { type: Number, default: 5000 },
      attempt: { type: Number, default: 1 },
      lastBroadcastAt: Date,
    },
    returnDeliveryCommission: {
      type: Number,
      default: 0,
    },
    returnRefundAmount: {
      type: Number,
      default: 0,
    },
    returnPickedAt: {
      type: Date,
    },
    returnDeliveredBackAt: {
      type: Date,
    },
    returnQcStatus: {
      type: String,
      enum: ["passed", "failed"],
    },
    returnQcAt: {
      type: Date,
    },
    returnQcBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    returnQcNote: {
      type: String,
    },
    returnPickupImages: [{ type: String }],
    returnPickupCondition: {
      type: String,
      enum: ["good", "damaged", "suspicious"],
    },
    returnPickupConditionNote: { type: String },
    returnDropVerifiedAt: { type: Date },
    returnDropVerifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
    },
    refundIssuedAt: { type: Date },
    sellerPayoutReleasedAt: { type: Date },
    deliveryProofImages: [{ type: String }],
    otpValidatedAt: {
      type: Date,
    },
    otpValidationLocation: {
      lat: Number,
      lng: Number,
    },
  },
  { timestamps: true },
);

orderSchema.index({ status: 1, seller: 1, deliveryBoy: 1, createdAt: -1 });
orderSchema.index({ customer: 1, status: 1, createdAt: -1 });
orderSchema.index({ status: 1, expiresAt: 1 });
orderSchema.index({ seller: 1, returnStatus: 1, returnRequestedAt: -1 });
orderSchema.index({ workflowStatus: 1, sellerPendingExpiresAt: 1 });
orderSchema.index({ workflowStatus: 1, deliverySearchExpiresAt: 1 });
orderSchema.index({ returnStatus: 1, returnSearchExpiresAt: 1 });
orderSchema.index({ deliveryBoy: 1, workflowStatus: 1 });
orderSchema.index({ paymentMode: 1, paymentStatus: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1, "settlementStatus.overall": 1, createdAt: -1 });
orderSchema.index({ seller: 1, "settlementStatus.sellerPayout": 1, status: 1 });
orderSchema.index({ deliveryBoy: 1, "settlementStatus.riderPayout": 1, status: 1 });
orderSchema.index(
  { customer: 1, "placement.idempotencyKey": 1, createdAt: -1 },
  {
    partialFilterExpression: {
      "placement.idempotencyKey": { $type: "string" },
    },
  },
);
orderSchema.index({ "stockReservation.status": 1, "stockReservation.expiresAt": 1 });
orderSchema.index({ checkoutGroupId: 1, createdAt: -1 });
orderSchema.index({ checkoutGroupId: 1, checkoutGroupIndex: 1 });
orderSchema.index({ isFranchiseStockOrder: 1, createdAt: -1 });
orderSchema.index({ customer: 1, createdAt: -1, isFranchiseStockOrder: 1 });
orderSchema.index(
  { "placement.idempotencyKeyExpiry": 1 },
  { 
    expireAfterSeconds: 0,
    partialFilterExpression: { "placement.idempotencyKeyExpiry": { $type: "date" } }
  }
);

orderSchema.pre('save', function(next) {
  if (!this.orderStatus) {
    this.orderStatus = this.status || "pending";
  }
  if (!this.status && this.orderStatus) {
    this.status = this.orderStatus;
  }
  if (!this.paymentMode) {
    const method = String(this.payment?.method || "").toLowerCase();
    this.paymentMode = method === "online" ? "ONLINE" : "COD";
  }
  if (!this.paymentStatus) {
    const paymentStatusLegacy = String(this.payment?.status || "").toLowerCase();
    if (this.paymentMode === "ONLINE") {
      this.paymentStatus = paymentStatusLegacy === "completed" ? "PAID" : "CREATED";
    } else {
      this.paymentStatus = paymentStatusLegacy === "completed" ? "CASH_COLLECTED" : "PENDING_CASH_COLLECTION";
    }
  }
  if (!this.settlementStatus?.overall) {
    this.settlementStatus = {
      ...(this.settlementStatus || {}),
      overall: this.settlementStatus?.overall || "PENDING",
      sellerPayout: this.settlementStatus?.sellerPayout || "PENDING",
      riderPayout: this.settlementStatus?.riderPayout || "PENDING",
      adminEarningCredited: Boolean(this.settlementStatus?.adminEarningCredited),
      reconciledAt: this.settlementStatus?.reconciledAt || null,
    };
  }
  if (!this.deliveryPartner && this.deliveryBoy) {
    this.deliveryPartner = this.deliveryBoy;
  }
  if (!this.deliveryBoy && this.deliveryPartner) {
    this.deliveryBoy = this.deliveryPartner;
  }
  if (!this.customer) {
    const error = new Error('Order must have a valid customer reference');
    error.name = 'ValidationError';
    return next(error);
  }
  next();
});

// Phase 4 P4-1: keep legacy mirror fields in sync on every findOneAndUpdate.
//
// The Order document has two parallel representations:
//   - Canonical: `paymentStatus`, `orderStatus`, `paymentMode`
//   - Legacy:    `payment.status`, `payment.method`, `status`
//
// The `pre('save')` hook below handles document-style saves, but a direct
// `Order.findOneAndUpdate({_id}, { $set: { paymentStatus: "PAID" }})` would
// previously leave `payment.status: "pending"` — drift accumulates.
//
// This hook normalises ANY findOneAndUpdate / updateOne / updateMany that
// hits the schema with a $set on a canonical field. It NEVER overrides an
// explicit legacy-field write — if the caller already supplied both, we
// respect their intent.
const PAYMENT_STATUS_TO_LEGACY = {
  PAID: "completed",
  CASH_COLLECTED: "completed",
  COD_RECONCILED: "completed",
  REFUNDED: "refunded",
  FAILED: "failed",
};

function deriveLegacyPaymentStatus(canonical) {
  return PAYMENT_STATUS_TO_LEGACY[canonical] || "pending";
}

function mirrorCanonicalToLegacy(update) {
  if (!update || typeof update !== "object") return;
  const set = update.$set || update;
  if (!set || typeof set !== "object") return;

  // status ↔ orderStatus mirror (both are user-facing).
  if (set.status && set.orderStatus == null) {
    set.orderStatus = set.status;
  }
  if (set.orderStatus && set.status == null) {
    set.status = set.orderStatus;
  }

  // paymentStatus → payment.status (legacy nested doc).
  if (set.paymentStatus && set["payment.status"] == null) {
    set["payment.status"] = deriveLegacyPaymentStatus(set.paymentStatus);
  }

  // paymentMode → payment.method (legacy nested doc). The legacy enum
  // values are "cash" / "online" / "wallet"; we never derive "wallet"
  // automatically (it is set explicitly by the wallet-payment flow).
  if (set.paymentMode && set["payment.method"] == null) {
    set["payment.method"] = set.paymentMode === "ONLINE" ? "online" : "cash";
  }

  // deliveryBoy ↔ deliveryPartner mirror (Phase 4 P4-9 prep).
  if (set.deliveryBoy && set.deliveryPartner == null) {
    set.deliveryPartner = set.deliveryBoy;
  }
  if (set.deliveryPartner && set.deliveryBoy == null) {
    set.deliveryBoy = set.deliveryPartner;
  }

  // Re-attach if we were mutating a $set wrapper.
  if (update.$set) update.$set = set;
}

orderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  if (update.$unset && update.$unset.customer) {
    const error = new Error('Cannot unset customer field from order');
    error.name = 'ValidationError';
    return next(error);
  }
  if (update.$set && update.$set.customer === null) {
    const error = new Error('Cannot set customer field to null');
    error.name = 'ValidationError';
    return next(error);
  }
  mirrorCanonicalToLegacy(update);
  next();
});

// Phase 4 P4-1: same mirror for updateOne / updateMany.
function preUpdateMirror(next) {
  const update = this.getUpdate() || {};
  mirrorCanonicalToLegacy(update);
  next();
}
orderSchema.pre('updateOne', preUpdateMirror);
orderSchema.pre('updateMany', preUpdateMirror);

export default mongoose.model("Order", orderSchema);

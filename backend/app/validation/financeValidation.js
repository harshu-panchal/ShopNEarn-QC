import Joi from "joi";

const locationSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lng: Joi.number().min(-180).max(180).required(),
});

const orderItemSchema = Joi.object({
  product: Joi.string().optional(),
  productId: Joi.string().optional(),
  id: Joi.string().optional(),
  name: Joi.string().allow("", null),
  // Variant identifier (preferred: SKU). When present, backend will price the selected variant.
  variantSku: Joi.string().allow("", null).optional(),
  // Legacy/alternate field name used by some clients/services.
  variantSlot: Joi.string().allow("", null).optional(),
  quantity: Joi.number().integer().min(1).required(),
  price: Joi.number().min(0).optional(),
  image: Joi.string().allow("", null),
}).or("product", "productId", "id");

export const checkoutPreviewSchema = Joi.object({
  items: Joi.array().items(orderItemSchema).min(1).required(),
  address: Joi.object({
    type: Joi.string().allow("", null),
    name: Joi.string().allow("", null),
    address: Joi.string().allow("", null),
    city: Joi.string().allow("", null),
    phone: Joi.string().allow("", null),
    landmark: Joi.string().allow("", null),
    location: locationSchema.optional(),
  }).required(),
  distanceKm: Joi.number().min(0).optional(),
  discountTotal: Joi.number().min(0).default(0),
  taxTotal: Joi.number().min(0).default(0),
  tipAmount: Joi.number().min(0).default(0),
  // Audit Phase 4 (C-1): accept optional walletAmount on the preview so
  // the frontend can request a post-wallet `payableAmount` without doing
  // client-side math. Backward-compatible — clients that don't send it
  // get the pre-wallet `grandTotal` exactly as before.
  walletAmount: Joi.number().min(0).default(0),
  paymentMode: Joi.string().valid("ONLINE", "COD").default("COD"),
  timeSlot: Joi.string().allow("", null),
  couponId: Joi.string().allow("", null).optional(),
  // Audit Phase 5 (C-2 + H-7): accept the coupon CODE as an alternative
  // to couponId so the server can re-validate the coupon end-to-end
  // even when the frontend doesn't yet know the ObjectId (e.g. the
  // user typed a code instead of selecting from a list). The pricing
  // snapshot ignores client-supplied `discountTotal` when either
  // identifier is provided and SERVER_SIDE_COUPON_ENGINE is on.
  couponCode: Joi.string().trim().allow("", null).optional(),
});

export const createFinanceOrderSchema = checkoutPreviewSchema.keys({
  items: Joi.array().items(orderItemSchema).min(1).optional(),
  paymentMode: Joi.string().valid("ONLINE", "COD").required(),
  walletAmount: Joi.number().min(0).default(0),
});

export const verifyOnlinePaymentSchema = Joi.object({
  merchantOrderId: Joi.string().trim().required(),
  transactionId: Joi.string().trim().optional(),
  paymentMeta: Joi.object().unknown(true).optional(),
});

export const codMarkCollectedSchema = Joi.object({
  amount: Joi.number().min(0.01).optional(),
  deliveryPartnerId: Joi.string().optional(),
});

export const deliveredSchema = Joi.object({
  deliveryPartnerId: Joi.string().optional(),
});

export const codReconcileSchema = Joi.object({
  amount: Joi.number().min(0.01).required(),
  deliveryPartnerId: Joi.string().optional(),
  metadata: Joi.object().unknown(true).optional(),
});

export const financeSummaryQuerySchema = Joi.object({
  fromDate: Joi.date().optional(),
  toDate: Joi.date().optional(),
});

export const financeLedgerQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
  type: Joi.string().optional(),
  actorType: Joi.string().optional(),
  actorId: Joi.string().optional(),
  orderId: Joi.string().optional(),
  payoutId: Joi.string().optional(),
  paymentMode: Joi.string().valid("ONLINE", "COD").optional(),
  fromDate: Joi.date().optional(),
  toDate: Joi.date().optional(),
});

export const payoutProcessSchema = Joi.object({
  payoutIds: Joi.array().items(Joi.string()).default([]),
  payoutType: Joi.string().valid("SELLER", "DELIVERY_PARTNER").optional(),
  limit: Joi.number().integer().min(1).max(200).default(50),
  remarks: Joi.string().allow("", null).optional(),
});

export const updateDeliverySettingsSchema = Joi.object({
  deliveryPricingMode: Joi.string().valid("fixed_price", "distance_based").optional(),
  pricingMode: Joi.string().valid("fixed_price", "distance_based").optional(),
  customerBaseDeliveryFee: Joi.number().min(0).optional(),
  riderBasePayout: Joi.number().min(0).optional(),
  baseDeliveryCharge: Joi.number().min(0).optional(),
  baseDistanceCapacityKm: Joi.number().min(0).optional(),
  incrementalKmSurcharge: Joi.number().min(0).optional(),
  deliveryPartnerRatePerKm: Joi.number().min(0).optional(),
  fleetCommissionRatePerKm: Joi.number().min(0).optional(),
  fixedDeliveryFee: Joi.number().min(0).optional(),
  handlingFeeStrategy: Joi.string()
    .valid("highest_category_fee", "sum_of_category_fees", "max_single_fee", "per_item_fee")
    .optional(),
  codEnabled: Joi.boolean().optional(),
  onlineEnabled: Joi.boolean().optional(),
}).or(
  "deliveryPricingMode",
  "pricingMode",
  "customerBaseDeliveryFee",
  "riderBasePayout",
  "baseDeliveryCharge",
  "baseDistanceCapacityKm",
  "incrementalKmSurcharge",
  "deliveryPartnerRatePerKm",
  "fleetCommissionRatePerKm",
  "fixedDeliveryFee",
  "handlingFeeStrategy",
  "codEnabled",
  "onlineEnabled",
);

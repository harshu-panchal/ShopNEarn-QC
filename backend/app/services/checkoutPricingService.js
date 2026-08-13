import Seller from "../models/seller.js";
import Category from "../models/category.js";
import { distanceMeters } from "../utils/geoUtils.js";
import {
  HANDLING_FEE_STRATEGY,
  isWalletRedemptionReducesPayableEnabled,
  isServerSideCouponEngineEnabled,
} from "../constants/finance.js";
import {
  calculateHandlingFee,
  generateOrderPaymentBreakdown,
  hydrateOrderItems,
} from "./finance/pricingService.js";
import { getOrCreateFinanceSettings } from "./finance/financeSettingsService.js";
import { computeOrderDiscount } from "./finance/couponService.js";
import { getMlmConfig } from "./mlm/mlmConfigService.js";
import { cartIsHubOnly } from "./franchise/franchiseCatalogService.js";
import { getHubSellerId } from "./franchise/franchiseConfigService.js";
import { resolveFranchisePartner } from "./franchise/franchiseOrderRoutingService.js";
import { normalizeAddressForFranchiseRouting } from "./franchise/franchiseAddressUtils.js";
import { assertHydratedItemsStock } from "../utils/productStockUtils.js";
import Product from "../models/product.js";

/**
 * MLM-specific carve-out: the home-shopping SKU is a digital product
 * — no rider is dispatched, no delivery fee applies. We detect it by
 * matching cart items against the admin-configured Product ID in
 * `Setting.mlm.homeShoppingProductId`. When the entire cart is the
 * digital SKU, we reuse the same per-seller transform the
 * free-delivery coupon path uses (`applyFreeDeliveryToSellerBreakdowns`)
 * to zero out `deliveryFeeCharged` and re-balance the platform
 * margin. Returns `true` when the rebate was applied so the
 * snapshot can flag the order accordingly.
 *
 * Joining-package purchases are NOT Orders any more (they live in the
 * dedicated `MlmJoiningPayment` collection) so they never reach this
 * pricing path.
 */
async function isDigitalOnlyMlmCart(hydratedItems) {
  if (!Array.isArray(hydratedItems) || hydratedItems.length === 0) return false;
  try {
    const cfg = await getMlmConfig();
    const digitalIds = new Set(
      [cfg?.homeShoppingProductId]
        .filter(Boolean)
        .map((id) => String(id)),
    );
    if (digitalIds.size === 0) return false;
    return hydratedItems.every((item) => {
      const productId = String(item?.productId || item?.product || "");
      return productId && digitalIds.has(productId);
    });
  } catch {
    // MLM config unreachable — fall back to the legacy paid-delivery path.
    return false;
  }
}

function normalizeLocation(location = null) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

export function groupHydratedItemsBySeller(hydratedItems = []) {
  const grouped = new Map();
  for (const item of hydratedItems) {
    const sellerId = String(item?.sellerId || "");
    if (!sellerId) {
      const err = new Error("Unable to resolve seller for one or more checkout items");
      err.statusCode = 400;
      throw err;
    }
    if (!grouped.has(sellerId)) {
      grouped.set(sellerId, []);
    }
    grouped.get(sellerId).push(item);
  }
  return grouped;
}

async function computeDistanceKmForSeller({
  sellerId,
  address = null,
  addressLocation = null,
  session = null,
  franchiseContext = null,
}) {
  const normalizedLocation = normalizeLocation(addressLocation || address?.location);

  const query = Seller.findById(sellerId)
    .select("location serviceRadius shopName isPlatformHub isFranchiseCatalogSource")
    .lean();
  if (session) query.session(session);
  const seller = await query;
  if (!seller) {
    const err = new Error("Seller not found");
    err.statusCode = 404;
    throw err;
  }

  const configuredHubId = franchiseContext?.hubSellerId
    ? String(franchiseContext.hubSellerId)
    : null;
  let resolvedHubId = configuredHubId;
  if (!resolvedHubId) {
    const hubId = await getHubSellerId();
    resolvedHubId = hubId ? String(hubId) : null;
  }

  const isHubSeller =
    seller.isPlatformHub === true ||
    seller.isFranchiseCatalogSource === true ||
    (resolvedHubId && resolvedHubId === String(sellerId));

  // Home Shoppy hub catalog orders are fulfilled by the local franchise
  // partner, not last-mile from the platform hub warehouse.
  if (isHubSeller) {
    const routingAddress = normalizeAddressForFranchiseRouting(address);
    let partner = franchiseContext?.franchisePartner;
    if (!partner && !franchiseContext?.isFranchiseHubCart && routingAddress) {
      partner = await resolveFranchisePartner({
        address: routingAddress,
        customerId: franchiseContext?.customerId,
        hydratedItems: franchiseContext?.hydratedItems,
      });
    }
    if (!partner) {
      // Hub-seller fallback: no franchise partner covers the address or
      // none holds full stock, so the hub fulfills directly. Measure from
      // the hub warehouse without the standard serviceRadius gate.
      if (!normalizedLocation) return 0;
      const hubCoords = seller?.location?.coordinates;
      if (!Array.isArray(hubCoords) || hubCoords.length < 2) return 0;
      const [hubLng, hubLat] = hubCoords;
      const hubDistanceMeters = distanceMeters(
        normalizedLocation.lat,
        normalizedLocation.lng,
        Number(hubLat),
        Number(hubLng),
      );
      return Number((hubDistanceMeters / 1000).toFixed(3));
    }
    if (!normalizedLocation) {
      return 0;
    }
    const partnerCoords = partner?.location?.coordinates;
    if (!Array.isArray(partnerCoords) || partnerCoords.length < 2) {
      return 0;
    }
    const [partnerLng, partnerLat] = partnerCoords;
    const distanceInMeters = distanceMeters(
      normalizedLocation.lat,
      normalizedLocation.lng,
      Number(partnerLat),
      Number(partnerLng),
    );
    return Number((distanceInMeters / 1000).toFixed(3));
  }

  if (!normalizedLocation) return 0;

  const coords = seller?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return 0;

  const [sellerLng, sellerLat] = coords;
  const distanceInMeters = distanceMeters(
    normalizedLocation.lat,
    normalizedLocation.lng,
    Number(sellerLat),
    Number(sellerLng),
  );
  const distanceKm = Number((distanceInMeters / 1000).toFixed(3));
  
  const radius = Number(seller.serviceRadius || 5);
  if (distanceKm > radius) {
    const err = new Error(`${seller.shopName || "Store"} does not deliver to your current location (Distance: ${distanceKm}km, Service Radius: ${radius}km)`);
    err.statusCode = 400;
    throw err;
  }

  return distanceKm;
}

function sumField(rows, field) {
  return Number(
    rows.reduce((sum, row) => sum + Number(row?.[field] || 0), 0).toFixed(2),
  );
}

function round2(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function buildAggregateBreakdown(sellerBreakdowns = []) {
  const aggregate = {
    currency: sellerBreakdowns[0]?.currency || "INR",
    productSubtotal: sumField(sellerBreakdowns, "productSubtotal"),
    deliveryFeeCharged: sumField(sellerBreakdowns, "deliveryFeeCharged"),
    handlingFeeCharged: sumField(sellerBreakdowns, "handlingFeeCharged"),
    tipTotal: sumField(sellerBreakdowns, "tipTotal"),
    discountTotal: sumField(sellerBreakdowns, "discountTotal"),
    taxTotal: sumField(sellerBreakdowns, "taxTotal"),
    grandTotal: sumField(sellerBreakdowns, "grandTotal"),
    // Audit Phase 4 (C-1): expose pre-wallet `grossTotal`, the per-checkout
    // `walletAmount` redeemed, and the post-wallet `payableAmount` so the
    // frontend can render the customer-payable line without doing client
    // math. `grandTotal` and `payableAmount` are identical when the flag
    // is on; when the flag is off `payableAmount === grossTotal === grandTotal`.
    grossTotal: sumField(sellerBreakdowns, "grossTotal"),
    walletAmount: sumField(sellerBreakdowns, "walletAmount"),
    payableAmount: sumField(sellerBreakdowns, "payableAmount"),
    sellerPayoutTotal: sumField(sellerBreakdowns, "sellerPayoutTotal"),
    adminProductCommissionTotal: sumField(sellerBreakdowns, "adminProductCommissionTotal"),
    riderPayoutBase: sumField(sellerBreakdowns, "riderPayoutBase"),
    riderPayoutDistance: sumField(sellerBreakdowns, "riderPayoutDistance"),
    riderPayoutBonus: sumField(sellerBreakdowns, "riderPayoutBonus"),
    riderTipAmount: sumField(sellerBreakdowns, "riderTipAmount"),
    riderPayoutTotal: sumField(sellerBreakdowns, "riderPayoutTotal"),
    platformLogisticsMargin: sumField(sellerBreakdowns, "platformLogisticsMargin"),
    platformTotalEarning: sumField(sellerBreakdowns, "platformTotalEarning"),
    codCollectedAmount: sumField(sellerBreakdowns, "codCollectedAmount"),
    codRemittedAmount: sumField(sellerBreakdowns, "codRemittedAmount"),
    codPendingAmount: sumField(sellerBreakdowns, "codPendingAmount"),
    distanceKmActual: sumField(sellerBreakdowns, "distanceKmActual"),
    distanceKmRounded: sumField(sellerBreakdowns, "distanceKmRounded"),
    snapshots: {
      perSeller: sellerBreakdowns.map((row, index) => ({
        index,
        sellerId: row.sellerId,
        snapshots: row.snapshots || {},
      })),
    },
    lineItems: sellerBreakdowns.flatMap((row) =>
      (Array.isArray(row.lineItems) ? row.lineItems : []).map((lineItem) => ({
        ...lineItem,
        sellerId: row.sellerId,
      })),
    ),
  };
  return aggregate;
}

function allocateCheckoutTipToSellerBreakdowns(
  sellerBreakdownEntries = [],
  totalTipAmount = 0,
) {
  const normalizedTip = round2(totalTipAmount);
  if (!Number.isFinite(normalizedTip) || normalizedTip <= 0 || sellerBreakdownEntries.length === 0) {
    return;
  }

  const totalBase = sellerBreakdownEntries.reduce(
    (sum, entry) => sum + Number(entry?.breakdown?.grandTotal || 0),
    0,
  );

  let allocatedSoFar = 0;
  sellerBreakdownEntries.forEach((entry, index) => {
    const breakdown = entry?.breakdown;
    if (!breakdown) return;

    let allocatedTip = 0;
    if (index === sellerBreakdownEntries.length - 1) {
      allocatedTip = round2(normalizedTip - allocatedSoFar);
    } else if (totalBase > 0) {
      allocatedTip = round2(
        (Number(breakdown.grandTotal || 0) / totalBase) * normalizedTip,
      );
      allocatedSoFar = round2(allocatedSoFar + allocatedTip);
    }

    breakdown.tipTotal = round2(Number(breakdown.tipTotal || 0) + allocatedTip);
    breakdown.riderTipAmount = round2(
      Number(breakdown.riderTipAmount || 0) + allocatedTip,
    );
    breakdown.riderPayoutTotal = round2(
      Number(breakdown.riderPayoutTotal || 0) + allocatedTip,
    );
    breakdown.grandTotal = round2(Number(breakdown.grandTotal || 0) + allocatedTip);
  });
}

async function computeGlobalHandlingFeeForCheckout(hydratedItems = [], { session = null } = {}) {
  const headerIds = Array.from(
    new Set(hydratedItems.map((item) => String(item?.headerCategoryId || "")).filter(Boolean)),
  );
  if (headerIds.length === 0) {
    return {
      handlingFeeCharged: 0,
      handlingCategoryUsed: null,
    };
  }

  const categoryQuery = Category.find({ _id: { $in: headerIds } })
    .select("_id name handlingFees handlingFeeType handlingFeeValue")
    .lean();
  if (session) categoryQuery.session(session);
  const categories = await categoryQuery;
  const categoryById = new Map(categories.map((category) => [String(category._id), category]));

  const handling = calculateHandlingFee(hydratedItems, {
    handlingFeeStrategy: HANDLING_FEE_STRATEGY.HIGHEST_CATEGORY_FEE,
    categoryById,
  });

  return {
    handlingFeeCharged: Number(handling.handlingFeeCharged || 0),
    handlingCategoryUsed: handling.handlingCategoryUsed || null,
  };
}

function applyGlobalHandlingFeeToSellerBreakdowns(
  sellerBreakdownEntries = [],
  globalHandling = { handlingFeeCharged: 0, handlingCategoryUsed: null },
) {
  const fee = Number(globalHandling?.handlingFeeCharged || 0);
  if (!Number.isFinite(fee) || fee <= 0 || sellerBreakdownEntries.length === 0) return;

  const usedHeaderId = String(globalHandling?.handlingCategoryUsed?.headerCategoryId || "");
  let chosenSellerId = null;
  if (usedHeaderId) {
    for (const entry of sellerBreakdownEntries) {
      const entryItems = Array.isArray(entry?.items) ? entry.items : [];
      if (entryItems.some((item) => String(item?.headerCategoryId || "") === usedHeaderId)) {
        chosenSellerId = entry.sellerId;
        break;
      }
    }
  }
  if (!chosenSellerId) {
    chosenSellerId = sellerBreakdownEntries[0]?.sellerId || null;
  }

  for (const entry of sellerBreakdownEntries) {
    const breakdown = entry?.breakdown;
    if (!breakdown) continue;

    const shouldCharge = chosenSellerId && entry.sellerId === chosenSellerId;
    const handlingFeeCharged = shouldCharge ? fee : 0;

    breakdown.handlingFeeCharged = handlingFeeCharged;
    breakdown.snapshots = breakdown.snapshots && typeof breakdown.snapshots === "object"
      ? breakdown.snapshots
      : {};
    breakdown.snapshots.handlingFeeStrategy = HANDLING_FEE_STRATEGY.HIGHEST_CATEGORY_FEE;
    breakdown.snapshots.handlingCategoryUsed = shouldCharge
      ? globalHandling.handlingCategoryUsed || {}
      : {};

    const productSubtotal = Number(breakdown.productSubtotal || 0);
    const deliveryFeeCharged = Number(breakdown.deliveryFeeCharged || 0);
    const discountTotal = Number(breakdown.discountTotal || 0);
    const taxTotal = Number(breakdown.taxTotal || 0);
    const riderPayoutTotal = Number(breakdown.riderPayoutTotal || 0);
    const adminProductCommissionTotal = Number(breakdown.adminProductCommissionTotal || 0);

    // Audit Phase 4 (C-1): handling-fee re-compute resets grandTotal to the
    // pre-tip, pre-wallet value. Wallet allocation is applied later (after
    // `allocateCheckoutTipToSellerBreakdowns`) by
    // `applyWalletAllocationToSellerBreakdowns` so it can clamp against the
    // full payable (gross + tip), matching the frontend's clamp.
    const grossTotal = round2(
      productSubtotal + deliveryFeeCharged + handlingFeeCharged - discountTotal + taxTotal,
    );

    breakdown.grossTotal = grossTotal;
    breakdown.grandTotal = grossTotal;
    breakdown.payableAmount = grossTotal;
    breakdown.walletAmount = 0;
    breakdown.platformLogisticsMargin = round2(
      deliveryFeeCharged + handlingFeeCharged - riderPayoutTotal,
    );
    breakdown.platformTotalEarning = round2(
      adminProductCommissionTotal + breakdown.platformLogisticsMargin,
    );
  }
}

// Audit Phase 5 (H-6): when free delivery applies (coupon, MLM digital,
// or cart-subtotal threshold), zero out the customer-facing delivery fee
// on every seller breakdown. The rider keeps their full payout (the
// platform absorbs the campaign cost), so we only adjust
// `deliveryFeeCharged`, `grossTotal`, `grandTotal`, `payableAmount`,
// and `platformLogisticsMargin`. Runs AFTER handling-fee allocation
// (so `grossTotal` exists) and BEFORE tip/wallet allocation (so they
// allocate against the post-rebate grandTotal).
function applyFreeDeliveryToSellerBreakdowns(
  sellerBreakdownEntries = [],
  { reason = "coupon" } = {},
) {
  for (const entry of sellerBreakdownEntries) {
    const breakdown = entry?.breakdown;
    if (!breakdown) continue;
    const oldDeliveryFee = round2(Number(breakdown.deliveryFeeCharged || 0));
    breakdown.snapshots = breakdown.snapshots && typeof breakdown.snapshots === "object"
      ? breakdown.snapshots
      : {};
    if (oldDeliveryFee <= 0) {
      breakdown.snapshots.freeDeliveryRebate = 0;
      breakdown.snapshots.freeDeliveryReason = reason;
      continue;
    }
    breakdown.deliveryFeeCharged = 0;
    breakdown.grossTotal = round2(Number(breakdown.grossTotal || 0) - oldDeliveryFee);
    breakdown.grandTotal = round2(Number(breakdown.grandTotal || 0) - oldDeliveryFee);
    breakdown.payableAmount = breakdown.grandTotal;
    const handlingFeeCharged = Number(breakdown.handlingFeeCharged || 0);
    const riderPayoutTotal = Number(breakdown.riderPayoutTotal || 0);
    const adminProductCommissionTotal = Number(breakdown.adminProductCommissionTotal || 0);
    // Platform now collects only the handling fee against the rider
    // payout — typically a loss, which is the campaign cost we want to
    // attribute to the free-delivery coupon for finance reconciliation.
    breakdown.platformLogisticsMargin = round2(handlingFeeCharged - riderPayoutTotal);
    breakdown.platformTotalEarning = round2(
      adminProductCommissionTotal + breakdown.platformLogisticsMargin,
    );
    breakdown.snapshots.freeDeliveryRebate = oldDeliveryFee;
    breakdown.snapshots.freeDeliveryReason = reason;
  }
}

// Audit Phase 4 (C-1): allocate the checkout-group-level walletAmount
// across sellers proportionately by their post-tip grandTotal, then
// subtract it from each seller's grandTotal. Runs AFTER tip allocation
// so the clamp ceiling matches the frontend's clamp.
//
// When the flag is off, this is a no-op — `breakdown.walletAmount` stays
// at 0 and `grandTotal` is the legacy pre-wallet amount.
function applyWalletAllocationToSellerBreakdowns(
  sellerBreakdownEntries = [],
  totalWalletAmount = 0,
) {
  if (!isWalletRedemptionReducesPayableEnabled()) return;

  const normalizedWallet = round2(totalWalletAmount);
  if (!Number.isFinite(normalizedWallet) || normalizedWallet <= 0 || sellerBreakdownEntries.length === 0) {
    return;
  }

  const totalBase = sellerBreakdownEntries.reduce(
    (sum, entry) => sum + Number(entry?.breakdown?.grandTotal || 0),
    0,
  );
  const cappedWallet = Math.min(normalizedWallet, round2(totalBase));
  if (cappedWallet <= 0) return;

  let allocatedSoFar = 0;
  sellerBreakdownEntries.forEach((entry, index) => {
    const breakdown = entry?.breakdown;
    if (!breakdown) return;

    const grandTotal = Number(breakdown.grandTotal || 0);
    let allocation;
    if (index === sellerBreakdownEntries.length - 1) {
      allocation = round2(cappedWallet - allocatedSoFar);
    } else if (totalBase > 0) {
      allocation = round2((grandTotal / totalBase) * cappedWallet);
      allocatedSoFar = round2(allocatedSoFar + allocation);
    } else {
      allocation = 0;
    }
    allocation = Math.max(0, Math.min(allocation, grandTotal));

    breakdown.walletAmount = round2(Number(breakdown.walletAmount || 0) + allocation);
    breakdown.grandTotal = round2(grandTotal - allocation);
    breakdown.payableAmount = breakdown.grandTotal;
  });
}

export async function buildCheckoutPricingSnapshot({
  orderItems = [],
  address = {},
  tipAmount = 0,
  discountTotal = 0,
  // Audit Phase 4 (C-1): checkout-group-level wallet redemption. Split
  // proportionately to each seller using the subtotal ratio (same rule
  // already used for discount distribution above). Passed through to
  // `generateOrderPaymentBreakdown` which subtracts it from grandTotal
  // when `WALLET_REDEMPTION_REDUCES_PAYABLE` is on. Defaults to 0 so the
  // preview path (which doesn't know walletAmount yet) and existing
  // callers are unaffected.
  walletAmount = 0,
  // Audit Phase 5 (C-2, H-6, H-7): when `SERVER_SIDE_COUPON_ENGINE` is
  // on and a coupon code/id is provided here, the discount is recomputed
  // server-side from the hydrated cart (the `discountTotal` argument is
  // IGNORED to prevent client tampering). `freeDelivery` coupons zero
  // out each seller's `deliveryFeeCharged`. The `couponSnapshot`
  // produced by `computeOrderDiscount` is returned alongside the
  // aggregate breakdown so the placement service can persist it on
  // every Order document for audit and per-user usage counting.
  couponCode = null,
  couponId = null,
  customerId = null,
  session = null,
}) {
  const routingAddress = normalizeAddressForFranchiseRouting(address);
  const hydratedItems = await hydrateOrderItems(orderItems, {
    session,
    enforceServerPricing: true,
  });
  if (!hydratedItems.length) {
    const err = new Error("Cannot checkout with empty cart");
    err.statusCode = 400;
    throw err;
  }

  const productIds = hydratedItems.map((item) => item.productId);
  const stockProductQuery = Product.find({ _id: { $in: productIds } })
    .select("_id name stock variants")
    .lean();
  if (session) stockProductQuery.session(session);
  const stockProducts = await stockProductQuery;
  const stockProductMap = new Map(stockProducts.map((product) => [String(product._id), product]));
  assertHydratedItemsStock(hydratedItems, stockProductMap);

  const hubOnlyCart = await cartIsHubOnly(hydratedItems);
  const itemsBySeller = groupHydratedItemsBySeller(hydratedItems);
  const sellerIds = Array.from(itemsBySeller.keys()).sort((a, b) => a.localeCompare(b));
  const configuredHubId = await getHubSellerId();
  const configuredHubIdStr = configuredHubId ? String(configuredHubId) : null;
  const hasPlatformHubSeller =
    sellerIds.length > 0 &&
    (await Seller.countDocuments({
      _id: { $in: sellerIds },
      isPlatformHub: true,
    })) > 0;
  const hubSellerInCart =
    !!configuredHubIdStr &&
    sellerIds.some((sellerId) => String(sellerId) === configuredHubIdStr);
  const isFranchiseHubCart = hubOnlyCart || hasPlatformHubSeller || hubSellerInCart;

  let franchiseContext = {
    isFranchiseHubCart: false,
    hubSellerId: null,
    franchisePartner: null,
  };
  if (isFranchiseHubCart) {
    const hubSellerId = await getHubSellerId();
    // Stock-aware: only partners holding FULL stock for the cart are
    // eligible. A null partner means the hub seller fulfills directly.
    const franchisePartner = await resolveFranchisePartner({
      address: routingAddress,
      customerId,
      hydratedItems,
    });
    franchiseContext = {
      isFranchiseHubCart: true,
      hubSellerId: hubSellerId ? String(hubSellerId) : null,
      franchisePartner,
      customerId,
      hydratedItems,
    };
  }

  // Audit Phase 5 (C-2): when the flag is ON, route discount through
  // the centralized engine. The client-supplied `discountTotal` is
  // discarded in favour of the server-computed amount so customers
  // cannot self-credit themselves a discount by editing the payload.
  // When the flag is OFF, the legacy client-trust path is preserved
  // bit-for-bit so rollback is an env flip.
  //
  // With the engine ON, `effectiveDiscount` defaults to 0 rather than
  // the client-supplied `discountTotal` — a discount only ever comes
  // from a coupon that actually resolves below. Falling back to the
  // client value here (as an earlier version of this function did)
  // left the exact price-tampering hole the engine exists to close: a
  // request with no `couponCode`/`couponId` but a non-zero
  // `discountTotal` would sail straight through untouched.
  let effectiveDiscount = isServerSideCouponEngineEnabled() ? 0 : round2(discountTotal);
  let resolvedCouponSnapshot = null;
  let resolvedCoupon = null;
  let applyFreeDelivery = false;
  if (isServerSideCouponEngineEnabled() && (couponCode || couponId)) {
    const couponResult = await computeOrderDiscount({
      couponCode,
      couponId,
      customerId,
      hydratedItems,
      session,
    });
    if (couponResult) {
      effectiveDiscount = round2(couponResult.discountAmount);
      resolvedCouponSnapshot = couponResult.couponSnapshot;
      resolvedCoupon = couponResult.coupon;
      applyFreeDelivery = !!couponResult.freeDelivery;
    }
  }

  const sellerBreakdownEntries = [];

  const globalHandling = await computeGlobalHandlingFeeForCheckout(hydratedItems, { session });
  const deliverySettings = await getOrCreateFinanceSettings({ session });
  const freeDeliveryThreshold = round2(
    Number(deliverySettings.freeDeliveryThreshold || 0),
  );

  // Pre-compute each seller's subtotal for proportional discount/wallet distribution
  const sellerSubtotals = new Map();
  let totalSubtotal = 0;
  for (const sellerId of sellerIds) {
    const items = itemsBySeller.get(sellerId) || [];
    const subtotal = items.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 1), 0);
    sellerSubtotals.set(sellerId, subtotal);
    totalSubtotal += subtotal;
  }
  totalSubtotal = round2(totalSubtotal);

  for (const sellerId of sellerIds) {
    const sellerItems = itemsBySeller.get(sellerId) || [];
    const distanceKm = await computeDistanceKmForSeller({
      sellerId,
      address: routingAddress,
      session,
      franchiseContext,
    });
    // Distribute discount proportionally by seller subtotal
    const sellerRatio = totalSubtotal > 0 ? (sellerSubtotals.get(sellerId) || 0) / totalSubtotal : 1 / sellerIds.length;
    const sellerDiscount = round2(effectiveDiscount * sellerRatio);
    // Per-seller wallet allocation is applied LAST (after tip) by
    // `applyWalletAllocationToSellerBreakdowns` so it can clamp against
    // the post-tip grandTotal — matching the customer-facing clamp on the
    // frontend. We deliberately do NOT pass walletAmount through here.
    const breakdown = await generateOrderPaymentBreakdown({
      preHydratedItems: sellerItems,
      distanceKm,
      discountTotal: sellerDiscount,
      taxTotal: 0,
      deliverySettings,
      session,
    });
    sellerBreakdownEntries.push({
      sellerId,
      distanceKm,
      items: sellerItems,
      breakdown: {
        ...breakdown,
        sellerId,
      },
    });
  }

  applyGlobalHandlingFeeToSellerBreakdowns(sellerBreakdownEntries, globalHandling);
  // Free-delivery rebate must run AFTER handling (so `grossTotal` is
  // final on the delivery axis) and BEFORE tip / wallet allocation
  // (so they clamp against the post-rebate grandTotal).
  //
  // Precedence when multiple rules qualify:
  //   1. coupon free_delivery
  //   2. MLM digital-only cart
  //   3. admin cart-subtotal threshold (>=)
  //
  // MLM digital carve-out: when the cart is exclusively the
  // home-shopping SKU, we also apply the free-delivery transform —
  // these are subscription-style purchases with no rider involvement.
  const mlmFreeDelivery = await isDigitalOnlyMlmCart(hydratedItems);
  const thresholdFreeDelivery =
    freeDeliveryThreshold > 0 && totalSubtotal >= freeDeliveryThreshold;
  let freeDeliveryReason = null;
  if (applyFreeDelivery) {
    freeDeliveryReason = "coupon";
  } else if (mlmFreeDelivery) {
    freeDeliveryReason = "digital";
  } else if (thresholdFreeDelivery) {
    freeDeliveryReason = "threshold";
  }
  if (freeDeliveryReason) {
    applyFreeDeliveryToSellerBreakdowns(sellerBreakdownEntries, {
      reason: freeDeliveryReason,
    });
  }
  allocateCheckoutTipToSellerBreakdowns(sellerBreakdownEntries, tipAmount);
  // Audit Phase 4 (C-1): subtract wallet redemption from each seller's
  // grandTotal proportionate to their share. No-op when the flag is off.
  applyWalletAllocationToSellerBreakdowns(sellerBreakdownEntries, walletAmount);

  // Final consistency pass: every breakdown should expose a `payableAmount`
  // that equals its `grandTotal`. The tip-allocation step does not touch
  // `payableAmount`, and the wallet-allocation step is a no-op when the
  // flag is off or walletAmount is 0 — so we normalise here so the field
  // is always reliable for consumers (frontend uses it for the
  // "Slide to Pay" line; admin dashboards use it for reconciliation).
  for (const entry of sellerBreakdownEntries) {
    const breakdown = entry?.breakdown;
    if (!breakdown) continue;
    breakdown.payableAmount = round2(Number(breakdown.grandTotal || 0));
  }

  const aggregateBreakdown = buildAggregateBreakdown(
    sellerBreakdownEntries.map((entry) => entry.breakdown),
  );

  return {
    hydratedItems,
    sellerBreakdownEntries,
    aggregateBreakdown,
    sellerCount: sellerBreakdownEntries.length,
    itemCount: hydratedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    // Hub / platform-franchise catalog carts may pay via the shopping wallet bucket.
    isFranchiseHubCart,
    // Audit Phase 5 (C-2 + H-6): `null` when the flag is off OR no
    // coupon was supplied. When present, callers persist this on every
    // Order document so per-user usage counts and audits replay
    // deterministically against the rule that was in effect.
    couponSnapshot: resolvedCouponSnapshot,
    coupon: resolvedCoupon,
    freeDeliveryApplied: Boolean(freeDeliveryReason),
    freeDeliveryReason,
  };
}

export default {
  buildCheckoutPricingSnapshot,
  groupHydratedItemsBySeller,
};

/**
 * Normalize frozen order money fields for seller/customer UI.
 * Prefers canonical `paymentBreakdown`, falls back to legacy `pricing`.
 */

function toMoney(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeOrderPricing(order) {
  if (!order || typeof order !== "object") {
    return {
      productSubtotal: 0,
      deliveryFee: 0,
      handlingFee: 0,
      discountTotal: 0,
      taxTotal: 0,
      tipTotal: 0,
      walletAmount: 0,
      grandTotal: 0,
    };
  }

  const pb = order.paymentBreakdown || order.pricingSnapshot || {};
  const pricing = order.pricing || {};

  const productSubtotal = toMoney(
    pb.productSubtotal ?? pricing.subtotal ?? order.productSubtotal,
  );
  const deliveryFee = toMoney(
    pb.deliveryFeeCharged ?? pricing.deliveryFee ?? order.deliveryFee,
  );
  const handlingFee = toMoney(
    pb.handlingFeeCharged ?? pricing.platformFee ?? order.handlingFee,
  );
  const discountTotal = toMoney(
    pb.discountTotal ?? pricing.discount ?? order.discountTotal,
  );
  const taxTotal = toMoney(pb.taxTotal ?? pricing.gst ?? order.taxTotal);
  const tipTotal = toMoney(pb.tipTotal ?? pricing.tip ?? order.tipTotal);
  const walletAmount = toMoney(
    pb.walletAmount ?? pricing.walletAmount ?? order.walletAmount,
  );
  const grandTotal = toMoney(
    pb.grandTotal ?? pricing.total ?? order.total ?? order.grandTotal,
  );

  return {
    productSubtotal,
    deliveryFee,
    handlingFee,
    discountTotal,
    taxTotal,
    tipTotal,
    walletAmount,
    grandTotal,
  };
}

export function formatINR(amount, { digits = 2 } = {}) {
  return `₹${toMoney(amount).toFixed(digits)}`;
}

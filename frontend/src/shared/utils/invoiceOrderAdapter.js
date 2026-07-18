import { normalizeOrderPricing } from "./orderPricingSummary.js";

/**
 * Map a live / historical Order API payload into a stable invoice view-model.
 */
export function normalizeInvoiceOrder(order) {
  if (!order || typeof order !== "object") return null;

  const pricing = normalizeOrderPricing(order);
  const address = order.address || {};
  const customer = order.customer || {};

  const items = Array.isArray(order.items)
    ? order.items.map((item) => ({
        name: item?.name || item?.productName || "Item",
        quantity: Number(item?.quantity ?? item?.qty ?? 0) || 0,
        price: Number(item?.price ?? 0) || 0,
        image: item?.image || "",
      }))
    : [];

  const paymentMethodRaw = String(
    order.paymentMode || order.payment?.method || "",
  ).toLowerCase();
  const paymentMethod =
    paymentMethodRaw === "cash" || paymentMethodRaw === "cod"
      ? "Cash on Delivery"
      : paymentMethodRaw
        ? "Online Paid"
        : "—";

  return {
    orderId: order.orderId || order.id || String(order._id || ""),
    createdAt: order.createdAt || null,
    customerName: address.name || customer.name || "Customer",
    customerPhone: address.phone || customer.phone || "",
    addressLine: [
      address.address || address.completeAddress || address.line1,
      address.landmark,
      address.city,
      address.state,
      address.pincode,
    ]
      .filter(Boolean)
      .join(", "),
    items,
    pricing,
    paymentMethod,
    paymentStatus: order.paymentStatus || order.payment?.status || "",
    isGroupSummary: Boolean(order.isGroupSummary),
    hasLineItems: items.length > 0,
  };
}

export function buildInvoiceFilename(orderId) {
  const safeId = String(orderId || "order").replace(/[^\w.-]+/g, "_");
  return `Invoice_${safeId}.pdf`;
}

import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_ROLES,
  ROLE_TO_RECIPIENT_MODEL,
} from "./notification.constants.js";

function normalizeId(value) {
  if (!value) return null;
  if (typeof value === "object" && value._id) {
    return String(value._id);
  }
  return String(value);
}

function normalizeIdList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeId).filter(Boolean);
  }
  const single = normalizeId(value);
  return single ? [single] : [];
}

function truncateText(text, maxLen = 140) {
  const value = String(text || "").trim();
  if (!value) return "";
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}

function getFrontendBaseUrl() {
  const explicit =
    process.env.FRONTEND_URL ||
    process.env.WEB_APP_URL ||
    "http://localhost:5173";
  return String(explicit).trim().replace(/\/+$/, "");
}

function buildOrderLink(orderId) {
  const id = String(orderId || "").trim();
  const baseUrl = getFrontendBaseUrl();
  if (!id) return `${baseUrl}/orders`;
  return `${baseUrl}/orders/${encodeURIComponent(id)}`;
}

function buildCustomerSupportLink(ticketId) {
  const baseUrl = getFrontendBaseUrl();
  const id = String(ticketId || "").trim();
  return id
    ? `${baseUrl}/chat?ticketId=${encodeURIComponent(id)}`
    : `${baseUrl}/chat`;
}

function buildAdminSupportLink(ticketId) {
  const baseUrl = getFrontendBaseUrl();
  const id = String(ticketId || "").trim();
  return id
    ? `${baseUrl}/admin/support-tickets?ticketId=${encodeURIComponent(id)}`
    : `${baseUrl}/admin/support-tickets`;
}

function buildSellerInventoryLink(productId) {
  const baseUrl = getFrontendBaseUrl();
  const id = String(productId || "").trim();
  return id
    ? `${baseUrl}/seller/inventory?productId=${encodeURIComponent(id)}`
    : `${baseUrl}/seller/inventory`;
}

function buildMlmLink(subpath = "") {
  const baseUrl = getFrontendBaseUrl();
  const sub = String(subpath || "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  return sub ? `${baseUrl}/mlm/${sub}` : `${baseUrl}/mlm`;
}

function buildFranchiseOrdersLink() {
  return `${getFrontendBaseUrl()}/mlm/franchise/orders`;
}

const MLM_EVENT_LINKS = {
  [NOTIFICATION_EVENTS.MLM_MEMBERSHIP_ACTIVATED]: () => buildMlmLink(""),
  [NOTIFICATION_EVENTS.MLM_BONUS_CREDITED]: () => buildMlmLink("earnings"),
  [NOTIFICATION_EVENTS.MLM_PLAN_B_UPGRADED]: () =>
    buildMlmLink("home-shopping"),
  [NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REQUESTED]: () =>
    buildMlmLink("withdrawals"),
  [NOTIFICATION_EVENTS.MLM_WITHDRAWAL_APPROVED]: () =>
    buildMlmLink("withdrawals"),
  [NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REJECTED]: () =>
    buildMlmLink("withdrawals"),
  [NOTIFICATION_EVENTS.MLM_MILESTONE_REACHED]: () => buildMlmLink("earnings"),
};

function eventDefinition(eventType) {
  switch (eventType) {
    case NOTIFICATION_EVENTS.ORDER_PLACED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Order Placed",
        body: () => "Your order has been placed successfully.",
      };
    case NOTIFICATION_EVENTS.PAYMENT_SUCCESS:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Payment Successful",
        body: () => "Payment received for your order.",
      };
    case NOTIFICATION_EVENTS.ORDER_CONFIRMED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Order Confirmed",
        body: () => "Seller has confirmed your order.",
      };
    case NOTIFICATION_EVENTS.ORDER_PACKED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Order Packed",
        body: () => "Your order is packed and ready.",
      };
    case NOTIFICATION_EVENTS.OUT_FOR_DELIVERY:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Out For Delivery",
        body: () => "Your order is on the way.",
      };
    case NOTIFICATION_EVENTS.ORDER_DELIVERED:
      return {
        multi: true,
        definitions: [
          {
            role: NOTIFICATION_ROLES.CUSTOMER,
            recipientIds: (payload) =>
              normalizeIdList(payload.userId || payload.customerId),
            title: () => "Order Delivered",
            body: () => "Your order has been delivered.",
          },
          {
            role: NOTIFICATION_ROLES.SELLER,
            recipientIds: (payload) => normalizeIdList(payload.sellerId),
            title: () => "Order Delivered ✅",
            body: (payload) =>
              payload.orderId
                ? `Order #${payload.orderId} has been delivered to the customer.`
                : "Your order has been delivered to the customer.",
          },
          {
            role: NOTIFICATION_ROLES.DELIVERY,
            recipientIds: (payload) => normalizeIdList(payload.deliveryId),
            title: () => "Delivery Completed! 🏁",
            body: (payload) =>
              payload.orderId
                ? `You have successfully delivered order #${payload.orderId}.`
                : "Delivery completed successfully.",
          },
        ],
      };
    case NOTIFICATION_EVENTS.ORDER_CANCELLED:
      return {
        multi: true,
        definitions: [
          {
            role: NOTIFICATION_ROLES.CUSTOMER,
            recipientIds: (payload) =>
              normalizeIdList(payload.userId || payload.customerId),
            title: () => "Order Cancelled",
            body: (payload) =>
              payload.customerMessage || "Your order has been cancelled.",
          },
          {
            role: NOTIFICATION_ROLES.SELLER,
            recipientIds: (payload) =>
              normalizeIdList(payload.sellerId || payload.sellerIds),
            title: () => "Order Cancelled",
            body: (payload) =>
              payload.sellerMessage ||
              (payload.orderId
                ? `Order #${payload.orderId} has been cancelled.`
                : "An order has been cancelled."),
          },
        ],
      };
    case NOTIFICATION_EVENTS.REFUND_INITIATED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Refund Initiated",
        body: () => "Refund has been initiated for your order.",
      };
    case NOTIFICATION_EVENTS.REFUND_COMPLETED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Refund Completed",
        body: () => "Refund has been completed.",
      };
    case NOTIFICATION_EVENTS.NEW_ORDER:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) =>
          normalizeIdList(payload.sellerId || payload.sellerIds),
        title: () => "New Order",
        body: (payload) =>
          payload.orderId
            ? `New order #${payload.orderId} received.`
            : "You have received a new order.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_HUB_ORDER_PENDING:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) =>
          normalizeIdList(payload.sellerId || payload.sellerIds),
        title: () => "Franchise Order — Action Required",
        body: (payload) =>
          payload.orderId
            ? `Order #${payload.orderId} was accepted by a franchise partner. Please confirm to proceed.`
            : "A franchise partner accepted an order. Please confirm to proceed.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_HUB_ACCEPTED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) => normalizeIdList(payload.userId),
        title: () => "Hub Confirmed Your Order",
        body: (payload) =>
          payload.orderId
            ? `Harsh's Hub accepted order #${payload.orderId}. You can now create shipment.`
            : "Harsh's Hub accepted the order. You can now create shipment.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_ORDER_ROUTED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) => normalizeIdList(payload.userId),
        title: () => "New Customer Order",
        body: (payload) =>
          payload.orderId
            ? `Order #${payload.orderId} was routed to your franchise location. Please accept or reject.`
            : "A new customer order was routed to your franchise location.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_REQUESTED:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.userId || payload.sellerId),
        title: () => "New Franchise Stock Purchase Request",
        body: (payload) =>
          payload.orderId
            ? `Franchise partner placed stock order #${payload.orderId}. Please dispatch when ready.`
            : "A new franchise stock purchase request was placed.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_DISPATCHED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) => normalizeIdList(payload.userId),
        title: () => "Stock Order Dispatched",
        body: (payload) =>
          payload.orderId
            ? `Harsh's Hub dispatched stock order #${payload.orderId}. Please confirm receipt once delivered.`
            : "Harsh's Hub dispatched your stock order.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_RECEIVED:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.userId || payload.sellerId),
        title: () => "Stock Order Received & Confirmed",
        body: (payload) =>
          payload.orderId
            ? `Franchise partner confirmed receipt of stock order #${payload.orderId}.`
            : "Franchise partner confirmed receipt of stock order.",
      };
    case NOTIFICATION_EVENTS.FRANCHISE_STOCK_ORDER_CANCELLED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) => normalizeIdList(payload.userId),
        title: () => "Stock Order Cancelled",
        body: (payload) =>
          payload.orderId
            ? `Stock order #${payload.orderId} was cancelled. Wallet has been refunded.`
            : "Stock order was cancelled. Wallet has been refunded.",
      };
    case NOTIFICATION_EVENTS.DELIVERY_ASSIGNED:
      return {
        role: NOTIFICATION_ROLES.DELIVERY,
        recipientIds: (payload) => normalizeIdList(payload.deliveryId),
        title: () => "Delivery Assigned",
        body: (payload) =>
          payload.orderId
            ? `You have been assigned order #${payload.orderId}.`
            : "A new delivery has been assigned to you.",
      };
    case NOTIFICATION_EVENTS.NEW_DELIVERY_BROADCAST:
      return {
        role: NOTIFICATION_ROLES.DELIVERY,
        recipientIds: (payload) => normalizeIdList(payload.deliveryIds),
        title: () => "New Delivery Request 🛍️",
        body: (payload) =>
          payload.orderId
            ? `New order #${payload.orderId} is available nearby.`
            : "A new delivery request is available nearby.",
      };
    case NOTIFICATION_EVENTS.ORDER_READY:
      return {
        role: NOTIFICATION_ROLES.DELIVERY,
        recipientIds: (payload) => normalizeIdList(payload.deliveryId),
        title: () => "Order Ready",
        body: (payload) =>
          payload.orderId
            ? `Order #${payload.orderId} is ready for pickup.`
            : "An order is ready for pickup.",
      };
    // ── Return Workflow Events ──────────────────────────────────────────────
    case NOTIFICATION_EVENTS.RETURN_REQUESTED:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.sellerId),
        title: () => "Return Request Received",
        body: (payload) =>
          payload.orderId
            ? `Customer has requested a return for order #${payload.orderId}.`
            : "A new return request has been received.",
      };
    case NOTIFICATION_EVENTS.RETURN_APPROVED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.customerId || payload.userId),
        title: () => "Return Approved ✅",
        body: (payload) =>
          payload.orderId
            ? `Your return request for order #${payload.orderId} has been approved. A delivery partner will collect the product.`
            : "Your return request has been approved.",
      };
    case NOTIFICATION_EVENTS.RETURN_REJECTED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.customerId || payload.userId),
        title: () => "Return Request Rejected",
        body: (payload) =>
          `Your return request for order #${payload.orderId || ""} was rejected.${
            payload.data?.reason ? " Reason: " + payload.data.reason : ""
          }`,
      };
    case NOTIFICATION_EVENTS.NEW_RETURN_BROADCAST:
      return {
        role: NOTIFICATION_ROLES.DELIVERY,
        recipientIds: (payload) => normalizeIdList(payload.deliveryIds),
        title: () => "New Return Pickup Task 📦",
        body: (payload) =>
          payload.orderId
            ? `Return pickup for order #${payload.orderId} is available nearby.`
            : "A new return pickup task is available nearby.",
      };
    case NOTIFICATION_EVENTS.RETURN_PICKUP_ASSIGNED:
      return {
        role: NOTIFICATION_ROLES.DELIVERY,
        recipientIds: (payload) => normalizeIdList(payload.deliveryId),
        title: () => "Return Pickup Assigned",
        body: (payload) =>
          `Return pickup for order #${payload.orderId || ""}.${
            payload.data?.commission
              ? " Commission: ₹" + payload.data.commission + "."
              : ""
          } Check app for details.`,
      };
    case NOTIFICATION_EVENTS.RETURN_PICKUP_OTP:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.customerId || payload.userId),
        title: () => "Your Return Pickup OTP 🔐",
        body: (payload) =>
          payload.data?.otp
            ? `Your return pickup OTP is ${payload.data.otp}. Share this with the delivery partner. Valid for 10 mins.`
            : "Your return pickup OTP has been sent.",
      };
    case NOTIFICATION_EVENTS.RETURN_DROP_OTP:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.sellerId),
        title: () => "Return Drop OTP 🔐",
        body: (payload) =>
          payload.data?.otp
            ? `Return drop OTP for order #${payload.orderId}: ${payload.data.otp}. Share with delivery partner.`
            : "A return drop OTP has been generated.",
      };
    case NOTIFICATION_EVENTS.RETURN_COMPLETED:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.sellerId),
        title: () => "Product Returned to Store",
        body: (payload) =>
          `Product for order #${payload.orderId || ""} has been returned. Admin QC is pending.`,
      };
    case NOTIFICATION_EVENTS.RETURN_QC_PASSED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.customerId || payload.userId),
        title: () => "QC Passed — Refund Initiated 💸",
        body: (payload) =>
          `Quality check passed for order #${payload.orderId || ""}. Refund of ₹${
            payload.data?.refundAmount || 0
          } credited to your wallet.`,
      };
    case NOTIFICATION_EVENTS.RETURN_QC_FAILED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.customerId || payload.userId),
        title: () => "QC Failed — No Refund",
        body: (payload) =>
          `Quality check failed for order #${payload.orderId || ""}. No refund will be issued.${
            payload.data?.note ? " Note: " + payload.data.note : ""
          }`,
      };
    case NOTIFICATION_EVENTS.SUPPORT_TICKET_MESSAGE:
      return {
        multi: true,
        definitions: [
          {
            role: NOTIFICATION_ROLES.ADMIN,
            recipientIds: (payload) => {
              const fromRole = String(payload.fromRole || "").toLowerCase();
              if (fromRole === "admin") return [];
              return normalizeIdList(payload.adminIds);
            },
            title: (payload) => {
              const name =
                String(payload.userName || "Customer").trim() || "Customer";
              return `Support message from ${name}`;
            },
            body: (payload) =>
              truncateText(payload.messageText || "New message"),
          },
          {
            role: NOTIFICATION_ROLES.CUSTOMER,
            recipientIds: (payload) => {
              const fromRole = String(payload.fromRole || "").toLowerCase();
              if (fromRole !== "admin") return [];
              return normalizeIdList(payload.userId || payload.customerId);
            },
            title: () => "Support reply",
            body: (payload) =>
              truncateText(payload.messageText || "New message"),
          },
        ],
      };
    case NOTIFICATION_EVENTS.LOW_STOCK_ALERT:
      return {
        role: NOTIFICATION_ROLES.SELLER,
        recipientIds: (payload) => normalizeIdList(payload.sellerId),
        title: (payload) => {
          const productName =
            String(payload.productName || "Product").trim() || "Product";
          return `${productName} is running low`;
        },
        body: (payload) => {
          const variantName = String(payload.variantName || "").trim();
          const currentStock = Number(payload.currentStock || 0);
          const itemLabel = variantName ? `${variantName}` : "this item";
          return `Only ${currentStock} left for ${itemLabel}. Restock soon.`;
        },
      };
    // ── MLM Phase 5 — customer reward programme notifications ─────────────
    case NOTIFICATION_EVENTS.MLM_MEMBERSHIP_ACTIVATED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Welcome to the rewards programme 🎉",
        body: (payload) =>
          payload.data?.referralCode
            ? `Your referral code is ${payload.data.referralCode}. Share it to start earning.`
            : "Your rewards membership is now active. Open the app to view your dashboard.",
      };
    case NOTIFICATION_EVENTS.MLM_BONUS_CREDITED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Bonus credited 💰",
        body: (payload) => {
          const amt = Number(payload.data?.amount || 0);
          // Customer-MLM-rebuild Phase 6: never default to the "MLM"
          // string for customer-visible push bodies. Fall back to a
          // generic "reward" label when bonusType is missing.
          const rawType = String(payload.data?.bonusType || "reward");
          const type = rawType.replace(/_/g, " ").toLowerCase();
          return amt > 0
            ? `₹${amt.toLocaleString("en-IN")} ${type} credited to your pending wallet.`
            : "A new bonus has been credited to your rewards wallet.";
        },
      };
    case NOTIFICATION_EVENTS.MLM_PLAN_B_UPGRADED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Plan B unlocked 🚀",
        body: () =>
          "You've been auto-upgraded to Plan B. Premium shopping wallet + Home Shopping unlocked.",
      };
    case NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REQUESTED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Withdrawal request received",
        body: (payload) => {
          const amt = Number(payload.data?.amount || 0);
          const net = Number(payload.data?.netAmount || 0);
          return `Your withdrawal of ₹${amt.toLocaleString("en-IN")} (net ₹${net.toLocaleString("en-IN")}) is pending admin approval.`;
        },
      };
    case NOTIFICATION_EVENTS.MLM_WITHDRAWAL_APPROVED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Withdrawal paid ✅",
        body: (payload) => {
          const net = Number(payload.data?.netAmount || 0);
          const ref = payload.data?.payoutReference;
          return `₹${net.toLocaleString("en-IN")} has been paid out${ref ? ` (UTR ${ref})` : ""}.`;
        },
      };
    case NOTIFICATION_EVENTS.MLM_WITHDRAWAL_REJECTED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Withdrawal rejected",
        body: (payload) => {
          const reason = String(payload.data?.reason || "").trim();
          return reason
            ? `Your withdrawal was rejected. Reason: ${reason}. The amount has been credited back to your earnings wallet.`
            : "Your withdrawal was rejected. The amount has been credited back to your earnings wallet.";
        },
      };
    case NOTIFICATION_EVENTS.MLM_MILESTONE_REACHED:
      return {
        role: NOTIFICATION_ROLES.CUSTOMER,
        recipientIds: (payload) =>
          normalizeIdList(payload.userId || payload.customerId),
        title: () => "Milestone achieved 🏆",
        body: (payload) => {
          const name =
            String(payload.data?.milestoneName || "milestone").trim() ||
            "milestone";
          const reward = Number(payload.data?.rewardAmount || 0);
          return reward > 0
            ? `${name} unlocked. ₹${reward.toLocaleString("en-IN")} reward credited.`
            : `${name} unlocked.`;
        },
      };
    default:
      return null;
  }
}

function eventData(eventType, payload = {}, role) {
  if (eventType === NOTIFICATION_EVENTS.LOW_STOCK_ALERT) {
    const productId = String(payload.productId || "").trim() || undefined;
    return {
      eventType,
      productId,
      currentStock: Number(payload.currentStock || 0),
      threshold: Number(payload.threshold || 0),
      variantSku: String(payload.variantSku || "").trim() || undefined,
      variantName: String(payload.variantName || "").trim() || undefined,
      imageUrl: String(payload.imageUrl || "").trim() || undefined,
      link: buildSellerInventoryLink(productId),
      ...(payload.data || {}),
    };
  }

  if (eventType === NOTIFICATION_EVENTS.SUPPORT_TICKET_MESSAGE) {
    const ticketId = String(payload.ticketId || "").trim() || undefined;
    const link =
      role === NOTIFICATION_ROLES.ADMIN
        ? buildAdminSupportLink(ticketId)
        : buildCustomerSupportLink(ticketId);

    return {
      eventType,
      ticketId,
      link,
      ...(payload.data || {}),
    };
  }

  if (MLM_EVENT_LINKS[eventType]) {
    return {
      eventType,
      link: MLM_EVENT_LINKS[eventType](),
      ...(payload.data || {}),
    };
  }

  if (eventType === NOTIFICATION_EVENTS.FRANCHISE_ORDER_ROUTED) {
    const orderId =
      String(payload.orderId || payload.publicOrderId || "").trim() ||
      undefined;
    return {
      eventType,
      orderId,
      link: buildFranchiseOrdersLink(),
      ...(payload.data || {}),
    };
  }

  if (eventType === NOTIFICATION_EVENTS.FRANCHISE_HUB_ACCEPTED) {
    const orderId =
      String(payload.orderId || payload.publicOrderId || "").trim() ||
      undefined;
    return {
      eventType,
      orderId,
      link: buildFranchiseOrdersLink(),
      ...(payload.data || {}),
    };
  }

  const orderId = String(payload.orderId || "").trim() || undefined;
  const checkoutGroupId =
    String(payload.checkoutGroupId || "").trim() || undefined;
  return {
    eventType,
    orderId,
    checkoutGroupId,
    link: buildOrderLink(orderId),
    ...(payload.data || {}),
  };
}

export function buildNotification(eventType, payload = {}) {
  const result = eventDefinition(eventType);
  if (!result) return [];

  const definitions = result.multi ? result.definitions : [result];
  const notifications = [];

  for (const def of definitions) {
    const recipientIds = def.recipientIds(payload);
    if (!recipientIds.length) continue;

    const role = def.role;
    const title = def.title(payload);
    const body = def.body(payload);
    const data = eventData(eventType, payload, role);

    recipientIds.forEach((recipientId) => {
      notifications.push({
        userId: recipientId,
        role,
        recipient: recipientId,
        recipientModel: ROLE_TO_RECIPIENT_MODEL[role],
        type: eventType,
        title,
        body,
        message: body,
        data,
        channel: "push",
        provider: "fcm",
      });
    });
  }

  return notifications;
}

export default {
  buildNotification,
};

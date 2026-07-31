/**
 * RazorpayAdapter
 *
 * Single home for the Razorpay SDK in the codebase. paymentService.js calls
 * only this adapter (through the providerRegistry) and never imports
 * `razorpay` directly.
 */

import crypto from "crypto";
import Razorpay from "razorpay";

import { PAYMENT_STATUS, PAYMENT_GATEWAY } from "../../../constants/payment.js";
import { PaymentProviderPort } from "../ports/paymentProviderPort.js";
import logger from "../../logger.js";

const RAZORPAY_RECEIPT_MAX = 40;

let _razorpayClient = null;

function getRazorpayCredentials() {
  const keyId = String(process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET || "").trim();
  const webhookSecret = String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
  return { keyId, keySecret, webhookSecret };
}

function buildRazorpayClient() {
  const { keyId, keySecret } = getRazorpayCredentials();
  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials not configured");
  }
  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

function getRazorpayClient() {
  if (_razorpayClient) return _razorpayClient;
  _razorpayClient = buildRazorpayClient();
  return _razorpayClient;
}

/** Razorpay receipt max length is 40. Prefer a stable truncated/hash form. */
export function buildRazorpayReceipt(merchantOrderId) {
  const raw = String(merchantOrderId || "").trim();
  if (!raw) return `rcpt-${Date.now()}`.slice(0, RAZORPAY_RECEIPT_MAX);
  if (raw.length <= RAZORPAY_RECEIPT_MAX) return raw;
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  const keep = RAZORPAY_RECEIPT_MAX - 1 - hash.length;
  return `${raw.slice(0, Math.max(1, keep))}-${hash}`;
}

function wrapGatewayError(operation, error, context = {}) {
  const httpStatusCode = Number(
    error?.statusCode || error?.status || error?.error?.code,
  );
  const rawMessage = String(
    error?.error?.description || error?.message || "",
  ).trim();

  logger.error(`[Razorpay] ${operation} failed`, {
    ...context,
    statusCode: error?.statusCode || null,
    errorCode: error?.error?.code || null,
    description: rawMessage,
  });

  let statusCode = 502;
  let code = "PAYMENT_GATEWAY_ERROR";
  let message =
    "Payment gateway is temporarily unavailable. Please try again in a few minutes.";

  if (httpStatusCode === 401 || httpStatusCode === 403) {
    statusCode = 502;
    code = "PAYMENT_GATEWAY_AUTH_FAILED";
    message =
      "Payment gateway authentication failed. Please contact support — the merchant account is mis-configured.";
  } else if (httpStatusCode === 400) {
    statusCode = 502;
    code = "PAYMENT_GATEWAY_BAD_REQUEST";
    message =
      "Payment gateway rejected the request. Please contact support if this persists.";
  } else if (httpStatusCode >= 500) {
    statusCode = 502;
    code = "PAYMENT_GATEWAY_UPSTREAM_ERROR";
  } else if (
    error?.code === "ECONNREFUSED" ||
    error?.code === "ETIMEDOUT" ||
    error?.code === "ENOTFOUND"
  ) {
    statusCode = 503;
    code = "PAYMENT_GATEWAY_UNREACHABLE";
    message =
      "Cannot reach the payment gateway right now. Please check your connection and try again.";
  }

  const wrapped = new Error(message);
  wrapped.statusCode = statusCode;
  wrapped.code = code;
  wrapped.cause = error;
  return wrapped;
}

function rawBodyToString(rawBody) {
  if (Buffer.isBuffer(rawBody)) return rawBody.toString("utf8");
  if (typeof rawBody === "string") return rawBody;
  return JSON.stringify(rawBody || {});
}

export class RazorpayAdapter extends PaymentProviderPort {
  get providerName() {
    return PAYMENT_GATEWAY.RAZORPAY;
  }

  async initiatePayment({
    merchantOrderId,
    amountPaise,
    customer = null,
    description = null,
  }) {
    const { keyId } = getRazorpayCredentials();
    if (!keyId) {
      const err = new Error("Razorpay credentials not configured");
      err.statusCode = 502;
      err.code = "PAYMENT_GATEWAY_AUTH_FAILED";
      throw err;
    }

    const client = getRazorpayClient();
    const receipt = buildRazorpayReceipt(merchantOrderId);
    const amount = Math.round(Number(amountPaise) || 0);
    const notes = { merchantOrderId: String(merchantOrderId) };

    try {
      const order = await client.orders.create({
        amount,
        currency: "INR",
        receipt,
        notes,
        payment_capture: 1,
      });

      const checkout = {
        keyId,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency || "INR",
        name: process.env.RAZORPAY_CHECKOUT_NAME || "ShopAndEarn",
        description:
          description ||
          `Payment for ${merchantOrderId}`,
        notes,
        prefill: {},
      };

      if (customer?.name) checkout.prefill.name = String(customer.name);
      if (customer?.email) checkout.prefill.email = String(customer.email);
      if (customer?.phone || customer?.mobile) {
        checkout.prefill.contact = String(customer.phone || customer.mobile);
      }

      return {
        checkout,
        gatewayOrderId: order.id,
        gatewayResponse: order,
      };
    } catch (error) {
      throw wrapGatewayError("initiatePayment", error, {
        merchantOrderId,
        amountPaise: amount,
      });
    }
  }

  async getPaymentStatus({ merchantOrderId, razorpayOrderId }) {
    const orderId = String(razorpayOrderId || "").trim();
    if (!orderId) {
      const err = new Error(
        "Razorpay order id is required to fetch payment status",
      );
      err.statusCode = 400;
      throw err;
    }

    const client = getRazorpayClient();
    try {
      const order = await client.orders.fetch(orderId);
      let transactionId = null;
      let paymentStatus = order.status;

      if (order.status === "paid") {
        try {
          const payments = await client.orders.fetchPayments(orderId);
          const items = Array.isArray(payments?.items) ? payments.items : [];
          const captured =
            items.find((p) => p.status === "captured") ||
            items.find((p) => p.status === "authorized") ||
            items[0];
          if (captured?.id) transactionId = captured.id;
          if (captured?.status) paymentStatus = captured.status;
        } catch (paymentErr) {
          logger.warn("[Razorpay] fetchPayments failed; using order status", {
            merchantOrderId,
            razorpayOrderId: orderId,
            message: paymentErr?.message,
          });
        }
      }

      return {
        state: paymentStatus || order.status,
        transactionId,
        responseCode: order.status,
        gatewayResponse: order,
      };
    } catch (error) {
      throw wrapGatewayError("getPaymentStatus", error, {
        merchantOrderId,
        razorpayOrderId: orderId,
      });
    }
  }

  verifyCheckoutSignature({
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature,
  }) {
    const { keySecret } = getRazorpayCredentials();
    if (!keySecret) return false;

    const orderId = String(razorpayOrderId || "").trim();
    const paymentId = String(razorpayPaymentId || "").trim();
    const signature = String(razorpaySignature || "").trim();
    if (!orderId || !paymentId || !signature) return false;

    const expected = crypto
      .createHmac("sha256", keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    try {
      const expectedBuf = Buffer.from(expected, "utf8");
      const actualBuf = Buffer.from(signature, "utf8");
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  async validateWebhook({ rawBody, signature }) {
    const { webhookSecret } = getRazorpayCredentials();
    // Webhooks are optional. Capture is driven by Standard Checkout
    // client signature verify (KEY_SECRET). When no webhook secret is
    // configured, refuse all webhook deliveries rather than accepting
    // unsigned payloads.
    if (!webhookSecret) {
      const err = new Error(
        "Razorpay webhooks are disabled (RAZORPAY_WEBHOOK_SECRET not set). Use checkout signature verify.",
      );
      err.statusCode = 503;
      err.code = "WEBHOOK_DISABLED";
      throw err;
    }
    const sig = String(signature || "").trim();
    if (!sig) return false;

    const body = rawBodyToString(rawBody);
    const expected = crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex");

    try {
      const expectedBuf = Buffer.from(expected, "utf8");
      const actualBuf = Buffer.from(sig, "utf8");
      if (expectedBuf.length !== actualBuf.length) return false;
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }

  async decodeWebhookPayload({ rawBody }) {
    let payload;
    try {
      payload = JSON.parse(rawBodyToString(rawBody));
    } catch {
      const err = new Error("Invalid format: Webhook body must be JSON");
      err.statusCode = 400;
      throw err;
    }

    const event = String(payload?.event || "").toLowerCase();
    const paymentEntity =
      payload?.payload?.payment?.entity ||
      payload?.payload?.order?.entity ||
      null;

    const merchantOrderId =
      paymentEntity?.notes?.merchantOrderId ||
      payload?.payload?.payment?.entity?.notes?.merchantOrderId ||
      payload?.payload?.order?.entity?.notes?.merchantOrderId ||
      null;

    const transactionId =
      paymentEntity?.id && String(paymentEntity.id).startsWith("pay_")
        ? paymentEntity.id
        : payload?.payload?.payment?.entity?.id || null;

    let state = "pending";
    if (
      event === "payment.captured" ||
      event === "order.paid" ||
      paymentEntity?.status === "captured" ||
      paymentEntity?.status === "paid"
    ) {
      state = "captured";
    } else if (
      event === "payment.failed" ||
      paymentEntity?.status === "failed"
    ) {
      state = "failed";
    } else if (paymentEntity?.status) {
      state = paymentEntity.status;
    }

    const stableEventId =
      payload?.id ||
      crypto
        .createHash("sha256")
        .update(
          `${transactionId || ""}|${event}|${state}|${merchantOrderId || ""}`,
        )
        .digest("hex");

    return {
      eventId: stableEventId,
      merchantOrderId,
      state,
      transactionId,
      responseCode: event || paymentEntity?.status,
      razorpayOrderId:
        paymentEntity?.order_id ||
        payload?.payload?.order?.entity?.id ||
        null,
      raw: payload,
    };
  }

  mapStatusToInternal(gatewayState) {
    const normalized = String(gatewayState || "").toLowerCase();
    if (
      normalized === "captured" ||
      normalized === "paid" ||
      normalized === "payment.captured" ||
      normalized === "order.paid"
    ) {
      return PAYMENT_STATUS.CAPTURED;
    }
    if (
      normalized === "failed" ||
      normalized === "payment.failed" ||
      normalized === "cancelled" ||
      normalized === "canceled"
    ) {
      return PAYMENT_STATUS.FAILED;
    }
    if (normalized === "authorized") {
      return PAYMENT_STATUS.AUTHORIZED;
    }
    return PAYMENT_STATUS.PENDING;
  }
}

export default RazorpayAdapter;

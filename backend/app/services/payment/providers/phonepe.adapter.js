/**
 * PhonePeAdapter
 *
 * Single home for the PhonePe SDK in the codebase. paymentService.js calls
 * only this adapter (through the providerRegistry) and never imports
 * `@phonepe-pg/pg-sdk-node` directly.
 *
 * Swap-out is a one-line change in providerRegistry.js + a new adapter file
 * implementing the same `PaymentProviderPort` contract.
 */

import crypto from "crypto";
import {
  StandardCheckoutClient,
  Env,
  StandardCheckoutPayRequest,
} from "@phonepe-pg/pg-sdk-node";

import { PAYMENT_STATUS, PAYMENT_GATEWAY } from "../../../constants/payment.js";
import { PaymentProviderPort } from "../ports/paymentProviderPort.js";
import logger from "../../logger.js";

let _phonePeClient = null;

function buildPhonePeClient() {
  const clientId = String(process.env.PHONEPE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.PHONEPE_CLIENT_SECRET || "").trim();
  const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION || "1", 10);
  const isProd =
    String(process.env.PHONEPE_ENV || "").toUpperCase() === "PRODUCTION";

  if (!clientId || !clientSecret) {
    throw new Error("PhonePe credentials not configured");
  }

  return StandardCheckoutClient.getInstance(
    clientId,
    clientSecret,
    clientVersion,
    isProd ? Env.PRODUCTION : Env.SANDBOX,
  );
}

function getPhonePeClient() {
  if (_phonePeClient) return _phonePeClient;
  _phonePeClient = buildPhonePeClient();
  return _phonePeClient;
}

/**
 * Translate raw PhonePe SDK errors into a domain error the controller layer
 * already knows how to surface (`statusCode`, `message`, `code`). Without
 * this, customers see cryptic strings like "Unauthorized" with HTTP 500
 * which look like our bug, not a gateway failure.
 *
 * We also log the full original error once per call site so operators can
 * see the underlying PhonePe httpStatusCode/type/code and correlate with
 * dashboard activity.
 */
function wrapPhonePeError(operation, error, context = {}) {
  const httpStatusCode = Number(error?.httpStatusCode || error?.code);
  const rawType = String(error?.type || "").toUpperCase();
  const rawMessage = String(error?.message || "").trim();
  const envHint =
    String(process.env.PHONEPE_ENV || "").toUpperCase() === "PRODUCTION"
      ? "PRODUCTION"
      : "SANDBOX";

  logger.error(`[PhonePe] ${operation} failed`, {
    ...context,
    phonepeEnv: envHint,
    httpStatusCode: error?.httpStatusCode || null,
    type: error?.type || null,
    code: error?.code || null,
    data: error?.data || null,
    message: rawMessage,
  });

  let statusCode = 502;
  let code = "PAYMENT_GATEWAY_ERROR";
  let message =
    "Payment gateway is temporarily unavailable. Please try again in a few minutes.";

  if (httpStatusCode === 401 || rawType === "UNAUTHORIZEDACCESS") {
    statusCode = 502;
    code = "PAYMENT_GATEWAY_AUTH_FAILED";
    message =
      "Payment gateway authentication failed. " +
      "Please contact support — the merchant account is mis-configured " +
      `(env=${envHint}).`;
  } else if (httpStatusCode === 400 || rawType === "BADREQUEST") {
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

export class PhonePeAdapter extends PaymentProviderPort {
  get providerName() {
    return PAYMENT_GATEWAY.PHONEPE;
  }

  async initiatePayment({ merchantOrderId, amountPaise, redirectUrl }) {
    const client = getPhonePeClient();
    const request = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantOrderId)
      .amount(amountPaise)
      .redirectUrl(redirectUrl)
      .build();
    try {
      const response = await client.pay(request);
      return {
        redirectUrl: response.redirectUrl,
        gatewayResponse: response,
      };
    } catch (error) {
      throw wrapPhonePeError("initiatePayment", error, {
        merchantOrderId,
        amountPaise,
      });
    }
  }

  async getPaymentStatus({ merchantOrderId }) {
    const client = getPhonePeClient();
    try {
      const response = await client.getOrderStatus(merchantOrderId);
      return {
        state: response.state,
        transactionId: response.transactionId,
        responseCode: response.responseCode,
        gatewayResponse: response,
      };
    } catch (error) {
      throw wrapPhonePeError("getPaymentStatus", error, { merchantOrderId });
    }
  }

  async validateWebhook({ rawBody, authorization }) {
    const client = getPhonePeClient();
    let jsonPayload;
    try {
      jsonPayload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      const err = new Error("Invalid format: Webhook body must be JSON");
      err.statusCode = 400;
      throw err;
    }
    const base64Response = jsonPayload.response;
    if (!base64Response) {
      const err = new Error("Invalid payload: Missing 'response' field");
      err.statusCode = 400;
      throw err;
    }
    const ok = await client.validateCallback(base64Response, authorization);
    return ok;
  }

  async decodeWebhookPayload({ rawBody }) {
    let jsonPayload;
    try {
      jsonPayload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      const err = new Error("Invalid format: Webhook body must be JSON");
      err.statusCode = 400;
      throw err;
    }
    const base64Response = jsonPayload.response;
    if (!base64Response) {
      const err = new Error("Invalid payload: Missing 'response' field");
      err.statusCode = 400;
      throw err;
    }
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(base64Response, "base64").toString("utf8"),
      );
    } catch {
      const err = new Error("Invalid webhook payload: Base64 decode failed");
      err.statusCode = 400;
      throw err;
    }
    // Audit Phase 2 (H-4): the previous fallback `crypto.randomUUID()` defeated
    // the `PaymentWebhookEvent.eventId` unique-index deduplication whenever
    // PhonePe omitted `transactionId` (true for some early CREATED/PENDING
    // callbacks). Each redelivery produced a fresh UUID and the same logical
    // event was processed twice.
    //
    // Fix: when `transactionId` is absent, derive a stable hash from the
    // identity tuple `(merchantOrderId, state, payload)`. Identical
    // redeliveries collapse onto the same eventId and short-circuit at the
    // unique-index check (code 11000 → `duplicate: true`).
    //
    // Backward compatibility: the primary `payload.transactionId` branch is
    // unchanged, so every existing happy-path webhook (which carries a
    // transactionId) produces the exact same eventId as before. Only the
    // pathological no-transactionId branch is hardened.
    const stableEventId =
      payload.transactionId ||
      crypto
        .createHash("sha256")
        .update(
          `${payload.merchantOrderId || ""}|${payload.state || ""}|${JSON.stringify(payload)}`,
        )
        .digest("hex");

    return {
      eventId: stableEventId,
      merchantOrderId: payload.merchantOrderId,
      state: payload.state,
      transactionId: payload.transactionId,
      responseCode: payload.responseCode,
      raw: payload,
    };
  }

  mapStatusToInternal(gatewayState) {
    const normalized = String(gatewayState || "").toUpperCase();
    if (normalized === "COMPLETED") return PAYMENT_STATUS.CAPTURED;
    if (normalized === "FAILED") return PAYMENT_STATUS.FAILED;
    if (normalized === "PENDING" || normalized === "CREATED")
      return PAYMENT_STATUS.PENDING;
    return PAYMENT_STATUS.PENDING;
  }
}

export default PhonePeAdapter;

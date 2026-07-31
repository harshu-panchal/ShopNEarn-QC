import handleResponse from "../utils/helper.js";
import {
  createPaymentOrderForOrderRef,
  verifyGatewayPaymentStatus,
  verifyCheckoutPaymentCallback,
  processPaymentWebhook,
} from "../services/paymentService.js";
import {
  createPaymentOrderSchema,
  verifyCheckoutCallbackSchema,
  validateSchema,
} from "../validation/paymentValidation.js";
import logger from "../services/logger.js";

function resolvePaymentErrorMessage(error) {
  const directMessage = String(error?.message || "").trim();
  if (directMessage) return directMessage;

  const responseStatusText = String(error?.response?.statusText || "").trim();
  if (responseStatusText) return `Payment gateway error: ${responseStatusText}`;

  const causeCode = String(error?.cause?.code || error?.code || "").trim();
  if (causeCode) return `Payment gateway request failed (${causeCode})`;

  return "Unable to initiate payment right now";
}

export const createPaymentOrder = async (req, res) => {
  try {
    const payload = validateSchema(createPaymentOrderSchema, req.body || {});
    const result = await createPaymentOrderForOrderRef({
      orderRef: payload.orderRef || payload.orderId,
      userId: req.user?.id,
      idempotencyKey: req.headers["idempotency-key"] || null,
      correlationId: req.correlationId || null,
    });

    return handleResponse(
      res,
      result.duplicate ? 200 : 201,
      result.duplicate ? "Re-using existing payment" : "Payment initiated",
      {
        payment: result.payment,
        checkout: result.checkout,
        merchantOrderId: result.merchantOrderId || result.payment?.gatewayOrderId,
        razorpayOrderId: result.razorpayOrderId || null,
      },
    );
  } catch (error) {
    logger.error("createPaymentOrder failed", {
      scope: "PaymentController.createPaymentOrder",
      message: error?.message,
      statusCode: error?.statusCode || error?.status || 500,
      code: error?.code || error?.cause?.code || null,
      responseStatus: error?.response?.status || null,
      responseStatusText: error?.response?.statusText || null,
      orderRef: req.body?.orderRef || req.body?.orderId || null,
      userId: req.user?.id || null,
      correlationId: req.correlationId || null,
    });
    return handleResponse(
      res,
      error.statusCode || error.status || 500,
      resolvePaymentErrorMessage(error),
    );
  }
};

export const verifyPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantOrderId = id || req.query.merchantOrderId;

    if (!merchantOrderId) {
      return handleResponse(res, 400, "merchantOrderId is required");
    }

    const verification = await verifyGatewayPaymentStatus({
      merchantOrderId,
      userId: req.user?.id,
      correlationId: req.correlationId || null,
    });

    return handleResponse(res, 200, "Payment status verified", {
      status: verification.status,
      payment: verification.payment,
      orderKind: verification.orderKind || "regular",
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const verifyPaymentCallback = async (req, res) => {
  try {
    const payload = validateSchema(verifyCheckoutCallbackSchema, req.body || {});
    const verification = await verifyCheckoutPaymentCallback({
      merchantOrderId: payload.merchantOrderId,
      razorpayOrderId: payload.razorpay_order_id,
      razorpayPaymentId: payload.razorpay_payment_id,
      razorpaySignature: payload.razorpay_signature,
      userId: req.user?.id,
      correlationId: req.correlationId || null,
    });

    return handleResponse(res, 200, "Payment verified", {
      status: verification.status,
      payment: verification.payment,
      orderKind: verification.orderKind || "regular",
    });
  } catch (error) {
    logger.error("verifyPaymentCallback failed", {
      scope: "PaymentController.verifyPaymentCallback",
      message: error?.message,
      code: error?.code || null,
      userId: req.user?.id || null,
      correlationId: req.correlationId || null,
    });
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const handlePaymentWebhook = async (req, res) => {
  try {
    const signature =
      req.headers["x-razorpay-signature"] ||
      req.headers["x-verify"] ||
      req.headers["authorization"];
    const rawBody = req.body;

    if (!signature) {
      logger.warn("Payment webhook missing signature header", {
        scope: "PaymentController.handlePaymentWebhook",
        correlationId: req.correlationId || null,
        ip: req.ip,
      });
      return res.status(401).send("Unauthorized");
    }

    const result = await processPaymentWebhook({
      rawBody,
      signature,
      correlationId: req.correlationId || null,
    });

    if (result.accepted) {
      return res.status(200).send("OK");
    }

    return res.status(400).send("Bad Request");
  } catch (error) {
    if (error?.code === "WEBHOOK_DISABLED") {
      return res.status(503).send("Webhooks disabled");
    }
    logger.error("Payment webhook processing failed", {
      scope: "PaymentController.handlePaymentWebhook",
      correlationId: req.correlationId || null,
      message: error?.message,
      error,
    });
    return res.status(500).send("Internal Server Error");
  }
};

/** @deprecated Alias for handlePaymentWebhook */
export const handlePhonePeWebhook = handlePaymentWebhook;

export const getPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const merchantOrderId = id;

    const verification = await verifyGatewayPaymentStatus({
      merchantOrderId,
      userId: req.user?.id,
      correlationId: req.correlationId || null,
    });

    return handleResponse(res, 200, "Payment status retrieved", {
      status: verification.status,
      merchantOrderId: verification.payment.gatewayOrderId,
      amount: verification.payment.amount,
      currency: verification.payment.currency,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

/**
 * PaymentProviderPort
 *
 * Abstract contract that every payment provider adapter must implement.
 * Domain code in paymentService.js only ever sees a provider through this
 * interface — it never imports a vendor SDK directly.
 *
 * Implementations live under `../providers/<name>.adapter.js` and are wired
 * in `../providerRegistry.js`. The active provider is selected at runtime
 * via `process.env.PAYMENT_PROVIDER` (default: "razorpay").
 *
 * Methods must satisfy these contracts:
 *
 *  initiatePayment({ merchantOrderId, amountPaise, redirectUrl, customer, description })
 *    → {
 *        checkout: {
 *          keyId, orderId, amount, currency, name, description, prefill?, notes?
 *        },
 *        gatewayOrderId: string,   // provider's order id (e.g. order_…)
 *        gatewayResponse?: any,
 *      }
 *
 *  getPaymentStatus({ merchantOrderId, razorpayOrderId })
 *    → { state: string, transactionId?: string, responseCode?: string,
 *        gatewayResponse?: any }
 *
 *  verifyCheckoutSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature })
 *    → boolean
 *
 *  validateWebhook({ rawBody, signature })
 *    → boolean    (true ⇔ signature OK, false ⇔ reject the webhook)
 *
 *  decodeWebhookPayload({ rawBody })
 *    → { eventId, merchantOrderId, state, transactionId?, responseCode?, raw }
 *
 *  mapStatusToInternal(gatewayState)
 *    → one of the PAYMENT_STATUS constants (CAPTURED | FAILED | PENDING)
 *
 *  providerName
 *    → string (e.g. "RAZORPAY"). Used for logging and DB labelling.
 */

export class PaymentProviderPort {
  get providerName() {
    throw new Error("providerName must be implemented");
  }

  async initiatePayment(_args) {
    throw new Error("initiatePayment must be implemented");
  }

  async getPaymentStatus(_args) {
    throw new Error("getPaymentStatus must be implemented");
  }

  verifyCheckoutSignature(_args) {
    throw new Error("verifyCheckoutSignature must be implemented");
  }

  async validateWebhook(_args) {
    throw new Error("validateWebhook must be implemented");
  }

  async decodeWebhookPayload(_args) {
    throw new Error("decodeWebhookPayload must be implemented");
  }

  mapStatusToInternal(_gatewayState) {
    throw new Error("mapStatusToInternal must be implemented");
  }
}

export default PaymentProviderPort;

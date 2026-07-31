/**
 * Load Razorpay Checkout.js once and open the Standard Checkout modal.
 *
 * Prefer the `keyId` returned from create-order (`checkout.keyId`).
 * Optional `VITE_RAZORPAY_KEY_ID` is only a fallback.
 */

const CHECKOUT_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let scriptLoadPromise = null;

function loadCheckoutScript() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Razorpay checkout requires a browser"));
  }
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${CHECKOUT_SCRIPT_URL}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(window.Razorpay));
      existing.addEventListener("error", () =>
        reject(new Error("Failed to load Razorpay Checkout.js")),
      );
      if (window.Razorpay) resolve(window.Razorpay);
      return;
    }

    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (!window.Razorpay) {
        reject(new Error("Razorpay Checkout.js loaded without Razorpay global"));
        return;
      }
      resolve(window.Razorpay);
    };
    script.onerror = () =>
      reject(new Error("Failed to load Razorpay Checkout.js"));
    document.body.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * @param {object} args
 * @param {object} args.checkout - Server checkout session
 * @param {string} [args.merchantOrderId]
 * @param {(response: object) => void|Promise<void>} args.onSuccess
 * @param {(error: Error) => void} [args.onFailure]
 * @param {() => void} [args.onDismiss]
 */
export async function openRazorpayCheckout({
  checkout,
  merchantOrderId,
  onSuccess,
  onFailure,
  onDismiss,
}) {
  if (!checkout?.orderId) {
    throw new Error("Missing Razorpay checkout session");
  }

  const key =
    checkout.keyId ||
    (typeof import.meta !== "undefined"
      ? import.meta.env?.VITE_RAZORPAY_KEY_ID
      : "") ||
    "";

  if (!key) {
    throw new Error("Razorpay key is not configured");
  }

  const RazorpayCtor = await loadCheckoutScript();

  return new Promise((resolve, reject) => {
    let settled = false;

    const options = {
      key,
      amount: checkout.amount,
      currency: checkout.currency || "INR",
      name: checkout.name || "ShopAndEarn",
      description: checkout.description || "Order payment",
      order_id: checkout.orderId,
      notes: {
        ...(checkout.notes || {}),
        ...(merchantOrderId ? { merchantOrderId } : {}),
      },
      prefill: checkout.prefill || {},
      handler: async (response) => {
        try {
          await onSuccess({
            ...response,
            merchantOrderId:
              merchantOrderId || checkout.notes?.merchantOrderId || null,
          });
          settled = true;
          resolve(response);
        } catch (error) {
          settled = true;
          onFailure?.(error);
          reject(error);
        }
      },
      modal: {
        ondismiss: () => {
          if (settled) return;
          onDismiss?.();
          reject(Object.assign(new Error("Payment cancelled"), { code: "PAYMENT_DISMISSED" }));
        },
      },
    };

    try {
      const rzp = new RazorpayCtor(options);
      rzp.on("payment.failed", (response) => {
        const err = new Error(
          response?.error?.description || "Payment failed",
        );
        err.code = "PAYMENT_FAILED";
        err.raw = response;
        onFailure?.(err);
      });
      rzp.open();
    } catch (error) {
      onFailure?.(error);
      reject(error);
    }
  });
}

export default openRazorpayCheckout;

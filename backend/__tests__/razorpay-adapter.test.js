import { jest } from "@jest/globals";
import crypto from "crypto";

describe("RazorpayAdapter", () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "rzp_test_secret";
    process.env.RAZORPAY_WEBHOOK_SECRET = "whsec_test";
  });

  it("builds receipts within 40 chars", async () => {
    const { buildRazorpayReceipt } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );
    const short = buildRazorpayReceipt("ORD-SHORT");
    expect(short.length).toBeLessThanOrEqual(40);
    const long = buildRazorpayReceipt(
      "MLM-JOIN-" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(3),
    );
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it("verifies checkout signatures with timing-safe compare", async () => {
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );
    const adapter = new RazorpayAdapter();
    const orderId = "order_abc";
    const paymentId = "pay_xyz";
    const signature = crypto
      .createHmac("sha256", "rzp_test_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    expect(
      adapter.verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: signature,
      }),
    ).toBe(true);

    expect(
      adapter.verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: "deadbeef",
      }),
    ).toBe(false);
  });

  it("disables webhooks when RAZORPAY_WEBHOOK_SECRET is unset", async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );
    const adapter = new RazorpayAdapter();
    await expect(
      adapter.validateWebhook({
        rawBody: Buffer.from("{}"),
        signature: "anything",
      }),
    ).rejects.toMatchObject({ code: "WEBHOOK_DISABLED", statusCode: 503 });
  });

  it("validates webhook HMAC when secret is configured", async () => {
    const { RazorpayAdapter } = await import(
      "../app/services/payment/providers/razorpay.adapter.js"
    );
    const adapter = new RazorpayAdapter();
    const bodyObj = {
      id: "evt_123",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_1",
            status: "captured",
            order_id: "order_1",
            notes: { merchantOrderId: "ORD-1-A1" },
          },
        },
      },
    };
    const rawBody = Buffer.from(JSON.stringify(bodyObj));
    const signature = crypto
      .createHmac("sha256", "whsec_test")
      .update(rawBody)
      .digest("hex");

    expect(await adapter.validateWebhook({ rawBody, signature })).toBe(true);
    expect(
      await adapter.validateWebhook({ rawBody, signature: "bad" }),
    ).toBe(false);

    const decoded = await adapter.decodeWebhookPayload({ rawBody });
    expect(decoded.eventId).toBe("evt_123");
    expect(decoded.merchantOrderId).toBe("ORD-1-A1");
    expect(adapter.mapStatusToInternal(decoded.state)).toBe("CAPTURED");
  });
});

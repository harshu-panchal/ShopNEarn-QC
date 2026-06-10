import { jest } from "@jest/globals";

describe("otp utility mock mode", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it("returns the mock OTP in production when USE_MOCK_OTP is enabled", async () => {
    process.env.NODE_ENV = "production";
    process.env.USE_MOCK_OTP = "true";
    process.env.USE_REAL_SMS = "false";

    const { generateOTP } = await import("../app/utils/otp.js");

    expect(generateOTP()).toBe("1234");
  });
});

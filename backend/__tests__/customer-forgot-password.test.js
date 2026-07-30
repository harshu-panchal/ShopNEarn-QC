import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

const mockFind = jest.fn();
const mockFindById = jest.fn();
const mockCustomerSave = jest.fn();

jest.unstable_mockModule("../app/models/customer.js", () => ({
  default: {
    find: mockFind,
    findById: mockFindById,
  },
}));

const mockOtpFindOne = jest.fn();
const mockOtpDeleteOne = jest.fn();
const mockOtpSave = jest.fn().mockImplementation(function () {
  return Promise.resolve(this);
});

function MockOtpVerification(data) {
  Object.assign(this, data);
}
MockOtpVerification.findOne = mockOtpFindOne;
MockOtpVerification.deleteOne = mockOtpDeleteOne;
MockOtpVerification.prototype.save = mockOtpSave;

jest.unstable_mockModule("../app/models/otpVerification.js", () => ({
  default: MockOtpVerification,
}));

jest.unstable_mockModule("../app/config/redis.js", () => ({
  getRedisClient: () => null,
}));

const mockSendCustomerForgotPasswordOtpEmail = jest.fn(() =>
  Promise.resolve({ delivered: true, mode: "real" }),
);
jest.unstable_mockModule("../app/services/emailService.js", () => ({
  sendCustomerForgotPasswordOtpEmail: mockSendCustomerForgotPasswordOtpEmail,
  sendCustomerWelcomeEmail: jest.fn(),
  sendSellerVerificationOtpEmail: jest.fn(),
  sendSellerForgotPasswordOtpEmail: jest.fn(),
  useRealEmailOTP: () => true,
}));

// Stub otpAuthService / other heavy deps pulled by customerAuthController
jest.unstable_mockModule("../app/services/otpAuthService.js", () => ({
  issueCustomerOtp: jest.fn(),
  normalizeAndValidatePhone: jest.fn(),
  sanitizeCustomer: jest.fn((c) => c),
  verifyCustomerOtpCode: jest.fn(),
}));

jest.unstable_mockModule("../app/services/mlm/mlmConfigService.js", () => ({
  getMlmConfig: jest.fn(async () => ({ enabled: true })),
}));

jest.unstable_mockModule("../app/services/mlm/mlmMembershipService.js", () => ({
  getMembershipByReferralCode: jest.fn(),
}));

const customerAuthRouter = (await import("../app/routes/customerAuth.js")).default;

describe("Customer Forgot Password Flow", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/customer", customerAuthRouter);
  });

  test("POST /forgot-password/send-otp returns 200 for unknown email (anti-enumeration)", async () => {
    mockFind.mockReturnValue({
      select: () => ({
        lean: () => Promise.resolve([]),
      }),
    });

    const response = await request(app)
      .post("/customer/forgot-password/send-otp")
      .send({ email: "missing@customer.com" });

    expect(response.statusCode).toBe(200);
    expect(mockSendCustomerForgotPasswordOtpEmail).not.toHaveBeenCalled();
  });

  test("POST /forgot-password/send-otp returns 409 when email is shared", async () => {
    mockFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([
            { _id: "c1", email: "shared@x.com", isActive: true },
            { _id: "c2", email: "shared@x.com", isActive: true },
          ]),
      }),
    });

    const response = await request(app)
      .post("/customer/forgot-password/send-otp")
      .send({ email: "shared@x.com" });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toMatch(/multiple accounts/i);
    expect(mockSendCustomerForgotPasswordOtpEmail).not.toHaveBeenCalled();
  });

  test("POST /forgot-password/send-otp sends OTP for a unique email", async () => {
    mockFind.mockReturnValue({
      select: () => ({
        lean: () =>
          Promise.resolve([{ _id: "c1", email: "one@x.com", isActive: true }]),
      }),
    });
    mockOtpFindOne.mockReturnValue({
      select: () => null,
    });

    const response = await request(app)
      .post("/customer/forgot-password/send-otp")
      .send({ email: "one@x.com" });

    expect(response.statusCode).toBe(200);
    expect(mockSendCustomerForgotPasswordOtpEmail).toHaveBeenCalledTimes(1);
  });

  test("POST /forgot-password/reset rejects short passwords", async () => {
    const response = await request(app)
      .post("/customer/forgot-password/reset")
      .send({
        email: "one@x.com",
        resetToken: "token",
        newPassword: "123",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/at least 6/i);
  });
});

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Mock the Seller model
const mockFindOne = jest.fn();
const mockSave = jest.fn();
jest.unstable_mockModule("../app/models/seller.js", () => ({
  default: {
    findOne: mockFindOne,
  },
}));

// Mock the OtpVerification model
const mockOtpFindOne = jest.fn();
const mockOtpDeleteOne = jest.fn();
const mockOtpSave = jest.fn().mockImplementation(function() {
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

// Mock the redis client
jest.unstable_mockModule("../app/config/redis.js", () => ({
  getRedisClient: () => null, // fallback to in-memory window counter
}));

// Mock email service
const mockSendSellerForgotPasswordOtpEmail = jest.fn(() => Promise.resolve({ delivered: true, mode: "real" }));
jest.unstable_mockModule("../app/services/emailService.js", () => ({
  sendSellerVerificationOtpEmail: jest.fn(),
  sendSellerForgotPasswordOtpEmail: mockSendSellerForgotPasswordOtpEmail,
  useRealEmailOTP: () => true,
}));

// Import the router after mock bindings
const sellerAuthRouter = (await import("../app/routes/sellerAuth.js")).default;

function leanChain(val) {
  return {
    lean: () => Promise.resolve(val),
  };
}

describe("Seller Forgot Password Flow", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/seller", sellerAuthRouter);
  });

  test("POST /forgot-password/send-otp returns 404 if seller does not exist", async () => {
    mockFindOne.mockReturnValue({
      select: () => leanChain(null),
    });

    const response = await request(app)
      .post("/seller/forgot-password/send-otp")
      .send({ email: "missing@seller.com" });

    expect(response.statusCode).toBe(404);
    expect(response.body.message).toContain("Seller account not found");
  });

  test("POST /forgot-password/send-otp sends OTP if seller exists", async () => {
    mockFindOne.mockReturnValue({
      select: () => leanChain({ _id: "seller-123", email: "existing@seller.com" }),
    });
    mockOtpFindOne.mockReturnValue({
      select: () => null,
    });

    const response = await request(app)
      .post("/seller/forgot-password/send-otp")
      .send({ email: "existing@seller.com" });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toContain("Password reset OTP sent successfully");
    expect(mockSendSellerForgotPasswordOtpEmail).toHaveBeenCalledTimes(1);
  });

  test("POST /forgot-password/verify-otp returns 400 for incorrect OTP", async () => {
    mockOtpFindOne.mockReturnValue({
      select: () => ({
        otpHash: "invalid_hash",
        expiresAt: new Date(Date.now() + 60000),
        failedAttempts: 0,
        save: mockOtpSave,
      }),
    });

    const response = await request(app)
      .post("/seller/forgot-password/verify-otp")
      .send({ email: "existing@seller.com", otp: "9999" });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain("Invalid or expired OTP");
  });

  test("POST /forgot-password/reset returns 400 if password is too short", async () => {
    const response = await request(app)
      .post("/seller/forgot-password/reset")
      .send({
        email: "existing@seller.com",
        resetToken: "some-token",
        newPassword: "123",
      });

    expect(response.statusCode).toBe(400);
    expect(response.body.message).toContain("Password must be at least 6 characters");
  });

  test("POST /forgot-password/reset returns 401 with invalid token", async () => {
    const response = await request(app)
      .post("/seller/forgot-password/reset")
      .send({
        email: "existing@seller.com",
        resetToken: "invalid-token",
        newPassword: "newsecurepassword123",
      });

    expect(response.statusCode).toBe(401);
    expect(response.body.message).toContain("Invalid or expired reset token");
  });
});

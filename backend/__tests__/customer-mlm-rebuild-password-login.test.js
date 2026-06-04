/**
 * Customer-MLM-rebuild Phase 12 — `POST /customer/login-password`
 * acceptance test.
 *
 * Verifies:
 *   - Valid email + password -> 200 + JWT in payload.
 *   - Valid phone + password -> 200 + JWT in payload.
 *   - Wrong password -> 401 INVALID_CREDENTIALS.
 *   - Unverified customer (OTP not completed yet) -> 401.
 *   - Missing customer -> 401 (does not leak existence).
 */
import { jest } from "@jest/globals";

const mockCustomerFindOne = jest.fn();
const mockBcryptCompare = jest.fn();
const mockJwtSign = jest.fn();

jest.unstable_mockModule("../app/models/customer.js", () => ({
  default: { findOne: mockCustomerFindOne },
}));

jest.unstable_mockModule("bcrypt", () => ({
  default: { compare: mockBcryptCompare, hash: jest.fn() },
}));

jest.unstable_mockModule("jsonwebtoken", () => ({
  default: { sign: mockJwtSign },
}));

// Pull in the controller after the mocks are wired.
const { loginWithPassword } = await import(
  "../app/controller/customerAuthController.js"
);

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

// `select("+password")` chain helper for mock query.
function makeQueryResolving(value) {
  return { select: jest.fn().mockResolvedValue(value) };
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JWT_SECRET = "test-secret";
  mockJwtSign.mockReturnValue("FAKE_JWT_TOKEN");
});

describe("loginWithPassword", () => {
  test("returns 200 + JWT for valid email + password", async () => {
    const customer = {
      _id: "cust1",
      email: "a@b.com",
      phone: "+919999999999",
      password: "HASHED",
      isVerified: true,
      lastLogin: null,
      save: jest.fn().mockResolvedValue(true),
    };
    mockCustomerFindOne.mockReturnValueOnce(makeQueryResolving(customer));
    mockBcryptCompare.mockResolvedValueOnce(true);

    const req = { body: { identifier: "a@b.com", password: "Hunter2A" } };
    const res = makeRes();
    await loginWithPassword(req, res);

    expect(mockCustomerFindOne).toHaveBeenCalledWith({ email: "a@b.com" });
    expect(mockBcryptCompare).toHaveBeenCalledWith("Hunter2A", "HASHED");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      message: "Login successful",
      result: expect.objectContaining({ token: "FAKE_JWT_TOKEN" }),
    });
    expect(customer.save).toHaveBeenCalledTimes(1);
  });

  test("returns 200 + JWT for valid phone + password", async () => {
    const customer = {
      _id: "cust2",
      phone: "+919876543210",
      password: "HASHED",
      isVerified: true,
      lastLogin: null,
      save: jest.fn().mockResolvedValue(true),
    };
    mockCustomerFindOne.mockReturnValueOnce(makeQueryResolving(customer));
    mockBcryptCompare.mockResolvedValueOnce(true);

    const req = { body: { identifier: "9876543210", password: "Hunter2A" } };
    const res = makeRes();
    await loginWithPassword(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.result.token).toBe("FAKE_JWT_TOKEN");
  });

  test("returns 401 INVALID_CREDENTIALS when bcrypt fails", async () => {
    const customer = {
      _id: "cust3",
      email: "a@b.com",
      password: "HASHED",
      isVerified: true,
      save: jest.fn(),
    };
    mockCustomerFindOne.mockReturnValueOnce(makeQueryResolving(customer));
    mockBcryptCompare.mockResolvedValueOnce(false);

    const req = { body: { identifier: "a@b.com", password: "Wrong123" } };
    const res = makeRes();
    await loginWithPassword(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.result?.code).toBe("INVALID_CREDENTIALS");
    expect(customer.save).not.toHaveBeenCalled();
  });

  test("returns 401 when customer is not verified yet", async () => {
    const customer = {
      _id: "cust4",
      email: "a@b.com",
      password: "HASHED",
      isVerified: false,
      save: jest.fn(),
    };
    mockCustomerFindOne.mockReturnValueOnce(makeQueryResolving(customer));

    const req = { body: { identifier: "a@b.com", password: "Hunter2A" } };
    const res = makeRes();
    await loginWithPassword(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.result?.code).toBe("INVALID_CREDENTIALS");
    expect(mockBcryptCompare).not.toHaveBeenCalled();
  });

  test("returns 401 when customer doesn't exist (no existence leak)", async () => {
    mockCustomerFindOne.mockReturnValueOnce(makeQueryResolving(null));

    const req = { body: { identifier: "nobody@example.com", password: "Hunter2A" } };
    const res = makeRes();
    await loginWithPassword(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.result?.code).toBe("INVALID_CREDENTIALS");
  });
});

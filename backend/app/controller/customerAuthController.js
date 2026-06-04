import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import Customer from "../models/customer.js";
import Transaction from "../models/transaction.js";
import handleResponse from "../utils/helper.js";
import {
    issueCustomerOtp,
    normalizeAndValidatePhone,
    sanitizeCustomer,
    verifyCustomerOtpCode,
} from "../services/otpAuthService.js";
import {
    loginWithPasswordSchema,
    sendLoginOtpSchema,
    sendSignupOtpSchema,
    validateSchema,
    verifyOtpSchema,
} from "../validation/customerAuthValidation.js";
import { getMlmConfig } from "../services/mlm/mlmConfigService.js";
import { getMembershipByReferralCode } from "../services/mlm/mlmMembershipService.js";
import { MLM_MEMBERSHIP_STATUS } from "../constants/mlm.js";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

const generateToken = (customer) =>
    jwt.sign(
        { id: customer._id, role: "customer" },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );

// Customer-MLM-rebuild Phase 2: sponsor referral codes are minted at
// signup-time (free, immediately shareable). Therefore both ACTIVE and
// REGISTERED_UNPAID memberships are valid sponsors — only SUSPENDED /
// TERMINATED rows are rejected. Without this, a brand-new (still-
// unpaid) referrer couldn't bring in anyone, defeating the "no need
// to pay to get a referral code" requirement.
const VALID_SPONSOR_STATUSES = new Set([
    MLM_MEMBERSHIP_STATUS.ACTIVE,
    MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
]);

/* ===============================
   SIGNUP – Send OTP

   New required payload (Customer-MLM-rebuild Phase 2):
     { name, email, phone, password, referralCode, leg }

   - email + password are persisted on the not-yet-verified Customer
     row (password is bcrypt-hashed before storage). They become
     authoritative login credentials once the OTP is verified.
   - referralCode + leg are captured into
     `pendingSponsorReferralCode` + `pendingSponsorLeg`. The OTP-verify
     step consumes them to mint the new `MlmMembership` (status =
     `REGISTERED_UNPAID`) and place the user under the sponsor's
     chosen L/R leg of the binary tree.
================================ */
export const signupCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendSignupOtpSchema, req.body || {});

        const mlmCfg = await getMlmConfig();
        const requireRef = mlmCfg.signupRequiresReferralCode !== false;

        const rawCode = String(payload.referralCode || "").trim().toUpperCase();
        const leg = String(payload.leg || "").trim().toUpperCase();
        const emailLower = String(payload.email || "").trim().toLowerCase();

        if (requireRef && !rawCode) {
            return handleResponse(
                res,
                400,
                "A valid referral code is required to sign up.",
                { code: "REFERRAL_CODE_REQUIRED" },
            );
        }

        if (!["L", "R"].includes(leg)) {
            return handleResponse(
                res,
                400,
                "Please choose a leg position (Left or Right).",
                { code: "LEG_POSITION_REQUIRED" },
            );
        }

        const sponsor = await getMembershipByReferralCode(rawCode);
        if (!sponsor || !VALID_SPONSOR_STATUSES.has(sponsor.status)) {
            return handleResponse(
                res,
                400,
                "Invalid referral code. Please check with your sponsor.",
                { code: "REFERRAL_CODE_INVALID" },
            );
        }

        // Pre-check: a DIFFERENT verified customer already owns this
        // email. Reject upfront so the user can pick another email
        // instead of failing at OTP-verify time. (A row that is still
        // unverified with the same email will be re-used because
        // issueCustomerOtp's lookup is keyed on phone — so the same
        // person retrying signup with the same email is fine.)
        const normalizedPhone = (() => {
            try {
                return normalizeAndValidatePhone(payload.phone);
            } catch {
                return null;
            }
        })();
        if (!normalizedPhone) {
            return handleResponse(res, 400, "Invalid phone number format.", {
                code: "PHONE_INVALID",
            });
        }
        const conflicting = await Customer.findOne({
            email: emailLower,
            isVerified: true,
            phone: { $ne: normalizedPhone },
        }).select("_id");
        if (conflicting) {
            return handleResponse(
                res,
                409,
                "This email is already used by another account.",
                { code: "EMAIL_ALREADY_USED" },
            );
        }

        const passwordHash = await bcrypt.hash(
            String(payload.password),
            BCRYPT_ROUNDS,
        );

        // The plaintext is also forwarded so the post-OTP welcome
        // email can echo the credentials back to the customer. The
        // OTP service stores it on a `select:false` ephemeral field
        // and wipes it the instant the email is dispatched. See the
        // SECURITY NOTE on `Customer._signupPasswordPlaintext`.
        await issueCustomerOtp({
            name: payload.name,
            rawPhone: payload.phone,
            flow: "signup",
            ipAddress: req.ip,
            referralCode: rawCode,
            email: emailLower,
            passwordHash,
            plaintextPassword: String(payload.password),
            leg,
        });

        return handleResponse(
            res,
            200,
            "If the number is eligible, OTP has been sent",
        );
    } catch (error) {
        // Handle mongo duplicate-key (race between the email pre-check
        // and the customer.create call).
        if (error?.code === 11000 && error?.keyPattern?.email) {
            return handleResponse(
                res,
                409,
                "This email is already used by another account.",
                { code: "EMAIL_ALREADY_USED" },
            );
        }
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   LOGIN – Send OTP (phone-only, unchanged)
================================ */
export const loginCustomer = async (req, res) => {
    try {
        const payload = validateSchema(sendLoginOtpSchema, req.body || {});

        await issueCustomerOtp({
            rawPhone: payload.phone,
            flow: "login",
            ipAddress: req.ip,
        });

        return handleResponse(res, 200, "OTP has been sent");
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : {},
        );
    }
};

/* ===============================
   VERIFY OTP – Login / Signup

   For signup completion (customer was not previously verified) the
   verifyCustomerOtpCode service:
     1. Marks isVerified = true
     2. Inside a single mongoose session: createOrGetMembership(status:
        REGISTERED_UNPAID) + assignSponsor with the captured leg
     3. Fires the welcome email (best-effort, outside the transaction)
================================ */
export const verifyCustomerOTP = async (req, res) => {
    try {
        const payload = validateSchema(verifyOtpSchema, req.body || {});
        const customer = await verifyCustomerOtpCode({
            rawPhone: payload.phone,
            otp: payload.otp,
            ipAddress: req.ip,
        });
        const token = generateToken(customer);

        return handleResponse(res, 200, "Login successful", {
            token,
            customer: sanitizeCustomer(customer),
        });
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : {},
        );
    }
};

/* ===============================
   LOGIN – Email/Phone + Password (Customer-MLM-rebuild Phase 2)

   Body: { identifier, password }
     - `identifier` is either an email (contains "@") or a phone number
       (normalized to E.164 by the auth service).
     - Requires an existing VERIFIED customer with a bcrypt-hashed
       password (signup since the rebuild). Pre-rebuild customers who
       only have OTP can still log in via /send-login-otp + /verify-otp.
================================ */
export const loginWithPassword = async (req, res) => {
    try {
        const payload = validateSchema(loginWithPasswordSchema, req.body || {});
        const identifier = payload.identifier.trim();
        const looksLikeEmail = identifier.includes("@");

        let customer;
        if (looksLikeEmail) {
            customer = await Customer.findOne({
                email: identifier.toLowerCase(),
            }).select("+password");
        } else {
            let phone;
            try {
                phone = normalizeAndValidatePhone(identifier);
            } catch {
                return handleResponse(res, 401, "Invalid credentials", {
                    code: "INVALID_CREDENTIALS",
                });
            }
            customer = await Customer.findOne({ phone }).select("+password");
        }

        if (!customer || !customer.isVerified || !customer.password) {
            return handleResponse(res, 401, "Invalid credentials", {
                code: "INVALID_CREDENTIALS",
            });
        }

        const ok = await bcrypt.compare(payload.password, customer.password);
        if (!ok) {
            return handleResponse(res, 401, "Invalid credentials", {
                code: "INVALID_CREDENTIALS",
            });
        }

        customer.lastLogin = new Date();
        await customer.save();

        const token = generateToken(customer);
        return handleResponse(res, 200, "Login successful", {
            token,
            customer: sanitizeCustomer(customer),
        });
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   GET PROFILE
================================ */
export const getCustomerProfile = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }
        return handleResponse(res, 200, "Profile fetched successfully", customer);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   UPDATE PROFILE
================================ */
export const updateCustomerProfile = async (req, res) => {
    try {
        const { name, email, addresses } = req.body;

        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        if (name) customer.name = name;
        if (email) customer.email = email;
        if (addresses) customer.addresses = addresses;

        await customer.save();

        return handleResponse(res, 200, "Profile updated successfully", customer);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   GET WALLET TRANSACTIONS

   @deprecated Customer-MLM-rebuild Phase 5: legacy reader against the
   deprecated `Transaction` collection. New customers should consume
   `GET /api/customer/mlm/payouts/wallet-history` which reads from the
   canonical `LedgerEntry` collection. Kept here only for back-compat
   with the existing /wallet page that hasn't migrated yet.
================================ */
export const getCustomerTransactions = async (req, res) => {
    try {
        const customerId = req.user.id;
        const { page = 1, limit = 20 } = req.query;
        const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
        const perPage = Math.min(50, Math.max(1, parseInt(limit, 10)));

        const [transactions, total] = await Promise.all([
            Transaction.find({ user: customerId, userModel: "User" })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(perPage)
                .populate("order", "orderId")
                .lean(),
            Transaction.countDocuments({ user: customerId, userModel: "User" }),
        ]);

        const items = transactions.map((t) => ({
            _id: t._id,
            type: t.type === "Refund" ? "credit" : "debit",
            title: t.type === "Refund" ? "Refund" : t.type,
            amount: Math.abs(t.amount),
            date: t.createdAt,
            reference: t.reference,
            orderId: t.order?.orderId,
        }));

        return handleResponse(res, 200, "Transactions fetched", {
            items,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / perPage) || 1,
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

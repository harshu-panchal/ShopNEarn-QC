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

        // NOTE: Customer-MLM-rebuild Phase 7 (PO-request): the
        // email-uniqueness pre-check was removed — multiple customers
        // are allowed to share the same email (login disambiguates
        // by password). Phone IS still unique, and `issueCustomerOtp`
        // keys off phone, so retrying signup with the same phone +
        // email re-uses the same not-yet-verified row.
        try {
            normalizeAndValidatePhone(payload.phone);
        } catch {
            return handleResponse(res, 400, "Invalid phone number format.", {
                code: "PHONE_INVALID",
            });
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
        // Phase 7: the email duplicate-key handler is gone (email is
        // no longer unique). The only remaining unique index on
        // `users` is `phone`, and the OTP service short-circuits a
        // phone-retry by re-using the existing not-yet-verified row,
        // so a 11000 here would be a genuine race we cannot recover
        // from cleanly — surface it generically.
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
   LOGIN – Email/Phone + Password (Customer-MLM-rebuild Phase 2 + 7)

   Body: { identifier, password }
     - `identifier` is either an email (contains "@") or a phone number
       (normalized to E.164 by the auth service).
     - Requires an existing VERIFIED customer with a bcrypt-hashed
       password (signup since the rebuild). Pre-rebuild customers who
       only have OTP can still log in via /send-login-otp + /verify-otp.

   Phase 7 (PO-request): emails are no longer unique. If `identifier`
   is an email and matches multiple Customer rows, the controller
   bcrypt-compares the supplied password against each candidate (in
   newest-first order) and logs in the first row that authenticates.
   Phone-based login is unaffected because phone is still unique.

   Security caveat: a brute-force attacker who steals an email +
   guesses a weak password can now match ANY account that shares that
   email + happens to use that password. Combined with the relaxed
   password rules (Phase 7), this is a noticeably weaker auth surface
   than the original "unique email" model. Accept this trade-off
   knowingly — the product owner did.
================================ */
export const loginWithPassword = async (req, res) => {
    try {
        const payload = validateSchema(loginWithPasswordSchema, req.body || {});
        const identifier = payload.identifier.trim();
        const looksLikeEmail = identifier.includes("@");

        // We collect every plausible candidate up-front, then run
        // bcrypt against each. `.sort({createdAt:-1})` gives a stable,
        // newest-first match order so behaviour is predictable when
        // two accounts share BOTH email AND password (which can
        // happen now that emails are non-unique). The newest account
        // wins because it is the one the user most likely just
        // created.
        let candidates = [];
        if (looksLikeEmail) {
            candidates = await Customer.find({
                email: identifier.toLowerCase(),
            })
                .select("+password")
                .sort({ createdAt: -1 });
        } else {
            let phone;
            try {
                phone = normalizeAndValidatePhone(identifier);
            } catch {
                return handleResponse(res, 401, "Invalid credentials", {
                    code: "INVALID_CREDENTIALS",
                });
            }
            const byPhone = await Customer.findOne({ phone }).select(
                "+password",
            );
            if (byPhone) candidates = [byPhone];
        }

        // Walk candidates in order, returning the first one whose
        // bcrypt comparison succeeds. We deliberately do NOT short-
        // circuit on the first verified+has-password row — there can
        // be multiple verified rows sharing the same email, and only
        // ONE will have the supplied password.
        let matched = null;
        for (const candidate of candidates) {
            if (!candidate || !candidate.isVerified || !candidate.password) {
                continue;
            }
            // eslint-disable-next-line no-await-in-loop -- candidate
            // bcrypt comparisons must run sequentially; parallelising
            // would leak a small but measurable timing oracle that
            // could help an attacker enumerate shared-email accounts.
            const ok = await bcrypt.compare(payload.password, candidate.password);
            if (ok) {
                matched = candidate;
                break;
            }
        }

        if (!matched) {
            return handleResponse(res, 401, "Invalid credentials", {
                code: "INVALID_CREDENTIALS",
            });
        }

        matched.lastLogin = new Date();
        await matched.save();

        const token = generateToken(matched);
        return handleResponse(res, 200, "Login successful", {
            token,
            customer: sanitizeCustomer(matched),
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

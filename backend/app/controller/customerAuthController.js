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
    issueCustomerForgotPasswordOtp,
    verifyCustomerForgotPasswordOtp as verifyCustomerForgotPasswordOtpCode,
    resetCustomerForgotPassword as resetCustomerForgotPasswordService,
} from "../services/customerForgotPasswordService.js";
import {
    changePasswordSchema,
    loginWithPasswordSchema,
    sendLoginOtpSchema,
    sendSignupOtpSchema,
    validateSchema,
    verifyOtpSchema,
} from "../validation/customerAuthValidation.js";
import { getMlmConfig } from "../services/mlm/mlmConfigService.js";
import { getMembershipByReferralCode } from "../services/mlm/mlmMembershipService.js";
import { MLM_MEMBERSHIP_STATUS } from "../constants/mlm.js";
import { isLikelyUserId } from "../utils/userIdGenerator.js";

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
        // `users` is `phone`. `issueCustomerOtp` short-circuits
        // verified phones with `code = PHONE_ALREADY_REGISTERED`
        // (HTTP 409) and a clear message; un-verified retries are
        // absorbed silently (same row reused). Any 11000 surfacing
        // here would be a genuine race against an in-flight signup —
        // we surface it as a generic phone-taken error using the same
        // code so the frontend handler is uniform.
        if (error?.code === 11000 && error?.keyPattern?.phone) {
            return handleResponse(res, 409, "This phone number is already registered. Please log in instead.", {
                code: "PHONE_ALREADY_REGISTERED",
            });
        }
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : {},
        );
    }
};

/* ===============================
   GET /api/customer/auth/lookup-referral?code=<code>

   PUBLIC, rate-limited. Lets the signup form preview the sponsor's
   name as the user types their referral code so they can verify
   they're enrolling under the right person before submitting.

   Response shape (always 200):
     { valid: true,  sponsorName: "Jane Doe", referralCode: "ABCD1234" }
     { valid: false, sponsorName: null,       reason: "NOT_FOUND" | "INELIGIBLE_STATUS" }

   We deliberately do NOT 404 on missing/ineligible codes: returning
   200 with `valid: false` makes the client-side debouncer simpler
   (no error-vs-result branching) and keeps the response body
   self-describing.

   Privacy: returns only the sponsor's name, never their email,
   phone, or any earnings/downline data. The name is already
   considered shareable — it appears on the referral landing page
   and across genealogy tooltips for downline members.
================================ */
export const lookupReferralCode = async (req, res) => {
    try {
        const raw = String(req.query.code || "").trim().toUpperCase();
        if (!raw || raw.length < 4 || raw.length > 16 || !/^[A-Z0-9]+$/.test(raw)) {
            return handleResponse(res, 200, "Referral lookup", {
                valid: false,
                sponsorName: null,
                referralCode: raw || null,
                reason: "MALFORMED",
            });
        }

        const sponsor = await getMembershipByReferralCode(raw);
        if (!sponsor) {
            return handleResponse(res, 200, "Referral lookup", {
                valid: false,
                sponsorName: null,
                referralCode: raw,
                reason: "NOT_FOUND",
            });
        }
        if (!VALID_SPONSOR_STATUSES.has(sponsor.status)) {
            return handleResponse(res, 200, "Referral lookup", {
                valid: false,
                sponsorName: null,
                referralCode: raw,
                reason: "INELIGIBLE_STATUS",
            });
        }

        // Sponsor membership stores `userId` (FK to User). Pull just
        // the name field for the preview — avoids leaking phone or
        // email when an unauthenticated caller probes random codes.
        const userRow = await Customer.findById(sponsor.userId, { name: 1 }).lean();
        return handleResponse(res, 200, "Referral lookup", {
            valid: true,
            sponsorName: userRow?.name || null,
            referralCode: raw,
        });
    } catch (error) {
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
   LOGIN – User ID / Phone + Password (Customer-MLM-rebuild
   Phase 2 + 7, second iteration)

   Body: { identifier, password }
     - `identifier` is one of:
         • User ID — `SE` prefix + 8 alphanumeric chars (`isLikelyUserId`)
         • Phone   — normalised to E.164 by the auth service

   Email-based password login was REMOVED on PO-request — emails are
   captured at signup (and used for the welcome mail) but are NOT a
   valid login identifier any more. The only password-login routes
   are now User ID and Phone. Phone-OTP login (`/send-login-otp` +
   `/verify-otp`) is the second permitted path and is unchanged.

   Removing the email branch also closes the shared-email attack
   surface that the "non-unique email" change had opened: a brute
   forcer who knew a customer's email could previously cycle through
   every account on that email; now the attacker must know the
   per-account User ID or phone number to even reach the bcrypt
   step.

   Requires an existing VERIFIED customer with a bcrypt-hashed
   password (signup since the rebuild). Pre-rebuild customers who
   only have OTP can still log in via /send-login-otp + /verify-otp.

   User ID and phone lookups always return at most one candidate
   because both fields carry unique indexes — the candidate list is
   kept as a one-element array purely so the bcrypt-walk loop below
   stays generic.
================================ */
export const loginWithPassword = async (req, res) => {
    try {
        const payload = validateSchema(loginWithPasswordSchema, req.body || {});
        const identifier = payload.identifier.trim();

        // Email-shaped identifiers used to be accepted; they aren't
        // any more. Surface a clear error instead of letting the
        // request slip into a phone-normalisation failure that would
        // produce the same generic "Invalid credentials" toast.
        if (identifier.includes("@")) {
            return handleResponse(
                res,
                401,
                "Email sign-in is no longer supported. Please use your User ID or phone number, or use Forgot Password with your email.",
                { code: "EMAIL_LOGIN_DISABLED" },
            );
        }

        const looksLikeUserId = isLikelyUserId(identifier);

        let candidates = [];
        if (looksLikeUserId) {
            const byUserId = await Customer.findOne({
                userId: identifier.toUpperCase(),
            }).select("+password");
            if (byUserId) candidates = [byUserId];
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
        // bcrypt comparison succeeds. The list is effectively always
        // one row (User ID and phone both have unique indexes); the
        // loop survives as a generic shape in case a future
        // identifier type is added.
        let matched = null;
        for (const candidate of candidates) {
            if (!candidate || !candidate.isVerified || !candidate.password) {
                continue;
            }
            if (candidate.isActive === false) {
                return handleResponse(res, 403, "Your account has been blocked by an administrator.", {
                    code: "ACCOUNT_BLOCKED",
                });
            }
            // eslint-disable-next-line no-await-in-loop -- candidate
            // bcrypt comparisons run sequentially; the loop is short
            // (currently always at most one iteration).
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
   GET CREDENTIALS (Phase 7 second iteration, PO-request)

   Returns the customer's email, phone, and plaintext password so the
   in-app "Account Credentials" screen can echo them back. The
   plaintext is read from `Customer._signupPasswordPlaintext` — see
   the SECURITY NOTE on that field for trade-offs.

   For pre-existing customers (rows created before the plaintext
   field became permanent) the `password` value will be an empty
   string; the frontend should render that as "—" / "Not available"
   and prompt the user to set a new password if they want it
   recorded.
================================ */
export const getCustomerCredentials = async (req, res) => {
    try {
        const customer = await Customer.findById(req.user.id).select(
            "+_signupPasswordPlaintext userId email phone",
        );
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }
        return handleResponse(res, 200, "Credentials fetched", {
            // Phase 7 (PO-request): public-facing User ID, the third
            // login identifier alongside email + phone. Empty string
            // for the brief window between row creation and the
            // backfill migration completing on legacy data.
            userId: customer.userId || "",
            email: customer.email || "",
            phone: customer.phone || "",
            password: customer._signupPasswordPlaintext || "",
            // Flag the frontend can use to decide whether to render
            // the "—" placeholder + "Set a password" CTA. True when
            // a hash exists but no plaintext copy is stored (i.e.
            // pre-rebuild signup).
            hasStoredPassword: Boolean(customer._signupPasswordPlaintext),
        });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   CHANGE PASSWORD (Phase 7 second iteration, PO-request)

   Body: { currentPassword, newPassword }

   Authenticated. The customer must prove they know their current
   password (bcrypt-checked against the stored hash) before the new
   one is accepted. Writes BOTH the bcrypt hash AND the plaintext
   copy in `_signupPasswordPlaintext` in the same `save()` so the
   "Account Credentials" reveal screen always reflects the latest
   value.

   For pre-rebuild customers who have a bcrypt hash but no plaintext
   copy, this is the canonical path to populate the field.

   For customers who DON'T know their current password (e.g. signed
   up via phone OTP only and never set a password), the flow is to
   sign in via phone OTP — that path doesn't reach here.
================================ */
export const changeCustomerPassword = async (req, res) => {
    try {
        const payload = validateSchema(changePasswordSchema, req.body || {});

        const customer = await Customer.findById(req.user.id).select(
            "+password +_signupPasswordPlaintext",
        );
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }
        if (!customer.password) {
            // Account was created via phone-OTP only and never had a
            // password set. We could allow "set" here, but the
            // current UX only surfaces this endpoint via the
            // Credentials screen which assumes there IS a current
            // password to verify. Reject explicitly so a future
            // "set password" flow can be added cleanly.
            return handleResponse(
                res,
                400,
                "Your account has no password set. Sign in via OTP and contact support to set one.",
                { code: "NO_PASSWORD_SET" },
            );
        }

        const ok = await bcrypt.compare(
            payload.currentPassword,
            customer.password,
        );
        if (!ok) {
            return handleResponse(res, 401, "Current password is incorrect.", {
                code: "INVALID_CURRENT_PASSWORD",
            });
        }

        // No "same as old" check on purpose — the user could be
        // re-entering the same value to populate the plaintext copy
        // for a pre-rebuild row. That's a feature, not a bug.
        customer.password = await bcrypt.hash(
            payload.newPassword,
            BCRYPT_ROUNDS,
        );
        customer._signupPasswordPlaintext = payload.newPassword;
        await customer.save();

        return handleResponse(res, 200, "Password updated successfully");
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
        const { name, email, addresses, address, password } = req.body;

        const customer = await Customer.findById(req.user.id);
        if (!customer) {
            return handleResponse(res, 404, "Customer not found");
        }

        if (name !== undefined) customer.name = name;
        if (email !== undefined) customer.email = email;
        if (addresses !== undefined) customer.addresses = addresses;
        if (address !== undefined) customer.address = address;
        
        if (password && password.trim() !== "") {
            customer.password = await bcrypt.hash(password.trim(), BCRYPT_ROUNDS);
            customer._signupPasswordPlaintext = password.trim();
        }

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

/* ===============================
   FORGOT PASSWORD (email OTP)
================================ */
export const sendCustomerForgotPasswordOtp = async (req, res) => {
    try {
        const { email } = req.body || {};
        if (!email) {
            return handleResponse(res, 400, "Email is required");
        }
        const result = await issueCustomerForgotPasswordOtp({
            email,
            ipAddress: req.ip,
        });
        return handleResponse(
            res,
            200,
            "If an account with this email exists, a password reset OTP has been sent.",
            result,
        );
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : undefined,
        );
    }
};

export const verifyCustomerForgotPasswordOtp = async (req, res) => {
    try {
        const { email, otp } = req.body || {};
        if (!email || !otp) {
            return handleResponse(res, 400, "Email and OTP are required");
        }
        const result = await verifyCustomerForgotPasswordOtpCode({
            email,
            otp,
            ipAddress: req.ip,
        });
        return handleResponse(res, 200, "OTP verified successfully", result);
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : undefined,
        );
    }
};

export const resetCustomerForgotPassword = async (req, res) => {
    try {
        const { email, resetToken, newPassword } = req.body || {};
        if (!email || !resetToken || !newPassword) {
            return handleResponse(
                res,
                400,
                "All fields (email, resetToken, newPassword) are required",
            );
        }
        const result = await resetCustomerForgotPasswordService({
            email,
            resetToken,
            newPassword,
        });
        return handleResponse(res, 200, "Password reset successfully", result);
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message,
            error.code ? { code: error.code } : undefined,
        );
    }
};

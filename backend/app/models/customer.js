import mongoose from "mongoose";
import { normalizePhoneNumber } from "../utils/phone.js";

const addressSchema = new mongoose.Schema({
    label: {
        type: String,
        enum: ["home", "work", "other"],
        default: "home",
    },
    fullAddress: {
        type: String,
        required: true,
    },
    formattedAddress: String,
    placeId: String,
    landmark: String,
    city: String,
    state: String,
    pincode: String,
    location: {
        lat: Number,
        lng: Number,
    },
});

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            trim: true,
        },

        /**
         * Customer-MLM-rebuild Phase 7 (PO-request): public-facing
         * User ID. Independent of `_id` so the customer has a short,
         * human-readable handle to share with support or use as a
         * login identifier.
         *
         * Format: `SE` + 8 alphanumeric chars from a 32-char
         * unambiguous alphabet (no 0/O/1/I/L). See
         * `app/utils/userIdGenerator.js` for the generator + login
         * routing helpers.
         *
         * `unique: true, sparse: true` — every new signup is given a
         * userId immediately, but legacy customers created before
         * this field existed start with `userId === undefined`.
         * Sparse keeps the index from blocking those rows; the
         * `backfill-customer-userids.js` migration assigns them a
         * value retroactively. Once the backfill is verified, this
         * could be tightened to `required: true` in a follow-up.
         */
        userId: {
            type: String,
            uppercase: true,
            trim: true,
            unique: true,
            sparse: true,
            index: true,
        },

        email: {
            type: String,
            lowercase: true,
            /**
             * NOT `unique`. Customer-MLM-rebuild Phase 7 (PO-request):
             * multiple customers may register with the same email
             * address (e.g. a household sharing one mailbox). The
             * canonical identity is still `phone`, which IS unique.
             *
             * Email-based password login (see
             * `customerAuthController.loginWithPassword`) handles
             * shared emails by fetching every Customer with that
             * email and bcrypt-comparing against each row; the first
             * row whose password matches wins.
             *
             * `sparse: true` is preserved because not every customer
             * supplies an email (phone-only OTP signup is still
             * supported), and Mongo otherwise indexes every missing
             * value as `null` — which would block more than one
             * email-less customer.
             */
            sparse: true,
        },

        phone: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },

        password: {
            type: String,
            select: false, // response me password na aaye
        },

        /**
         * PERMANENT plaintext password copy — Customer-MLM-rebuild
         * Phase 7 (second iteration, PO-request).
         *
         * Stores the plaintext password the user entered at signup
         * (and at every subsequent password change) so the customer
         * app can show it back to them in the "Account Credentials"
         * screen, and so the welcome email can echo it on signup.
         *
         * Historically this was an ephemeral field (kept only between
         * OTP-send and welcome-email dispatch). It is now PERMANENT
         * — the wipe in `otpAuthService.completeCustomerSignupSideEffects`
         * was removed.
         *
         * Field name kept as `_signupPasswordPlaintext` for backward
         * compat with existing data and references; the leading
         * underscore signals "internal — never serialise to clients
         * blindly". `sanitizeCustomer` strips it from API responses;
         * the credentials endpoint reads it explicitly.
         *
         * SECURITY NOTE — this is a known anti-pattern. Plaintext at
         * rest means a single DB dump or backup leak exposes every
         * customer's actual login password. Combined with the
         * relaxed password rules + shared-email login (Phase 7), this
         * is a substantially weaker security posture than the
         * pre-rebuild model. The product owner is aware. Do not add
         * new read sites beyond:
         *   - `sendCustomerWelcomeEmail` (signup time)
         *   - `getCustomerCredentials` controller (in-app reveal)
         *
         * EXISTING ROWS: customers who signed up BEFORE this field
         * became permanent have `_signupPasswordPlaintext === undefined`.
         * Their stored bcrypt hash is one-way and cannot be reversed,
         * so the credentials screen will display "—" until they
         * change their password and the new plaintext gets persisted.
         */
        _signupPasswordPlaintext: {
            type: String,
            select: false,
        },

        role: {
            type: String,
            enum: ["user", "admin", "delivery", "seller"],
            default: "user",
        },

        isVerified: {
            type: Boolean,
            default: false,
        },

        otp: {
            type: String,
            select: false,
        },

        otpExpiry: {
            type: Date,
            select: false,
        },

        otpHash: {
            type: String,
            select: false,
        },

        otpExpiresAt: {
            type: Date,
            select: false,
        },

        otpFailedAttempts: {
            type: Number,
            default: 0,
            select: false,
        },

        otpLockedUntil: {
            type: Date,
            select: false,
        },

        otpLastSentAt: {
            type: Date,
            select: false,
        },

        otpSessionVersion: {
            type: Number,
            default: 0,
            select: false,
        },

        addresses: [addressSchema],

        /**
         * @deprecated Phase 4 (P4-7). Use the canonical
         * `Wallet({ownerType:"CUSTOMER", ownerId:<userId>}).availableBalance`
         * via `walletService.getCustomerBalance(userId)` instead.
         *
         * This field remains as a denormalised read-cache for
         * frontend backwards compatibility. Every Wallet credit / debit
         * for a customer now $inc's this field in the same Mongo session
         * (Phase 4 P4-3) so the two stay aligned. Will be removed in
         * Phase 7 after every read site has migrated.
         */
        walletBalance: {
            type: Number,
            default: 0,
        },

        // MLM Phase 1: denormalised projection from MlmMembership so the
        // common profile/checkout reads don't have to populate the full
        // membership doc. Authoritative source is `MlmMembership({userId})`.
        // `mlmMembershipService.syncCustomerMlmProjection(userId, {session})`
        // keeps these fields in sync after every membership mutation.
        mlm: {
            active: { type: Boolean, default: false },
            planType: {
                type: String,
                enum: ["A", "B", null],
                default: null,
            },
            referralCode: {
                type: String,
                trim: true,
                uppercase: true,
                index: true,
                sparse: true,
            },
            sponsorId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
                default: null,
                index: true,
                sparse: true,
            },
            directReferralsCount: { type: Number, default: 0 },
            lifetimePlanAEarnings: { type: Number, default: 0 },
            lifetimePlanBEarnings: { type: Number, default: 0 },
            joinedAt: { type: Date, default: null },
            homeShoppingUnlocked: { type: Boolean, default: false },
        },

        // MLM Phase 1: capture-only field. Set at signup if the customer
        // entered a referral code. The OTP-verify flow consumes this to
        // build the sponsor edge inside MlmMembership.assignSponsor; once
        // membership is activated the value is preserved for audit.
        pendingSponsorReferralCode: {
            type: String,
            trim: true,
            uppercase: true,
            default: null,
        },

        // Customer-MLM-rebuild Phase 1: capture-only field for the
        // sponsor leg ("L"/"R") the customer selected at signup. The
        // OTP-verify flow consumes this value when calling
        // `mlmMembershipService.assignSponsor({preferredBinaryPosition})`
        // so the new member is placed under the sponsor's chosen leg
        // (not the BFS weaker-leg auto-balance). Preserved for audit
        // after the placement is done.
        pendingSponsorLeg: {
            type: String,
            enum: ["L", "R", null],
            default: null,
        },

        isActive: {
            type: Boolean,
            default: true,
        },

        lastLogin: Date,
    },
    {
        timestamps: true,
    }
);

userSchema.index({ role: 1, isActive: 1 });

userSchema.pre("validate", function(next) {
    if (this.phone) {
        this.phone = normalizePhoneNumber(this.phone);
    }
    next();
});

// Phase 4 P4-8 — reverse virtual to the canonical Wallet document.
//
// Usage:
//   const user = await User.findById(id).populate("wallet");
//   user.wallet.availableBalance  // canonical
//
// This is opt-in via .populate() — existing queries that don't reference
// `wallet` see zero behavioural change.
userSchema.virtual("wallet", {
    ref: "Wallet",
    localField: "_id",
    foreignField: "ownerId",
    justOne: true,
    match: { ownerType: "CUSTOMER" },
});

// Make sure virtuals surface in `.toJSON()` / `.toObject()` so the
// frontend can read them once it migrates.
userSchema.set("toJSON", { virtuals: true });
userSchema.set("toObject", { virtuals: true });

export default mongoose.model("User", userSchema);

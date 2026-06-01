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

        email: {
            type: String,
            lowercase: true,
            unique: true,
            sparse: true, // phone login users ke liye
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

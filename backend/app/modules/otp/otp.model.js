import mongoose from "mongoose";
import { ALL_USER_MODEL_NAMES_WITH_LEGACY } from "../../constants/refModels.js";

const otpSessionSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    // Phase 5 P5-2: enum widened to accept the canonical "User" while
    // still tolerating legacy "Customer" rows from before the migration.
    userType: {
      type: String,
      enum: ALL_USER_MODEL_NAMES_WITH_LEGACY,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["LOGIN", "SIGNUP", "PASSWORD_RESET"],
      required: true,
    },
    otpHash: {
      type: String,
      required: true,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      select: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

otpSessionSchema.index(
  { mobile: 1, userType: 1, purpose: 1 },
  { unique: true, name: "mobile_userType_purpose_unique" },
);
otpSessionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: "otp_expires_at_ttl" },
);

export default mongoose.model("OtpSession", otpSessionSchema);

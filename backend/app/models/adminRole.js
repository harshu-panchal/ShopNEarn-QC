import mongoose from "mongoose";
import {
  ALL_ADMIN_PERMISSION_KEYS,
  SUPER_ADMIN_ROLE_KEY,
} from "../constants/adminPermissions.js";

const adminRoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 64,
      immutable: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator(values) {
          if (!Array.isArray(values)) return false;
          return values.every((value) => ALL_ADMIN_PERMISSION_KEYS.includes(value));
        },
        message: "One or more permission keys are invalid",
      },
    },
    isSystem: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  { timestamps: true },
);

adminRoleSchema.index({ key: 1 }, { unique: true });
adminRoleSchema.index({ name: 1 }, { unique: true });
adminRoleSchema.index({ isActive: 1, key: 1 });

adminRoleSchema.statics.SUPER_ADMIN_KEY = SUPER_ADMIN_ROLE_KEY;

export default mongoose.model("AdminRole", adminRoleSchema);

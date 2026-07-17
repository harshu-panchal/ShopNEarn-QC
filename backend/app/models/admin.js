import mongoose from "mongoose";
import bcrypt from "bcrypt";

const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    /**
     * Portal actor role for JWT `role` claim. Always `"admin"` for this
     * collection — fine-grained RBAC lives on `roleId` → AdminRole.
     */
    role: {
      type: String,
      default: "admin",
      immutable: true,
    },

    roleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminRole",
      default: null,
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    disabledAt: {
      type: Date,
      default: null,
    },

    disabledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
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

    /**
     * Bumped on role/password/status changes so existing JWTs fail
     * requireActiveAdmin until the admin re-authenticates.
     */
    tokenVersion: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastLogin: Date,
  },
  { timestamps: true },
);

adminSchema.index({ isActive: 1, roleId: 1 });

// Hash password before saving
adminSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password
adminSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export default mongoose.model("Admin", adminSchema);

import mongoose from "mongoose";

const adminAuditLogSchema = new mongoose.Schema(
  {
    actorAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      index: true,
    },
    actorEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      trim: true,
      default: "",
      index: true,
    },
    targetId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      index: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
    ip: {
      type: String,
      trim: true,
      default: "",
    },
    userAgent: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

adminAuditLogSchema.index({ createdAt: -1 });
adminAuditLogSchema.index({ actorAdminId: 1, createdAt: -1 });
adminAuditLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model("AdminAuditLog", adminAuditLogSchema);

import Setting from "../../models/setting.js";
import Seller from "../../models/seller.js";
import mongoose from "mongoose";
import { FRANCHISE_DEFAULTS } from "../../constants/franchise.js";

function isMergeableObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (value instanceof Date) return false;
  const bsonType = value?._bsontype;
  if (bsonType === "ObjectID" || bsonType === "ObjectId") return false;
  if (typeof value.toHexString === "function") return false;
  return true;
}

function mergeShallow(defaults, overrides) {
  if (!overrides || typeof overrides !== "object") return { ...defaults };
  const out = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === null) continue;
    if (isMergeableObject(value)) {
      out[key] = mergeShallow(defaults[key] || {}, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeMongoId(value) {
  if (!value) return null;
  if (typeof value.toHexString === "function") return value;
  const raw = value._id || value;
  const str = String(raw).trim();
  if (!mongoose.Types.ObjectId.isValid(str)) return null;
  return new mongoose.Types.ObjectId(str);
}

export async function getFranchiseConfig({ tenantId = null } = {}) {
  const filter = tenantId
    ? { tenantId }
    : { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };
  const doc = await Setting.findOne(filter).select("homeShoppy").lean();
  const overrides = doc?.homeShoppy || {};
  return mergeShallow(FRANCHISE_DEFAULTS, overrides);
}

export async function resolveHubSellerId(cfg) {
  const configured = normalizeMongoId(cfg?.hubSellerId);
  if (configured) return configured;
  const hub = await Seller.findOne({
    isPlatformHub: true,
    isActive: true,
    isVerified: true,
  })
    .select({ _id: 1 })
    .lean();
  if (hub?._id) return hub._id;

  const catalogSource = await Seller.findOne({
    isFranchiseCatalogSource: true,
    isActive: true,
    isVerified: true,
  })
    .select({ _id: 1 })
    .lean();
  return catalogSource?._id || null;
}

export async function getHubSellerId(opts) {
  const cfg = await getFranchiseConfig(opts);
  return resolveHubSellerId(cfg);
}

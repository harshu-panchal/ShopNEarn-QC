/**
 * seed-mlm-home-shopping-product.js
 *
 * MLM Phase 4 — creates the Home Shopping Product SKU and wires its id
 * into `Setting.mlm.homeShoppingProductId`. Only Plan B members can
 * claim and purchase this product. Every delivered purchase triggers
 * Home Shopping commissions (default 10/5/2% across L1/L2/L3 upline).
 *
 * Requirements before running:
 *   - At least one verified Seller must exist (used as the seller for
 *     the Home Shopping SKU). If `MLM_PLATFORM_SELLER_ID` env var is
 *     set, that seller is used; otherwise the script picks the oldest
 *     verified seller.
 *
 * Usage:
 *   node backend/scripts/seed-mlm-home-shopping-product.js              # dry-run
 *   node backend/scripts/seed-mlm-home-shopping-product.js --apply      # write
 *
 * Idempotent: re-running the script returns the existing product (no
 * duplicate insert) and re-asserts the Setting wiring.
 */
import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Setting from "../app/models/setting.js";
import Seller from "../app/models/seller.js";
import Product from "../app/models/product.js";
import Category from "../app/models/category.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const HOME_SHOPPING_PRODUCT_SLUG = "mlm-home-shopping";
const HOME_SHOPPING_PRODUCT_NAME = "MLM Home Shopping Premium";

// Shared MLM internal category hierarchy. Mirrored from
// seed-mlm-joining-package-product.js — kept inactive so the rows
// never appear in storefront category listings.
async function ensureMlmCategoryHierarchy(apply) {
  const ensure = async (filter, payload) => {
    const found = await Category.findOne(filter).lean();
    if (found) return found;
    if (!apply) return { _id: `(dry-run-${payload.slug})`, ...payload };
    return (await Category.create(payload)).toObject();
  };

  const header = await ensure(
    { slug: "mlm-internal", type: "header" },
    { name: "MLM Internal", slug: "mlm-internal", type: "header", status: "inactive", parentId: null },
  );

  const category = await ensure(
    { slug: "mlm-internal-category", type: "category" },
    {
      name: "MLM Internal Category",
      slug: "mlm-internal-category",
      type: "category",
      status: "inactive",
      parentId: header._id,
    },
  );

  const subcategory = await ensure(
    { slug: "mlm-internal-subcategory", type: "subcategory" },
    {
      name: "MLM Internal Subcategory",
      slug: "mlm-internal-subcategory",
      type: "subcategory",
      status: "inactive",
      parentId: category._id,
    },
  );

  return { header, category, subcategory };
}

async function main() {
  await connectDB();

  const summary = {
    apply: APPLY,
    sellerResolved: null,
    productExisting: null,
    productCreated: false,
    settingUpdated: false,
  };

  const platformSellerId = process.env.MLM_PLATFORM_SELLER_ID || null;
  const seller = platformSellerId
    ? await Seller.findById(platformSellerId).lean()
    : await Seller.findOne({ isVerified: true, isActive: true })
        .sort({ createdAt: 1 })
        .lean();

  if (!seller) {
    console.error(
      "[seed-mlm-home-shopping-product] No platform seller found. Set MLM_PLATFORM_SELLER_ID env or create a verified seller first.",
    );
    process.exit(1);
  }
  summary.sellerResolved = String(seller._id);

  const filter = { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };
  const setting = await Setting.findOne(filter);

  if (setting?.mlm?.homeShoppingProductId) {
    const existing = await Product.findById(setting.mlm.homeShoppingProductId).lean();
    if (existing) {
      summary.productExisting = String(existing._id);
      console.log(
        "[seed-mlm-home-shopping-product] Already wired to product:",
        existing.title,
      );
      console.table(summary);
      process.exit(0);
    }
  }

  let product =
    (await Product.findOne({ name: HOME_SHOPPING_PRODUCT_NAME }).lean()) ||
    (await Product.findOne({ slug: HOME_SHOPPING_PRODUCT_SLUG }).lean());

  if (!product) {
    const { header, category, subcategory } = await ensureMlmCategoryHierarchy(APPLY);

    const payload = {
      name: HOME_SHOPPING_PRODUCT_NAME,
      description:
        `Plan B exclusive premium product. Purchase value ₹${MLM_DEFAULTS.homeShoppingPrice.toLocaleString("en-IN")}. Includes home delivery and one-time exclusive purchase eligibility. Triggers Home Shopping commissions (${MLM_DEFAULTS.homeShoppingCommissions.salesPercent}% / ${MLM_DEFAULTS.homeShoppingCommissions.referralPercent}% / ${MLM_DEFAULTS.homeShoppingCommissions.royaltyPercent}%) up the sponsor chain.`,
      price: MLM_DEFAULTS.homeShoppingPrice,
      stock: 999999,
      sellerId: seller._id,
      headerId: header._id,
      categoryId: category._id,
      subcategoryId: subcategory._id,
      slug: HOME_SHOPPING_PRODUCT_SLUG,
      sku: `MLM-HS-${Date.now()}`,
      mainImage: "",
      galleryImages: [],
      status: "active",
      approvalStatus: "approved",
    };
    if (APPLY) {
      try {
        product = await Product.create(payload);
        summary.productCreated = true;
        console.log("[seed-mlm-home-shopping-product] Created product:", product._id);
      } catch (error) {
        console.warn(
          "[seed-mlm-home-shopping-product] Product create failed — your Product schema may require additional fields. Create the SKU manually and re-run with MLM_HOME_SHOPPING_PRODUCT_ID env.",
          error.message,
        );
        const overrideId = process.env.MLM_HOME_SHOPPING_PRODUCT_ID;
        if (!overrideId) {
          console.error("[seed-mlm-home-shopping-product] Cannot continue.");
          process.exit(1);
        }
        product = await Product.findById(overrideId).lean();
        if (!product) {
          console.error(
            "[seed-mlm-home-shopping-product] MLM_HOME_SHOPPING_PRODUCT_ID resolved to no product.",
          );
          process.exit(1);
        }
      }
    } else {
      console.log("[seed-mlm-home-shopping-product] (dry-run) Would create product:", payload.title);
    }
  } else {
    summary.productExisting = String(product._id);
    console.log("[seed-mlm-home-shopping-product] Found existing product:", product._id);
  }

  if (APPLY && product) {
    await Setting.findOneAndUpdate(
      filter,
      { $set: { "mlm.homeShoppingProductId": product._id } },
      { upsert: true },
    );
    summary.settingUpdated = true;
  } else if (!APPLY) {
    console.log("[seed-mlm-home-shopping-product] (dry-run) Would wire Setting.mlm.homeShoppingProductId");
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[seed-mlm-home-shopping-product] FAILED:", error);
  process.exit(1);
});

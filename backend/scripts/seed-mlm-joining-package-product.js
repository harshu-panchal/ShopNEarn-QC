/**
 * seed-mlm-joining-package-product.js
 *
 * MLM Phase 1 — creates the joining-package Product SKU and wires its
 * id into `Setting.mlm.joiningPackageProductId`. The product is
 * intentionally admin-editable (title, image, description, price all
 * editable via the regular Admin Products page) so the marketing team
 * can iterate without code changes.
 *
 * Requirements before running:
 *   - At least one admin Seller must exist (used as the seller for the
 *     joining-package SKU). If `MLM_PLATFORM_SELLER_ID` env var is set,
 *     that seller is used; otherwise the script picks the oldest
 *     verified seller.
 *
 * Usage:
 *   node backend/scripts/seed-mlm-joining-package-product.js              # dry-run
 *   node backend/scripts/seed-mlm-joining-package-product.js --apply      # write
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
const JOINING_PRODUCT_SLUG = "mlm-joining-package";
const JOINING_PRODUCT_NAME = "MLM Joining Package";

// MLM products are intentionally categorised under a hidden internal
// hierarchy so they don't bleed into the storefront category listings.
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
      "[seed-mlm-joining-package-product] No platform seller found. Set MLM_PLATFORM_SELLER_ID env or create a verified seller first.",
    );
    process.exit(1);
  }
  summary.sellerResolved = String(seller._id);

  const filter = { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] };
  const setting = await Setting.findOne(filter);

  // 1. Check if the product is already wired in Setting.mlm
  if (setting?.mlm?.joiningPackageProductId) {
    const existing = await Product.findById(setting.mlm.joiningPackageProductId).lean();
    if (existing) {
      summary.productExisting = String(existing._id);
      console.log(
        "[seed-mlm-joining-package-product] Already wired to product:",
        existing.title,
      );
      console.table(summary);
      process.exit(0);
    }
  }

  // 2. Check if the product exists by name/slug (created in a previous run)
  let product =
    (await Product.findOne({ name: JOINING_PRODUCT_NAME }).lean()) ||
    (await Product.findOne({ slug: JOINING_PRODUCT_SLUG }).lean());

  if (!product) {
    const { header, category, subcategory } = await ensureMlmCategoryHierarchy(APPLY);

    const payload = {
      name: JOINING_PRODUCT_NAME,
      description:
        "One-time enrolment fee for the customer rewards program. Includes a ₹5,000 shopping wallet seed redeemable on any product, plus access to direct-referral milestone bonuses (Plan A).",
      price: MLM_DEFAULTS.joiningPackagePrice,
      stock: 999999,
      sellerId: seller._id,
      headerId: header._id,
      categoryId: category._id,
      subcategoryId: subcategory._id,
      slug: JOINING_PRODUCT_SLUG,
      sku: `MLM-JOIN-${Date.now()}`,
      mainImage: "",
      galleryImages: [],
      status: "active",
      approvalStatus: "approved",
    };
    if (APPLY) {
      try {
        product = await Product.create(payload);
        summary.productCreated = true;
        console.log("[seed-mlm-joining-package-product] Created product:", product._id);
      } catch (error) {
        console.warn(
          "[seed-mlm-joining-package-product] Product create failed — your Product schema may require additional fields. Please create the SKU manually in Admin > Products and re-run with MLM_JOINING_PACKAGE_PRODUCT_ID env.",
          error.message,
        );
        const overrideId = process.env.MLM_JOINING_PACKAGE_PRODUCT_ID;
        if (!overrideId) {
          console.error("[seed-mlm-joining-package-product] Cannot continue.");
          process.exit(1);
        }
        product = await Product.findById(overrideId).lean();
        if (!product) {
          console.error(
            "[seed-mlm-joining-package-product] MLM_JOINING_PACKAGE_PRODUCT_ID resolved to no product.",
          );
          process.exit(1);
        }
      }
    } else {
      console.log("[seed-mlm-joining-package-product] (dry-run) Would create product:", payload.title);
    }
  } else {
    summary.productExisting = String(product._id);
    console.log("[seed-mlm-joining-package-product] Found existing product:", product._id);
  }

  // 3. Wire into Setting.mlm
  if (APPLY && product) {
    await Setting.findOneAndUpdate(
      filter,
      { $set: { "mlm.joiningPackageProductId": product._id } },
      { upsert: true },
    );
    summary.settingUpdated = true;
  } else if (!APPLY) {
    console.log("[seed-mlm-joining-package-product] (dry-run) Would wire Setting.mlm.joiningPackageProductId");
  }

  console.table(summary);
  process.exit(0);
}

main().catch((error) => {
  console.error("[seed-mlm-joining-package-product] FAILED:", error);
  process.exit(1);
});

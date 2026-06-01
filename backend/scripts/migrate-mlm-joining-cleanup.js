/**
 * migrate-mlm-joining-cleanup.js
 *
 * One-off migration to retire the legacy "joining-package as virtual
 * product" model:
 *
 *   1. For every legacy `Order { isJoiningPackageOrder: true }`, write
 *      an archive row into `MlmJoiningPayment` so historical reports
 *      and ledger lookups continue to work. The archive row preserves
 *      the original ledger key (`MLM-JPC-<order._id>`) by storing the
 *      Order's `_id` as the archive payment's `_id`, which means the
 *      already-emitted `LedgerEntry` rows remain valid and idempotent.
 *
 *   2. `$unset Setting.mlm.joiningPackageProductId` — the field is
 *      gone from the schema in this same release.
 *
 *   3. Mark the legacy joining-package Product as `status: "inactive"`
 *      so it disappears from the storefront. We do NOT delete the row
 *      because historical Orders still reference it.
 *
 *   4. Checksum: assert every legacy Order has a corresponding archive
 *      MlmJoiningPayment.
 *
 * Per `idempotent-data-migration` skill:
 *   - Default is dry-run; `--apply` writes.
 *   - Re-running with `--apply` is a no-op when the world is already
 *     migrated (every step short-circuits on existence).
 *
 * Usage:
 *   node backend/scripts/migrate-mlm-joining-cleanup.js              # dry-run
 *   node backend/scripts/migrate-mlm-joining-cleanup.js --apply      # write
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import Order from "../app/models/order.js";
import Setting from "../app/models/setting.js";
import Product from "../app/models/product.js";
import MlmJoiningPayment from "../app/models/mlmJoiningPayment.js";
import { MLM_DEFAULTS } from "../app/constants/mlm.js";
import { PAYMENT_STATUS, PAYMENT_EVENT_SOURCE } from "../app/constants/payment.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");

function tag(...args) {
  console.log("[migrate-mlm-joining-cleanup]", ...args);
}

async function archiveLegacyOrders() {
  const legacyOrders = await Order.find({ isJoiningPackageOrder: true })
    .select({
      _id: 1,
      customer: 1,
      pricing: 1,
      paymentBreakdown: 1,
      mlmActivationApplied: 1,
      paymentStatus: 1,
      createdAt: 1,
    })
    .lean();

  let archived = 0;
  let alreadyPresent = 0;

  for (const order of legacyOrders) {
    const existing = await MlmJoiningPayment.findById(order._id).lean();
    if (existing) {
      alreadyPresent += 1;
      continue;
    }

    const amountRupees =
      Number(order?.paymentBreakdown?.grandTotal) ||
      Number(order?.pricing?.total) ||
      MLM_DEFAULTS.joiningPackagePrice;
    const amountPaise = Math.max(1, Math.round(amountRupees * 100));

    const archiveStatus =
      order.paymentStatus === "PAID"
        ? PAYMENT_STATUS.CAPTURED
        : order.paymentStatus === "REFUNDED"
          ? PAYMENT_STATUS.REFUNDED
          : order.paymentStatus === "FAILED"
            ? PAYMENT_STATUS.FAILED
            : PAYMENT_STATUS.PENDING;

    if (!APPLY) {
      archived += 1;
      continue;
    }

    await MlmJoiningPayment.create({
      _id: order._id, // preserve ledger idempotency key
      customer: order.customer,
      gatewayName: "PHONEPE",
      gatewayOrderId: `LEGACY-MLM-JOIN-${order._id}`,
      amountPaise,
      currency: "INR",
      status: archiveStatus,
      joiningPriceSnapshot: amountRupees,
      shoppingCreditSnapshot: MLM_DEFAULTS.joiningPackageShoppingWalletCredit,
      sponsorReferralCodeSnapshot: null,
      activationApplied: !!order.mlmActivationApplied,
      activationCompletedAt: order.mlmActivationApplied
        ? order.createdAt || new Date()
        : null,
      idempotencyKey: undefined,
      rawGatewayResponse: { legacyOrderId: String(order._id) },
      capturedAt: archiveStatus === PAYMENT_STATUS.CAPTURED ? order.createdAt : null,
      statusHistory: [
        {
          fromStatus: PAYMENT_STATUS.CREATED,
          toStatus: archiveStatus,
          source: PAYMENT_EVENT_SOURCE.SYSTEM,
          reason: "Archived from legacy joining-package Order",
        },
      ],
    });
    archived += 1;
  }

  return { archived, alreadyPresent, total: legacyOrders.length };
}

async function unsetSettingField() {
  const filter = {
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  };
  const setting = await Setting.findOne(filter).select("mlm").lean();
  const hadField = !!setting?.mlm?.joiningPackageProductId;

  if (!hadField) return { unset: false, reason: "field_absent" };
  if (!APPLY) return { unset: true, reason: "dry_run" };

  await Setting.updateOne(filter, {
    $unset: { "mlm.joiningPackageProductId": "" },
  });
  return { unset: true, reason: "applied" };
}

async function deactivateLegacyProduct() {
  const setting = await Setting.findOne({
    $or: [{ tenantId: null }, { tenantId: { $exists: false } }],
  })
    .select("mlm")
    .lean();

  const productId = setting?.mlm?.joiningPackageProductId;
  if (!productId) {
    // Try slug match as a fallback if the setting was already cleared
    // in a prior run but the product is still active.
    const slugMatch = await Product.findOne({ slug: "mlm-joining-package" }).lean();
    if (!slugMatch) return { deactivated: false, reason: "no_product" };
    if (slugMatch.status === "inactive") {
      return { deactivated: false, reason: "already_inactive" };
    }
    if (!APPLY) return { deactivated: true, reason: "dry_run" };
    await Product.updateOne({ _id: slugMatch._id }, { $set: { status: "inactive" } });
    return { deactivated: true, reason: "applied_via_slug" };
  }

  const product = await Product.findById(productId).lean();
  if (!product) return { deactivated: false, reason: "product_missing" };
  if (product.status === "inactive") {
    return { deactivated: false, reason: "already_inactive" };
  }
  if (!APPLY) return { deactivated: true, reason: "dry_run" };

  await Product.updateOne({ _id: productId }, { $set: { status: "inactive" } });
  return { deactivated: true, reason: "applied" };
}

async function runChecksum(archiveSummary) {
  const legacyCount = await Order.countDocuments({ isJoiningPackageOrder: true });
  // After APPLY: every legacy order must have an archive row.
  if (!APPLY) {
    return {
      legacyOrderCount: legacyCount,
      expectedArchiveCount: legacyCount,
      actualArchiveDelta: archiveSummary.archived + archiveSummary.alreadyPresent,
      ok: true,
      note: "dry-run checksum (no writes happened)",
    };
  }

  // After APPLY, every legacy order should now have an archive row in
  // MlmJoiningPayment whose _id equals the order._id.
  const archivedIds = await MlmJoiningPayment.find({
    _id: { $in: await Order.find({ isJoiningPackageOrder: true }).distinct("_id") },
  }).distinct("_id");

  return {
    legacyOrderCount: legacyCount,
    archivedRowCount: archivedIds.length,
    ok: archivedIds.length === legacyCount,
  };
}

async function main() {
  await connectDB();

  tag("Mode:", APPLY ? "APPLY (writes enabled)" : "DRY-RUN");

  const archiveSummary = await archiveLegacyOrders();
  tag("Archived legacy joining-package Orders:", archiveSummary);

  const settingSummary = await unsetSettingField();
  tag("Setting.mlm.joiningPackageProductId:", settingSummary);

  const productSummary = await deactivateLegacyProduct();
  tag("Legacy joining-package Product:", productSummary);

  const checksum = await runChecksum(archiveSummary);
  tag("Checksum:", checksum);

  if (!checksum.ok) {
    console.error(
      "[migrate-mlm-joining-cleanup] Checksum FAILED. Investigate before deploying schema drop.",
    );
    process.exit(1);
  }

  await mongoose.disconnect();
  tag("Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[migrate-mlm-joining-cleanup] FAILED:", error);
  process.exit(1);
});

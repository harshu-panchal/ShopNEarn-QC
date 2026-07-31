/**
 * Idempotent migration: rename MLM/franchise payment mode `phonepe` → `razorpay`.
 *
 * Safe to re-run. Does not touch MANUAL_QR rows or historical Payment gatewayName.
 *
 * Usage:
 *   node scripts/migrate-payment-mode-phonepe-to-razorpay.js
 *   DRY_RUN=1 node scripts/migrate-payment-mode-phonepe-to-razorpay.js
 */

import "dotenv/config";
import mongoose from "mongoose";

const DRY_RUN = String(process.env.DRY_RUN || "").trim() === "1";

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("MONGO_URI is required");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const settingFilter = {
    $or: [
      { "mlm.joiningPaymentMode": "phonepe" },
      { "franchise.registrationPaymentMode": "phonepe" },
    ],
  };

  const settingsMatched = await db.collection("settings").countDocuments(settingFilter);
  console.log(`Settings docs with phonepe mode: ${settingsMatched}`);

  if (!DRY_RUN && settingsMatched > 0) {
    const result = await db.collection("settings").updateMany(settingFilter, [
      {
        $set: {
          "mlm.joiningPaymentMode": {
            $cond: [
              { $eq: ["$mlm.joiningPaymentMode", "phonepe"] },
              "razorpay",
              "$mlm.joiningPaymentMode",
            ],
          },
          "franchise.registrationPaymentMode": {
            $cond: [
              { $eq: ["$franchise.registrationPaymentMode", "phonepe"] },
              "razorpay",
              "$franchise.registrationPaymentMode",
            ],
          },
        },
      },
    ]);
    console.log(`Settings updated: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }

  const joiningFilter = { paymentMode: "phonepe" };
  const joiningMatched = await db
    .collection("mlmjoiningpayments")
    .countDocuments(joiningFilter);
  console.log(`MlmJoiningPayment rows with phonepe mode: ${joiningMatched}`);
  if (!DRY_RUN && joiningMatched > 0) {
    const result = await db
      .collection("mlmjoiningpayments")
      .updateMany(joiningFilter, { $set: { paymentMode: "razorpay" } });
    console.log(
      `MlmJoiningPayment updated: matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
  }

  const franchiseFilter = { paymentMode: "phonepe" };
  const franchiseMatched = await db
    .collection("franchiseregistrationpayments")
    .countDocuments(franchiseFilter);
  console.log(`FranchiseRegistrationPayment rows with phonepe mode: ${franchiseMatched}`);
  if (!DRY_RUN && franchiseMatched > 0) {
    const result = await db
      .collection("franchiseregistrationpayments")
      .updateMany(franchiseFilter, { $set: { paymentMode: "razorpay" } });
    console.log(
      `FranchiseRegistrationPayment updated: matched=${result.matchedCount} modified=${result.modifiedCount}`,
    );
  }

  console.log(DRY_RUN ? "DRY_RUN complete — no writes" : "Migration complete");
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

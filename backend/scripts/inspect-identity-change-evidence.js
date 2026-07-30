/**
 * Read-only forensics: what changed on the two account records, when, and by whom.
 */
import "dotenv/config";
import mongoose from "mongoose";
import "../app/models/customer.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";

const IDS = [
  "6a5226a0243134fa63cdf509", // yesterday: Vipul Bhanukant Chavda SE96307437
  "6a5ccc33a029e7d84e90be41", // yesterday: Shilpaben Raghjibhai Prajapati SE62435417
];

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const raw = mongoose.connection.db.collection("customers");

  for (const id of IDS) {
    const oid = new mongoose.Types.ObjectId(id);
    const doc = await raw.findOne({ _id: oid });
    console.log(`\n=== customer ${id} ===`);
    console.log({
      name: doc?.name,
      userId: doc?.userId,
      email: doc?.email,
      phone: doc?.phone,
      createdAt: doc?.createdAt,
      updatedAt: doc?.updatedAt,
      updatedBy: doc?.updatedBy ? String(doc.updatedBy) : null,
      deletedAt: doc?.deletedAt || null,
    });
    const m = await MlmMembership.findOne({ userId: oid }).lean();
    console.log("membership", {
      _id: String(m?._id),
      referralCode: m?.referralCode,
      updatedAt: m?.updatedAt,
      updatedBy: m?.updatedBy ? String(m.updatedBy) : null,
      binaryPosition: m?.binaryPosition,
      binaryParentId: m?.binaryParentId ? String(m.binaryParentId) : null,
    });
  }

  console.log("\n=== Does SE96307437 exist anywhere (incl. soft-deleted)? ===");
  console.log(
    "customers:",
    await raw.find({ userId: "SE96307437" }).toArray(),
  );
  console.log(
    "memberships:",
    await mongoose.connection.db
      .collection("mlmmemberships")
      .find({ referralCode: "SE96307437" })
      .toArray(),
  );
  console.log(
    "any Vipul Bhanukant / Chavda named customer:",
    await raw
      .find({ name: { $regex: /bhanukant/i } })
      .project({ name: 1, userId: 1, deletedAt: 1 })
      .toArray(),
  );

  console.log("\n=== adminauditlogs coverage ===");
  const audits = mongoose.connection.db.collection("adminauditlogs");
  console.log("total docs:", await audits.countDocuments());
  const latest = await audits.find({}).sort({ createdAt: -1 }).limit(5).toArray();
  console.log(
    "latest:",
    latest.map((l) => ({
      at: l.createdAt,
      action: l.action,
      target: String(l.targetId || ""),
      actor: l.actorEmail,
    })),
  );
  const distinctActions = await audits.distinct("action");
  console.log("distinct actions:", distinctActions);

  console.log("\n=== Customers edited in the last 24h (name/userId churn window) ===");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await raw
    .find({ updatedAt: { $gte: since } })
    .project({ name: 1, userId: 1, updatedAt: 1, updatedBy: 1 })
    .sort({ updatedAt: -1 })
    .limit(40)
    .toArray();
  for (const r of recent) {
    console.log(
      r.updatedAt?.toISOString(),
      r.userId,
      r.name,
      r.updatedBy ? `updatedBy=${String(r.updatedBy)}` : "",
    );
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

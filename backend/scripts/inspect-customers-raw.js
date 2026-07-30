/**
 * Dump the raw document from the correct customers collection to check field names.
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const db = mongoose.connection.db;
const colNames = (await db.listCollections().toArray()).map((c) => c.name);
console.log("All collections:", colNames.filter((n) => /customer|member|user/i.test(n)));

// Try every customer-like collection
for (const col of colNames.filter((n) => /customer/i.test(n))) {
  const c = db.collection(col);
  const count = await c.countDocuments();
  const sample = await c.findOne({});
  console.log(`\n${col} (${count} docs) keys:`, sample ? Object.keys(sample) : "empty");
}

// Direct ObjectId lookup
const oid1 = new mongoose.Types.ObjectId("6a5226a0243134fa63cdf509");
const oid2 = new mongoose.Types.ObjectId("6a5ccc33a029e7d84e90be41");
for (const col of colNames.filter((n) => /customer/i.test(n))) {
  const c = db.collection(col);
  const d1 = await c.findOne({ _id: oid1 });
  const d2 = await c.findOne({ _id: oid2 });
  if (d1) console.log(`\n${col} oid1:`, { name: d1.name, userId: d1.userId, email: d1.email, updatedAt: d1.updatedAt });
  if (d2) console.log(`\n${col} oid2:`, { name: d2.name, userId: d2.userId, email: d2.email, updatedAt: d2.updatedAt });
}

// Check updatedAt range and look for SE96307437 across ALL collections
for (const col of colNames) {
  const c = db.collection(col);
  const hit = await c.findOne({ userId: "SE96307437" });
  if (hit) console.log(`SE96307437 found in ${col}:`, hit._id, hit.name);
}

await mongoose.disconnect();

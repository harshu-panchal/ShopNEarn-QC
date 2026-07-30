import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const db = mongoose.connection.db;
const users = db.collection("users");
const mems = db.collection("mlmmemberships");

// Bhavesh binary pointers
const bhavesh = await mems.findOne({ referralCode: "SE10762512" });
console.log("Bhavesh binary L/R:", {
  L: String(bhavesh?.binaryLeftChildId || ""),
  R: String(bhavesh?.binaryRightChildId || ""),
});

const leftOid = bhavesh?.binaryLeftChildId;
if (leftOid) {
  const lu = await users.findOne({ _id: new mongoose.Types.ObjectId(String(leftOid)) });
  console.log("Bhavesh L child user:", { name: lu?.name, userId: lu?.userId });
  const lm = await mems.findOne({ userId: new mongoose.Types.ObjectId(String(leftOid)) });
  console.log("Bhavesh L child membership:", { referralCode: lm?.referralCode, binaryPosition: lm?.binaryPosition, R: String(lm?.binaryRightChildId || "") });
  if (lm?.binaryRightChildId) {
    const ru = await users.findOne({ _id: new mongoose.Types.ObjectId(String(lm.binaryRightChildId)) });
    console.log("That slot's R child user:", { name: ru?.name, userId: ru?.userId, updatedAt: ru?.updatedAt });
  }
}

// All users updated since Jul 28
const since = new Date("2026-07-28T00:00:00Z");
const recent = await users
  .find({ updatedAt: { $gte: since } })
  .project({ name: 1, userId: 1, updatedAt: 1 })
  .sort({ updatedAt: -1 })
  .limit(30)
  .toArray();
console.log("\nUsers updated since Jul 28:");
for (const r of recent) {
  console.log(r.updatedAt?.toISOString(), r.userId, r.name);
}

// Search for Vipul Bhanukant anywhere
const vb = await users.find({ name: { $regex: /bhanukant|vipul.*chavda/i } }).toArray();
console.log("bhanukant/vipul chavda hits:", vb.map(x => ({ _id: String(x._id), name: x.name, userId: x.userId })));

await mongoose.disconnect();

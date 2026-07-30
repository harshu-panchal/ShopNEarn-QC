/**
 * Full forensics on ObjectId 6a5226a0243134fa63cdf509
 * — what is it now, what membership it owns, and any hint of Vipul.
 */
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const db = mongoose.connection.db;
const users = db.collection("users");
const mems = db.collection("mlmmemberships");

const oid = new mongoose.Types.ObjectId("6a5226a0243134fa63cdf509");
const u = await users.findOne({ _id: oid });
console.log("Current user record:", JSON.stringify(u, null, 2));

const m = await mems.findOne({ userId: oid });
console.log("Current membership:", JSON.stringify({
  _id: m?._id,
  referralCode: m?.referralCode,
  binaryParentId: m?.binaryParentId,
  binaryPosition: m?.binaryPosition,
  binaryLeftChildId: m?.binaryLeftChildId,
  binaryRightChildId: m?.binaryRightChildId,
  sponsorId: m?.sponsorId,
  updatedAt: m?.updatedAt,
}, null, 2));

// Check membership for any 'Vipul' or 'SE96307437' mention in notes/logs
const anyMem96 = await mems.findOne({ referralCode: "SE96307437" });
console.log("membership with referralCode SE96307437:", anyMem96 ? "FOUND" : "NOT FOUND");

// What does mlmBinaryMoveService.js log event say?
// It logged membershipId 6a5226a0243134fa63cdf50d = Shilpaben, newParent 6a5226a0243134fa63cdf50d = Vipul
// Wait — let's check those IDs again carefully
const membershipMoved = await mems.findOne({ _id: new mongoose.Types.ObjectId("6a5ccc48a029e7d84e90be56") });
console.log("Moved membership (was Shilpaben at move time):", JSON.stringify({
  referralCode: membershipMoved?.referralCode,
  binaryParentId: String(membershipMoved?.binaryParentId || ""),
  binaryPosition: membershipMoved?.binaryPosition,
  userId: String(membershipMoved?.userId || ""),
}, null, 2));
if (membershipMoved?.userId) {
  const u2 = await users.findOne({ _id: new mongoose.Types.ObjectId(String(membershipMoved.userId)) });
  console.log("user of moved membership:", { name: u2?.name, userId: u2?.userId, updatedAt: u2?.updatedAt });
}

const targetParentMembership = await mems.findOne({ _id: new mongoose.Types.ObjectId("6a5226a0243134fa63cdf50d") });
console.log("Target parent membership (was Vipul at move time):", JSON.stringify({
  referralCode: targetParentMembership?.referralCode,
  binaryParentId: String(targetParentMembership?.binaryParentId || ""),
  binaryPosition: targetParentMembership?.binaryPosition,
  userId: String(targetParentMembership?.userId || ""),
  binaryRightChildId: String(targetParentMembership?.binaryRightChildId || ""),
}, null, 2));
if (targetParentMembership?.userId) {
  const u3 = await users.findOne({ _id: new mongoose.Types.ObjectId(String(targetParentMembership.userId)) });
  console.log("user of that membership:", { name: u3?.name, userId: u3?.userId, updatedAt: u3?.updatedAt });
}

await mongoose.disconnect();

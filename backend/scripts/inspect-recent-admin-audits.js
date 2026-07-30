import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
const logs = await mongoose.connection.db
  .collection("adminauditlogs")
  .find({ createdAt: { $gte: new Date("2026-07-28T00:00:00Z") } })
  .sort({ createdAt: -1 })
  .limit(80)
  .toArray();

for (const l of logs) {
  console.log(
    l.createdAt?.toISOString(),
    l.action,
    l.targetType,
    String(l.targetId || ""),
    JSON.stringify(l.metadata || {}).slice(0, 300),
  );
}
console.log("total", logs.length);
await mongoose.disconnect();

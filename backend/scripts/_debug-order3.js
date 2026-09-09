import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import mongoose from "mongoose";
import Order from "../app/models/order.js";

dotenv.config();

async function main() {
  await connectDB();
  console.log("DB name:", mongoose.connection.db.databaseName);
  console.log("Host:", mongoose.connection.host);
  const total = await Order.countDocuments({});
  console.log("Total orders:", total);
  const latest = await Order.find({}).sort({ createdAt: -1 }).limit(3).select("orderId status createdAt updatedAt").lean();
  console.log(JSON.stringify(latest, null, 2));
  const latestByUpdated = await Order.find({}).sort({ updatedAt: -1 }).limit(3).select("orderId status createdAt updatedAt").lean();
  console.log("by updatedAt:", JSON.stringify(latestByUpdated, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

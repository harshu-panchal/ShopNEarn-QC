import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Order from "../app/models/order.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import Seller from "../app/models/seller.js";

dotenv.config();

async function main() {
  await connectDB();

  const order = await Order.findOne({ orderId: /47CND6X4/i }).lean();
  if (!order) {
    console.log("Order not found by orderId containing 47CND6X4. Trying _id suffix match...");
    const all = await Order.find({}).sort({ createdAt: -1 }).limit(5).select("orderId status sellerId createdAt").lean();
    console.log(JSON.stringify(all, null, 2));
    process.exit(1);
  }

  console.log("=== ORDER ===");
  console.log(JSON.stringify({
    orderId: order.orderId,
    status: order.status,
    sellerId: order.sellerId,
    isFranchisePosSale: order.isFranchisePosSale,
    franchisePartnerId: order.franchisePartnerId,
    deliveryAddress: order.deliveryAddress,
    financeFlags: order.financeFlags,
    createdAt: order.createdAt,
  }, null, 2));

  if (order.sellerId) {
    const seller = await Seller.findById(order.sellerId).select("name isPlatformHub isFranchiseCatalogSource location").lean();
    console.log("\n=== ASSIGNED SELLER ===");
    console.log(JSON.stringify(seller, null, 2));
  }

  const custLat = order.deliveryAddress?.latitude ?? order.deliveryAddress?.lat;
  const custLng = order.deliveryAddress?.longitude ?? order.deliveryAddress?.lng;
  console.log("\ncustomer delivery coords:", custLat, custLng);

  process.exit(0);
}
main().catch((err) => { console.error(err); process.exit(1); });

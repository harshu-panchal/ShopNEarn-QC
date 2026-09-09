import dotenv from "dotenv";
import connectDB from "../app/dbConfig/dbConfig.js";
import Order from "../app/models/order.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import Seller from "../app/models/seller.js";

dotenv.config();

async function main() {
  await connectDB();
  const order = await Order.findOne({ orderId: /47CND6X4$/i }).lean();
  if (!order) { console.log("still not found"); process.exit(1); }
  console.log(JSON.stringify({
    orderId: order.orderId,
    status: order.status,
    sellerId: order.sellerId,
    isFranchisePosSale: order.isFranchisePosSale,
    franchisePartnerId: order.franchisePartnerId,
    routedFranchisePartnerId: order.routedFranchisePartnerId,
    deliveryAddress: order.deliveryAddress,
    createdAt: order.createdAt,
  }, null, 2));

  if (order.sellerId) {
    const seller = await Seller.findById(order.sellerId).select("name isPlatformHub isFranchiseCatalogSource location").lean();
    console.log("\nASSIGNED SELLER:", JSON.stringify(seller, null, 2));
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

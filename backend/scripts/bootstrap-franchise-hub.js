import dotenv from "dotenv";
import mongoose from "mongoose";
import Seller from "../app/models/seller.js";
import Setting from "../app/models/setting.js";

dotenv.config();

const HUB_SELLER_ID = process.argv[2] || "6a2279a34931c0271e9eaaad";

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  await Seller.updateMany(
    { isPlatformHub: true },
    { $set: { isPlatformHub: false, isFranchiseCatalogSource: false } },
  );

  const seller = await Seller.findByIdAndUpdate(
    HUB_SELLER_ID,
    { $set: { isPlatformHub: true, isFranchiseCatalogSource: true } },
    { new: true },
  ).select("shopName isPlatformHub isFranchiseCatalogSource");

  if (!seller) {
    throw new Error(`Seller ${HUB_SELLER_ID} not found`);
  }

  const setting = await Setting.findOneAndUpdate(
    {},
    {
      $set: {
        homeShoppy: {
          enabled: true,
          hubSellerId: seller._id,
          hubShopDisplayName: seller.shopName || "Shop N Earn",
          registrationPrice: 10000,
          walletCreditMultiplier: 2,
        },
      },
    },
    { new: true, upsert: true },
  ).select("homeShoppy");

  console.log("Hub seller:", {
    id: String(seller._id),
    shopName: seller.shopName,
    isPlatformHub: seller.isPlatformHub,
    isFranchiseCatalogSource: seller.isFranchiseCatalogSource,
  });
  console.log("homeShoppy:", setting?.homeShoppy);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import mongoose from "mongoose";
import dotenv from "dotenv";
import Product from "../app/models/product.js";
import { sumVariantStock } from "../app/utils/productStockUtils.js";

dotenv.config();

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  await mongoose.connect(process.env.MONGO_URI);

  const products = await Product.find({
    variants: { $exists: true, $ne: [] },
  }).select("_id name stock variants");

  let updated = 0;
  for (const product of products) {
    const nextStock = sumVariantStock(product.variants);
    const currentStock = Math.max(0, Number(product.stock || 0));
    if (currentStock === nextStock) continue;

    console.log(
      `${dryRun ? "[dry-run] " : ""}${product.name} (${product._id}): ${currentStock} -> ${nextStock}`,
    );

    if (!dryRun) {
      product.stock = nextStock;
      await product.save();
    }
    updated += 1;
  }

  console.log(`Done. ${updated} product(s) ${dryRun ? "would be" : ""} updated.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

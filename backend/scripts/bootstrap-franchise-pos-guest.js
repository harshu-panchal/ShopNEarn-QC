import dotenv from "dotenv";
import mongoose from "mongoose";
import Customer from "../app/models/customer.js";
import { FRANCHISE_POS_WALKIN_PHONE } from "../app/constants/franchise.js";

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const existing = await Customer.findOne({ phone: FRANCHISE_POS_WALKIN_PHONE }).select("_id name phone");
  if (existing) {
    console.log("Franchise POS walk-in user already exists:", {
      id: String(existing._id),
      name: existing.name,
      phone: existing.phone,
    });
    await mongoose.disconnect();
    return;
  }

  const user = await Customer.create({
    name: "Franchise POS Walk-in",
    phone: FRANCHISE_POS_WALKIN_PHONE,
    role: "user",
    isVerified: true,
  });

  console.log("Created franchise POS walk-in user:", {
    id: String(user._id),
    phone: user.phone,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

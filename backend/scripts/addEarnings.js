import mongoose from "mongoose";
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

import User from "../app/models/customer.js";
import { creditWallet } from "../app/services/finance/walletService.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to DB");
    const user = await User.findOne({ userId: "SE90994515" });
    if (!user) {
        console.log("User not found");
        process.exit(1);
    }
    
    console.log("Found user:", user._id);
    
    const result = await creditWallet({
      ownerType: "CUSTOMER",
      ownerId: user._id,
      amount: 2000,
      bucket: "earnings",
      ledgerType: "ADJUSTMENT",
      ledgerDescription: "Manual addition by admin",
      syncUserWalletBalance: false
    });
    
    console.log("Wallet credited! New balance:", result.after);
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
}
run();

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import Wallet from "../app/models/wallet.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const members = await MlmMembership.find({
      planType: "A",
      status: "active",
    }).lean();

    let sum = 0;
    for (const member of members) {
      const wallet = await Wallet.findOne({ ownerId: member.userId }).lean();
      if (wallet) {
        sum += wallet.shoppingBalance;
      }
    }
    
    console.log(`Average shopping balance for ${members.length} active Plan A members: ${sum / members.length}`);

    // Let's also check if they have 10,000 extra
    const w = await Wallet.findOne({ ownerId: members[0].userId }).lean();
    console.log(`Sample wallet shoppingBalance: ${w.shoppingBalance}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

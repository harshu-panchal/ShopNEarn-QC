import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    
    const members = await MlmMembership.find({ planType: "A", status: "active" }).lean();
    
    for (const m of members) {
      const w = await Wallet.findOne({ ownerId: m.userId }).lean();
      const count = await LedgerEntry.countDocuments({ actorId: m.userId, description: "Plan A Activation Bonus" });
      console.log(`User: ${m.userId}, Shopping: ${w?.shoppingBalance}, Ledgers: ${count}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

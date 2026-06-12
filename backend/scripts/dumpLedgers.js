import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import LedgerEntry from "../app/models/ledgerEntry.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const entries = await LedgerEntry.find({
      description: "Plan A Activation Bonus"
    }).lean();

    console.log(`Found ${entries.length} entries.`);
    if (entries.length > 0) {
      console.log(entries[0]);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

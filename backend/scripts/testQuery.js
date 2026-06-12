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
    
    const doc = await LedgerEntry.findOne({
      actorId: "6a226e054931c0271e9e9e67",
      $or: [
        { type: "MLM_JOINING_PACKAGE_SHOPPING_CREDIT" },
        { description: "Plan A Activation Bonus" }
      ]
    }).lean();

    console.log(doc);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

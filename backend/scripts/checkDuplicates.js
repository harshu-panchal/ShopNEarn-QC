import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import LedgerEntry from "../app/models/ledgerEntry.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
    console.log("Connected to MongoDB.");

    const entries = await LedgerEntry.find({
      description: "Plan A Activation Bonus"
    }).lean();

    console.log(`Found ${entries.length} LedgerEntries with description "Plan A Activation Bonus".`);

    // Group by ownerId to see if anyone got duplicates
    const counts = {};
    entries.forEach(e => {
      const id = String(e.actorId);
      counts[id] = (counts[id] || 0) + 1;
    });

    let multiples = 0;
    for (const [id, count] of Object.entries(counts)) {
      if (count > 1) {
        multiples++;
      }
    }
    console.log(`Users with multiple credits: ${multiples}`);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

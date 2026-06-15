import mongoose from "mongoose";
import dotenv from "dotenv";
import { resolve } from "path";

// Load backend .env
dotenv.config({ path: resolve(process.cwd(), ".env") });

import MlmMembership from "../app/models/mlmMembership.js";
import { MLM_MEMBERSHIP_STATUS } from "../app/constants/mlm.js";

async function run() {
  if (!process.env.MONGO_URI) {
    console.error("MONGO_URI is not set in .env");
    process.exit(1);
  }

  console.log("Connecting to MongoDB...");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected.\n");

  const cursor = MlmMembership.find().cursor();
  let processed = 0;
  let updated = 0;

  console.log("Loading members to build dependency graph...");
  // We need to do a bottom-up calculation. We can just query all members,
  // and for each member, we calculate the count based on their downline.
  // Actually, computing from scratch for every user by finding all where `sponsorChain: user.userId` is simpler:

  const allMembers = await MlmMembership.find({}, { userId: 1, status: 1 }).lean();
  console.log(`Loaded ${allMembers.length} members. Processing...`);

  // Map to hold statuses for fast lookup
  const statusMap = new Map();
  for (const m of allMembers) {
    statusMap.set(String(m.userId), m.status);
  }

  // To do this efficiently, we can iterate all members, find their downline, and sum.
  // Or even simpler, aggregate!
  
  // Actually, we can just do a single aggregate to get the counts:
  const pipeline = [
    { $unwind: "$sponsorChain" },
    {
      $group: {
        _id: "$sponsorChain",
        activeCount: {
          $sum: { $cond: [{ $eq: ["$status", MLM_MEMBERSHIP_STATUS.ACTIVE] }, 1, 0] }
        },
        inactiveCount: {
          $sum: { $cond: [{ $eq: ["$status", MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID] }, 1, 0] }
        }
      }
    }
  ];

  const results = await MlmMembership.aggregate(pipeline);
  console.log(`Aggregation complete. Found downlines for ${results.length} members. Updating DB...`);

  const bulkOps = [];

  // First, set all to 0 to handle members who have NO downline
  bulkOps.push({
    updateMany: {
      filter: {},
      update: { $set: { activeDownlineCount: 0, inactiveDownlineCount: 0 } }
    }
  });

  for (const res of results) {
    bulkOps.push({
      updateOne: {
        filter: { userId: res._id },
        update: { 
          $set: { 
            activeDownlineCount: res.activeCount, 
            inactiveDownlineCount: res.inactiveCount 
          } 
        }
      }
    });

    // Execute in batches to avoid memory overload
    if (bulkOps.length > 500) {
      await MlmMembership.bulkWrite(bulkOps);
      updated += bulkOps.length - 1; // excluding updateMany if it was in this batch
      bulkOps.length = 0;
      process.stdout.write(`Updated ${updated} records...\r`);
    }
  }

  if (bulkOps.length > 0) {
    await MlmMembership.bulkWrite(bulkOps);
    updated += bulkOps.length;
  }

  console.log(`\n\nSuccessfully recalculated downline counts for all members.`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

import mongoose from "mongoose";
import * as dotenv from "dotenv";
dotenv.config();

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/shopandearn");
import MlmMembership from "./app/models/mlmMembership.js";

async function run() {
  const rootMember = await MlmMembership.findOne({ referralCode: "SEP5AWN3S6" });
  if (!rootMember) {
    console.log("Root not found");
    process.exit(1);
  }
  
  const rootUserId = rootMember.userId;
  
  console.time("graphLookup");
  const agg = await MlmMembership.aggregate([
    { $match: { userId: rootUserId } },
    {
      $graphLookup: {
        from: "mlmmemberships",
        startWith: "$userId",
        connectFromField: "userId",
        connectToField: "binaryParentId",
        as: "descendants",
        maxDepth: 50
      }
    }
  ]);
  console.timeEnd("graphLookup");
  
  const descendants = agg[0]?.descendants || [];
  console.log("Total binary descendants via graphLookup:", descendants.length);
  
  console.time("sponsorChain");
  const unilevel = await MlmMembership.find({ sponsorChain: rootUserId }).lean();
  console.timeEnd("sponsorChain");
  
  console.log("Total descendants via sponsorChain:", unilevel.length);
  process.exit(0);
}
run();

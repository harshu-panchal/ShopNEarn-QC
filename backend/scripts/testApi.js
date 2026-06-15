import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";
import { buildBinaryTreeBottomUp } from "../app/services/mlm/mlmBinaryTreeBuilder.js";
import { shapeCustomerTree } from "../app/controller/mlmCustomerController.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const rootMembership = await MlmMembership.findOne({ referralCode: "SEUJMP3M85" }).populate("userId").lean();
    
    const { tree: rawTree, drift } = await buildBinaryTreeBottomUp({
      rootMembership,
      depthLeft: 3,
    });
    
    const tree = shapeCustomerTree(rawTree);
    console.log(JSON.stringify(tree, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

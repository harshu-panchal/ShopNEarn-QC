import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js"; // Register User
import { buildBinaryTreeBottomUp } from "../app/services/mlm/mlmBinaryTreeBuilder.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    // Find ABDULWA... (SEUJMP3M85)
    const rootMembership = await MlmMembership.findOne({ referralCode: "SEUJMP3M85" }).lean();
    if (!rootMembership) {
      console.log("Root not found");
      return;
    }

    const { tree, drift, totalDescendants, renderedCount, orphanedCount } = await buildBinaryTreeBottomUp({
      rootMembership,
      depthLeft: 10, // Pass a high depth to see if they appear
    });

    console.log(`totalDescendants: ${totalDescendants}`);
    console.log(`renderedCount: ${renderedCount}`);
    console.log(`orphanedCount: ${orphanedCount}`);
    console.log(`drift:`, drift);

    // Let's dump the left leg tree
    function printTree(node, indent = "") {
      if (!node) return;
      console.log(`${indent}${node.position || "ROOT"}: ${node.raw.referralCode} (${node.raw.userId?.name || node.raw.userId})`);
      if (node.left) printTree(node.left, indent + "  ");
      if (node.right) printTree(node.right, indent + "  ");
    }

    printTree(tree);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

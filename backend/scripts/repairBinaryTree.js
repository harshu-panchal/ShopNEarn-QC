import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

import MlmMembership from "../app/models/mlmMembership.js";

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Connected to database.");

    // 1. Find all memberships that have a binaryParentId
    const members = await MlmMembership.find({ binaryParentId: { $ne: null } }).sort({ joinedAt: 1 }).lean();
    
    // We need quick lookup of all members
    const memberMap = new Map();
    const allMembers = await MlmMembership.find().lean();
    for (const m of allMembers) {
      memberMap.set(String(m.userId), m);
    }

    const orphans = [];

    // 2. Identify orphaned subtrees
    for (const m of members) {
      const parentId = String(m.binaryParentId);
      const parent = memberMap.get(parentId);
      
      if (!parent) {
        console.warn(`Node ${m.referralCode} has non-existent parent ${parentId}. Skipping...`);
        continue;
      }

      const isLeft = String(parent.binaryLeftChildId) === String(m.userId);
      const isRight = String(parent.binaryRightChildId) === String(m.userId);

      if (!isLeft && !isRight) {
        console.log(`[ORPHAN] ${m.referralCode} is orphaned. Expected under ${parent.referralCode} at position ${m.binaryPosition}`);
        orphans.push({
          memberId: m._id,
          userId: m.userId,
          parentId: parent.userId,
          position: m.binaryPosition || "L",
        });
      }
    }

    if (orphans.length === 0) {
      console.log("No orphaned nodes found. Tree is structurally sound!");
      process.exit(0);
    }

    console.log(`Found ${orphans.length} orphaned nodes. Repairing...`);

    // 3. Repair orphaned nodes
    for (const orphan of orphans) {
      // Re-fetch parent to get latest pointers as we might have modified them
      const parent = await MlmMembership.findOne({ userId: orphan.parentId });
      if (!parent) continue;

      const position = orphan.position;
      
      // Spill down to find an empty slot
      let cursor = parent;
      let newParent = parent;
      
      const MAX_DEPTH = 1000;
      for (let i = 0; i < MAX_DEPTH; i++) {
        const childId = position === "L" ? cursor.binaryLeftChildId : cursor.binaryRightChildId;
        if (!childId) {
          newParent = cursor;
          break;
        }
        cursor = await MlmMembership.findOne({ userId: childId });
        if (!cursor) {
          newParent = cursor; // The pointer is dangling, overwrite it
          break;
        }
      }

      if (!newParent) {
        console.error(`Failed to find empty slot for ${orphan.userId}. Tree too deep or dangling pointer.`);
        continue;
      }

      // Attach the orphan to newParent
      console.log(`Attaching orphaned node ${orphan.userId} under ${newParent.userId} at ${position}`);
      
      await MlmMembership.updateOne(
        { _id: orphan.memberId },
        { 
          $set: { 
            binaryParentId: newParent.userId, 
            binaryParentMembershipId: newParent._id 
          } 
        }
      );

      if (position === "L") {
        await MlmMembership.updateOne(
          { _id: newParent._id },
          { $set: { binaryLeftChildId: orphan.userId } }
        );
      } else {
        await MlmMembership.updateOne(
          { _id: newParent._id },
          { $set: { binaryRightChildId: orphan.userId } }
        );
      }
    }

    console.log("Tree repair complete! You should now see the missing nodes in the Tree View.");
  } catch (err) {
    console.error("Error repairing tree:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

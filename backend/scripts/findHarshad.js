import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const db = mongoose.connection.db;
    
    // Find Harshad by referralCode
    const doc = await db.collection("mlmmemberships").findOne({
      $or: [
        { referralCode: "SE63927699" },
        { legacyReferralCode: "SE63927699" }
      ]
    });
    console.log("MlmMembership:", doc);

    // Find User
    const user = await db.collection("users").findOne({
      $or: [
        { userId: "SE63927699" },
        { name: /HARSHAD/i }
      ]
    });
    console.log("User:", user);

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

import mongoose from "mongoose";
import MlmMembership from "../app/models/mlmMembership.js";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  try {
    await mongoose.connect(
      process.env.MONGO_URI || "mongodb://127.0.0.1:27017/Quick_commerce",
    );

    console.log("Connected to MongoDB!");

    const result = await MlmMembership.updateMany(
      { legacyReferralCode: null },
      { $unset: { legacyReferralCode: "" } },
    );

    console.log(
      `Cleanup complete! Modified ${result.modifiedCount} documents!`,
    );

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();

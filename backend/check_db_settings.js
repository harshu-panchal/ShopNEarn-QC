import mongoose from "mongoose";
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve("./.env") });

import Setting from "./app/models/setting.js";

async function run() {
  try {
    const mongoUri = process.env.MONGODB_URL || process.env.MONGO_URI;
    await mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log("Connected to MongoDB.");

    const settings = await Setting.findOne();
    if (!settings) {
      console.log("No settings document found!");
    } else {
      console.log("Current mlm settings in DB:", JSON.stringify(settings.mlm, null, 2));
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

run();

import mongoose from "mongoose";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const session = await mongoose.startSession();
  let successCount = 0;
  let errorCount = 0;

  try {
    await session.withTransaction(async () => {
      // Simulate Duplicate Key Error
      const error = new Error("E11000 duplicate key error");
      error.code = 11000;
      throw error;
    });
    successCount++;
  } catch (err) {
    errorCount++;
    console.error("Caught error:", err.message);
  } finally {
    await session.endSession();
  }

  console.log(`Success: ${successCount}, Error: ${errorCount}`);
  process.exit(0);
}

run();

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Adjust path if needed so dotenv can find your .env file
dotenv.config();

const uri = process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB for cleanup.");

    const db = mongoose.connection.db;
    
    // 1. Delete soft-deleted Customers (Users)
    const usersResult = await db.collection('users').deleteMany({ deletedAt: { $ne: null } });
    console.log(`Deleted ${usersResult.deletedCount} soft-deleted users.`);

    // 2. Delete soft-deleted MlmMemberships
    const mlmResult = await db.collection('mlmmemberships').deleteMany({ deletedAt: { $ne: null } });
    console.log(`Deleted ${mlmResult.deletedCount} soft-deleted MLM memberships.`);

    // 3. Drop the old unique index on phone which had the partialFilterExpression
    console.log("Dropping old 'phone_1' index...");
    try {
        await db.collection('users').dropIndex("phone_1");
        console.log("Successfully dropped old 'phone_1' index.");
    } catch (e) {
        if (e.code === 27) {
            console.log("Index 'phone_1' not found. It might have been already dropped or named differently.");
        } else {
            console.error("Error dropping index:", e.message);
        }
    }

    // 4. Create the new strict unique index on phone
    console.log("Creating new strict unique index on phone...");
    await db.collection('users').createIndex({ phone: 1 }, { unique: true });
    console.log("Successfully created new 'phone_1' index.");

    console.log("Cleanup and index rebuild completed successfully!");

  } catch (err) {
    console.error("Error during cleanup:", err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

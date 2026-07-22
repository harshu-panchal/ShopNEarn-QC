import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const uri = process.env.MONGO_URI;

async function run() {
  try {
    await mongoose.connect(uri);
    console.log("Connected to MongoDB");

    // Number is stored with +91 internally
    const phoneToFind = "+919909035007";
    
    // Check main User collection
    const users = await mongoose.connection.db.collection('users').find({ phone: phoneToFind }).toArray();
    
    if (users.length > 0) {
        console.log("--- FOUND IN USERS COLLECTION ---");
        users.forEach(u => {
            console.log(`Role: ${u.role}`);
            console.log(`Name: ${u.name}`);
            console.log(`Is Active: ${u.isActive}`);
            console.log(`Soft Deleted At: ${u.deletedAt || 'Not deleted'}`);
            console.log(`OTP Locked Until: ${u.otpLockedUntil || 'Not locked'}`);
        });
    } else {
        console.log("Not found in 'users' collection.");
    }

  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();

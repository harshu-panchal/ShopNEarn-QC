import mongoose from "mongoose";
import dotenv from "dotenv";
import Customer from "../app/models/customer.js";
import { issueCustomerOtp } from "../app/services/otpAuthService.js";
import { createAllIndexes } from "../app/services/databaseIndexManager.js";

dotenv.config();

const mongoUri = process.env.MONGO_URI_TEST || process.env.MONGO_URI;
const RUN_DB_TESTS = !!mongoUri;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describeDb("Customer Registration with Soft-Deleted Phone Number", () => {
  const testPhone = "+919999999999";
  let dbName;

  beforeAll(async () => {
    if (!mongoUri) {
      throw new Error("No MongoDB URI found in environment");
    }
    
    // Shortened to stay under MongoDB's 38-character database name limit
    dbName = `qc_signup_${Date.now()}`;
    await mongoose.connect(mongoUri, {
      dbName,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    
    // Drop any existing unique phone index and recreate all indexes
    await mongoose.connection.collection("users").dropIndexes().catch(() => {});
    await createAllIndexes();
  }, 30000);

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase();
      await mongoose.connection.close();
    }
  }, 30000);

  beforeEach(async () => {
    // Clean up test data
    await Customer.deleteMany({ phone: testPhone, __includeDeleted: true });
  });

  it("should allow a new user to register using the phone number of a soft-deleted account", async () => {
    // 1. Create a user and verify them
    const originalUser = await Customer.create({
      name: "Original User",
      phone: testPhone,
      isVerified: true,
      role: "user",
    });

    expect(originalUser.isVerified).toBe(true);

    // 2. Soft-delete the user
    originalUser.deletedAt = new Date();
    originalUser.isActive = false;
    await originalUser.save();

    // 3. Verify that querying by phone number returns null (due to pre-find soft delete filter)
    const foundDeletedUser = await Customer.findOne({ phone: testPhone });
    expect(foundDeletedUser).toBeNull();

    // 4. Attempt to signup/register a new user with the same phone number
    // This should not throw "PHONE_ALREADY_REGISTERED"
    await expect(
      issueCustomerOtp({
        name: "New User",
        rawPhone: testPhone,
        flow: "signup",
        ipAddress: "127.0.0.1",
        referralCode: "",
      })
    ).resolves.not.toThrow();

    // 5. Verify that a new, unverified user has been created with the same phone number
    const activeUser = await Customer.findOne({ phone: testPhone });
    expect(activeUser).not.toBeNull();
    expect(activeUser.name).toBe("New User");
    expect(activeUser.isVerified).toBe(false);
    expect(String(activeUser._id)).not.toBe(String(originalUser._id));

    // 6. Verify that both records exist in the database under different states
    const allMatchingUsers = await Customer.find({ phone: testPhone, __includeDeleted: true });
    expect(allMatchingUsers.length).toBe(2);

    const deletedRecord = allMatchingUsers.find(u => String(u._id) === String(originalUser._id));
    const activeRecord = allMatchingUsers.find(u => String(u._id) === String(activeUser._id));

    expect(deletedRecord.deletedAt).not.toBeNull();
    expect(activeRecord.deletedAt).toBeNull();
  });
});

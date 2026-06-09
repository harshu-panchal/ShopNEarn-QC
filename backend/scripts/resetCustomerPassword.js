import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import Customer from "../app/models/customer.js";
import { normalizePhoneNumber } from "../app/utils/phone.js";

dotenv.config();

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

// CLI usage:
//   node scripts/resetCustomerPassword.js <phone> <newPassword>
// Defaults are kept for the original one-off request so re-running
// without args still does the same thing.
const rawPhone = process.argv[2] || "+919327796208";
const newPassword = process.argv[3] || "123456";

const run = async () => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        throw new Error("MONGO_URI environment variable is not defined");
    }

    await mongoose.connect(mongoUri);
    console.log("✓ Connected to MongoDB");

    const phone = normalizePhoneNumber(rawPhone);
    console.log(`Looking up customer by phone: ${phone}`);

    const customer = await Customer.findOne({ phone }).select(
        "+password +_signupPasswordPlaintext",
    );

    if (!customer) {
        console.error(`❌ No customer found with phone ${phone}`);
        process.exit(1);
    }

    console.log("✓ Customer found:");
    console.log("  _id   :", String(customer._id));
    console.log("  name  :", customer.name);
    console.log("  email :", customer.email);
    console.log("  phone :", customer.phone);

    const passwordHash = await bcrypt.hash(String(newPassword), BCRYPT_ROUNDS);
    customer.password = passwordHash;
    // Keep the plaintext mirror in sync so the in-app
    // "Account Credentials" screen and the admin reveal flow
    // (getMlmMemberDetail) display the new password instead of "—".
    customer._signupPasswordPlaintext = String(newPassword);

    await customer.save();

    console.log("\n✅ Password updated successfully");
    console.log("  phone    :", phone);
    console.log("  password :", newPassword);
};

run()
    .catch((err) => {
        console.error("✗ Error:", err.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect().catch(() => {});
        process.exit(process.exitCode || 0);
    });

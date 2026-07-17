import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin from "../app/models/admin.js";
import {
  ensureSuperAdminRole,
} from "../app/services/admin/adminRbacService.js";

dotenv.config();

const seedAdmin = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error("MONGO_URI environment variable is not defined");
    }

    await mongoose.connect(mongoUri);
    console.log("✓ Connected to MongoDB");

    const superRole = await ensureSuperAdminRole();
    console.log("✓ Ensured super_admin role:", superRole.key);

    const adminData = {
      name: process.env.ADMIN_SEED_NAME || "Admin",
      email: process.env.ADMIN_SEED_EMAIL || "admin@admin.com",
      password: process.env.ADMIN_SEED_PASSWORD || "Admin!@#123",
      role: "admin",
      roleId: superRole._id,
      isVerified: true,
      isActive: true,
      tokenVersion: 0,
    };

    const admin = await Admin.findOne({ email: adminData.email }).select("+password");

    if (admin) {
      admin.name = adminData.name;
      admin.password = adminData.password;
      admin.role = "admin";
      admin.roleId = superRole._id;
      admin.isVerified = true;
      admin.isActive = true;
      if (admin.tokenVersion == null) admin.tokenVersion = 0;
      await admin.save();
      console.log("✓ Admin user updated successfully!");
    } else {
      const createdAdmin = new Admin(adminData);
      await createdAdmin.save();
      console.log("✓ Admin user created successfully!");
    }

    console.log("Email:", adminData.email);
    if (process.env.NODE_ENV !== "production") {
      console.log("Password:", adminData.password);
    } else {
      console.log("Password: [redacted in production]");
    }
    console.log("Name:", adminData.name);
    console.log("Role:", superRole.key);

    process.exit(0);
  } catch (error) {
    console.error("✗ Error seeding admin:", error.message);
    process.exit(1);
  }
};

seedAdmin();

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import Customer from "../app/models/customer.js";
import FranchiseRegistrationPayment from "../app/models/franchiseRegistrationPayment.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import { activateFranchiseFromRegistrationPayment } from "../app/services/franchise/franchiseActivationService.js";
import { PAYMENT_STATUS } from "../app/constants/payment.js";

async function approveParulFranchise() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error("MONGO_URI is missing in environment");
      process.exit(1);
    }

    console.log("Connecting to MongoDB...");
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB successfully.");

    // 1. Try finding payment by exact Payment ID from screenshot: 6a7598221ffff322f2a76616
    const knownPaymentId = "6a7598221ffff322f2a76616";
    let payment = null;

    if (mongoose.Types.ObjectId.isValid(knownPaymentId)) {
      payment = await FranchiseRegistrationPayment.findById(knownPaymentId);
    }

    // 2. If not found by ID, find by customer phone / email / exact name
    if (!payment) {
      const customer = await Customer.findOne({
        $or: [
          { phone: "+916358744834" },
          { phone: "6358744834" },
          { email: "parulnshah1980@gmail.com" },
          { name: "Parul N Shah" },
        ],
      }).lean();

      if (customer) {
        console.log(`Found customer: ${customer.name} (ID: ${customer._id}, Phone: ${customer.phone})`);
        payment = await FranchiseRegistrationPayment.findOne({
          customer: customer._id,
        }).sort({ createdAt: -1 });
      }
    }

    if (!payment) {
      console.error("Could not find registration payment for Parul N Shah!");
      process.exit(1);
    }

    const customerObj = await Customer.findById(payment.customer).lean();
    console.log(`Target Customer: ${customerObj?.name || "Unknown"} (ID: ${payment.customer}, Phone: ${customerObj?.phone})`);
    console.log(`Target Registration Payment ID: ${payment._id}`);
    console.log(`Current payment status: ${payment.status}`);
    console.log(`Activation applied: ${payment.activationApplied}`);

    // Ensure status is CAPTURED
    payment.status = PAYMENT_STATUS.CAPTURED;
    payment.adminRemarks = "Approved via script";
    payment.reviewedAt = new Date();
    await payment.save();

    console.log("\nTriggering franchise partner activation...");

    // Execute activation
    const result = await activateFranchiseFromRegistrationPayment(payment._id);
    console.log("Activation result:", result);

    // Verify FranchisePartner document
    const partner = await FranchisePartner.findOne({ userId: payment.customer }).lean();
    if (partner) {
      console.log("\n=========================================");
      console.log("SUCCESS! Franchise Partner Activated:");
      console.log(`Partner ID: ${partner._id}`);
      console.log(`Referral Code: ${partner.referralCode}`);
      console.log(`Status: ${partner.status}`);
      console.log(`Display Name: ${partner.displayName}`);
      console.log("=========================================\n");
    } else {
      console.error("WARNING: FranchisePartner document not found after activation call!");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error executing script:", error);
    process.exit(1);
  }
}

approveParulFranchise();

import crypto from "crypto";
import mongoose from "mongoose";
import FranchisePartner from "../../models/franchisePartner.js";
import Customer from "../../models/customer.js";
import {
  FRANCHISE_PARTNER_STATUS,
} from "../../constants/franchise.js";
import { OWNER_TYPE } from "../../constants/finance.js";
import { getOrCreateWallet } from "../finance/walletService.js";
import { getFranchiseConfig, resolveHubSellerId } from "./franchiseConfigService.js";
import { formatFranchiseAddress } from "./franchiseAddressUtils.js";

function buildReferralCode() {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `HS${suffix}`;
}

async function mintUniqueReferralCode(session) {
  for (let i = 0; i < 8; i += 1) {
    const code = buildReferralCode();
    const exists = await FranchisePartner.findOne({ referralCode: code }, { _id: 1 })
      .session(session)
      .lean();
    if (!exists) return code;
  }
  throw new Error("Failed to generate franchise referral code");
}

export async function getFranchisePartnerByUserId(userId, { session } = {}) {
  let q = FranchisePartner.findOne({ userId });
  if (session) q = q.session(session);
  return q;
}

export async function activateFranchiseFromRegistrationPayment(paymentId, { session: externalSession } = {}) {
  const run = async (session) => {
    const payment = await mongoose
      .model("FranchiseRegistrationPayment")
      .findById(paymentId)
      .session(session);
    if (!payment) {
      const err = new Error("Registration payment not found");
      err.statusCode = 404;
      throw err;
    }
    if (payment.activationApplied) {
      const existing = await FranchisePartner.findById(payment.franchisePartnerId).session(session);
      return { skipped: true, franchisePartner: existing };
    }

    const existingPartner = await FranchisePartner.findOne({
      userId: payment.customer,
    }).session(session);
    if (existingPartner) {
      payment.activationApplied = true;
      payment.franchisePartnerId = existingPartner._id;
      payment.activationCompletedAt = new Date();
      await payment.save({ session });
      return { skipped: true, franchisePartner: existingPartner };
    }

    const cfg = await getFranchiseConfig();
    const hubSellerId = await resolveHubSellerId(cfg);
    const customer = await Customer.findById(payment.customer).session(session);
    const referralCode = await mintUniqueReferralCode(session);
    const addr = payment.addressSnapshot || {};

    const partnerPayload = {
      userId: payment.customer,
      referralCode,
      status: FRANCHISE_PARTNER_STATUS.ACTIVE,
      territoryPincodes: payment.territoryPincodesSnapshot?.length
        ? payment.territoryPincodesSnapshot
        : addr.pincode
          ? [addr.pincode]
          : [],
      hubSellerId,
      registrationPaymentId: payment._id,
      registeredAt: new Date(),
      displayName: customer?.name || "",
      phone: customer?.phone || "",
      address: addr.address || formatFranchiseAddress(addr),
      locality: addr.locality || "",
      pincode: addr.pincode || "",
      city: addr.city || "",
      state: addr.state || "",
    };

    if (addr.lat != null && addr.lng != null && Number.isFinite(addr.lat) && Number.isFinite(addr.lng)) {
      partnerPayload.location = {
        type: "Point",
        coordinates: [addr.lng, addr.lat],
      };
    }

    const partner = await FranchisePartner.create([partnerPayload], { session }).then(
      (rows) => rows[0],
    );

    await getOrCreateWallet(OWNER_TYPE.FRANCHISE, partner._id, { session });

    payment.activationApplied = true;
    payment.franchisePartnerId = partner._id;
    payment.activationCompletedAt = new Date();
    await payment.save({ session });

    return { activated: true, franchisePartner: partner };
  };

  if (externalSession) return run(externalSession);
  const session = await mongoose.startSession();
  try {
    let result;
    try {
      await session.withTransaction(async () => {
        result = await run(session);
      });
    } catch {
      result = await run(null);
    }
    return result;
  } finally {
    await session.endSession();
  }
}

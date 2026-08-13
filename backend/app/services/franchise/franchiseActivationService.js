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
import logger from "../logger.js";

function buildReferralCode() {
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `HS${suffix}`;
}

async function mintUniqueReferralCode(session = null) {
  for (let i = 0; i < 8; i += 1) {
    const code = buildReferralCode();
    let q = FranchisePartner.findOne({ referralCode: code }, { _id: 1 });
    if (session) q = q.session(session);
    const exists = await q.lean();
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
  const run = async (session = null) => {
    let paymentQuery = mongoose.model("FranchiseRegistrationPayment").findById(paymentId);
    if (session) paymentQuery = paymentQuery.session(session);
    const payment = await paymentQuery;

    if (!payment) {
      const err = new Error("Registration payment not found");
      err.statusCode = 404;
      throw err;
    }

    if (payment.activationApplied) {
      let existingQuery = FranchisePartner.findById(payment.franchisePartnerId);
      if (session) existingQuery = existingQuery.session(session);
      const existing = await existingQuery;
      return { skipped: true, franchisePartner: existing };
    }

    let existingPartnerQuery = FranchisePartner.findOne({
      userId: payment.customer,
    });
    if (session) existingPartnerQuery = existingPartnerQuery.session(session);
    const existingPartner = await existingPartnerQuery;

    if (existingPartner) {
      payment.activationApplied = true;
      payment.franchisePartnerId = existingPartner._id;
      payment.activationCompletedAt = new Date();
      if (session) await payment.save({ session });
      else await payment.save();
      return { skipped: true, franchisePartner: existingPartner };
    }

    const cfg = await getFranchiseConfig();
    const hubSellerId = await resolveHubSellerId(cfg);

    let customerQuery = Customer.findById(payment.customer);
    if (session) customerQuery = customerQuery.session(session);
    const customer = await customerQuery;

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

    const nLat = Number(addr?.lat);
    const nLng = Number(addr?.lng);
    if (Number.isFinite(nLat) && Number.isFinite(nLng) && nLat >= -90 && nLat <= 90 && nLng >= -180 && nLng <= 180) {
      partnerPayload.location = {
        type: "Point",
        coordinates: [nLng, nLat],
      };
    }

    const writeOptions = session ? { session } : {};
    const partner = await FranchisePartner.create([partnerPayload], writeOptions).then(
      (rows) => rows[0],
    );

    await getOrCreateWallet(OWNER_TYPE.FRANCHISE, partner._id, writeOptions);

    payment.activationApplied = true;
    payment.franchisePartnerId = partner._id;
    payment.activationCompletedAt = new Date();
    if (session) await payment.save({ session });
    else await payment.save();

    return { activated: true, franchisePartner: partner };
  };

  if (externalSession) return run(externalSession);

  try {
    const session = await mongoose.startSession();
    try {
      let result;
      try {
        await session.withTransaction(async () => {
          result = await run(session);
        });
      } catch (txnErr) {
        logger.warn("[activateFranchise] transaction failed, running without transaction", {
          paymentId: String(paymentId),
          error: txnErr.message,
        });
        result = await run(null);
      }
      return result;
    } finally {
      await session.endSession();
    }
  } catch (outerErr) {
    logger.warn("[activateFranchise] session creation failed, running directly", {
      paymentId: String(paymentId),
      error: outerErr.message,
    });
    return run(null);
  }
}

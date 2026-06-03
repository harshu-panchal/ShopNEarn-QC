import Joi from "joi";
import {
  ALL_MLM_BINARY_PLACEMENT_STRATEGIES,
  ALL_MLM_PAYMENT_MODES,
  ALL_MLM_PLAN_TYPES,
  ALL_MLM_RETURN_CLAWBACK_MODES,
  ALL_MLM_WITHDRAWAL_METHODS,
} from "../constants/mlm.js";

export const createWithdrawalRequestSchema = Joi.object({
  amount: Joi.number().positive().required(),
  beneficiary: Joi.object({
    method: Joi.string().valid(...ALL_MLM_WITHDRAWAL_METHODS).required(),
    accountHolderName: Joi.string().trim().allow("").max(200),
    accountNumber: Joi.string().trim().allow("").max(40),
    ifsc: Joi.string().trim().allow("").max(20),
    upiId: Joi.string().trim().allow("").max(120),
    panNumber: Joi.string().trim().allow("").max(20),
  }).required(),
  idempotencyKey: Joi.string().trim().max(120).optional(),
}).unknown(false);

export const updateMlmSettingsSchema = Joi.object({
  enabled: Joi.boolean(),
  signupRequiresReferralCode: Joi.boolean(),
  joiningPackagePrice: Joi.number().min(0),
  joiningPackageShoppingWalletCredit: Joi.number().min(0),
  joiningPaymentMode: Joi.string().valid(...ALL_MLM_PAYMENT_MODES),
  manualQr: Joi.object({
    imageUrl: Joi.string().trim().allow("").max(2048),
    upiId: Joi.string().trim().allow("").max(120),
    merchantName: Joi.string().trim().allow("").max(120),
    instructions: Joi.string().trim().allow("").max(2000),
  }),
  premiumUpgradeShoppingWalletTopup: Joi.number().min(0),
  planBAutoUpgradeAtPlanALifetimeEarnings: Joi.number().min(0),
  // DEPRECATED: replaced by `planAPairBonusTiers`. Retained on the
  // schema so admin clients submitting legacy payloads don't break.
  directReferralMilestones: Joi.array()
    .items(
      Joi.object({
        atDirectCount: Joi.number().integer().min(1).required(),
        bonusAmount: Joi.number().min(0).required(),
        planRequired: Joi.string().valid(...ALL_MLM_PLAN_TYPES).default("A"),
      }),
    )
    .max(50),
  // Plan A binary pair bonus configuration. Per-pair amounts are
  // explicit; pair indexes outside the table fall back to
  // `planAPairBonusFixedAmount` when their index exceeds
  // `planAPairBonusFixedAfterPair`.
  planAPairBonusTiers: Joi.array()
    .items(
      Joi.object({
        pairIndex: Joi.number().integer().min(1).required(),
        bonusAmount: Joi.number().min(0).required(),
      }),
    )
    .max(50),
  planAPairBonusFixedAfterPair: Joi.number().integer().min(0),
  planAPairBonusFixedAmount: Joi.number().min(0),
  planAPairBonusReleaseCooldownDays: Joi.number().integer().min(0).max(365),
  repurchaseBonusLevels: Joi.array()
    .items(
      Joi.object({
        level: Joi.number().integer().min(1).max(12).required(),
        ratePercent: Joi.number().min(0).max(100).required(),
      }),
    )
    .max(12),
  mentorRoyaltyLevels: Joi.array()
    .items(
      Joi.object({
        level: Joi.number().integer().min(1).max(6).required(),
        ratePercent: Joi.number().min(0).max(100).required(),
      }),
    )
    .max(6),
  homeShoppingProductId: Joi.string().allow(null, "").length(24),
  homeShoppingPrice: Joi.number().min(0),
  homeShoppingProductCreditValue: Joi.number().min(0),
  homeShoppingCommissions: Joi.object({
    salesPercent: Joi.number().min(0).max(100),
    referralPercent: Joi.number().min(0).max(100),
    royaltyPercent: Joi.number().min(0).max(100),
  }),
  withdrawalMinAmount: Joi.number().min(0),
  withdrawalAdminChargePercent: Joi.number().min(0).max(100),
  withdrawalGstOnAdminChargePercent: Joi.number().min(0).max(100),
  dailyEarningCap: Joi.number().min(0),
  binaryPlacementStrategy: Joi.string().valid(...ALL_MLM_BINARY_PLACEMENT_STRATEGIES),
  bonusesOnReturn: Joi.string().valid(...ALL_MLM_RETURN_CLAWBACK_MODES),
  sponsorChainMaxDepth: Joi.number().integer().min(1).max(50),
  referralCodeLength: Joi.number().integer().min(4).max(16),
}).unknown(false);

export function validateMlmSchema(schema, payload) {
  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
  });
  if (!error) return value;
  const err = new Error(error.details.map((item) => item.message).join("; "));
  err.statusCode = 400;
  throw err;
}

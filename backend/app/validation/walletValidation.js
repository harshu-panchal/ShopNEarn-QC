/**
 * Joi schemas for wallet / payout endpoints across all owner types
 * (CUSTOMER, SELLER, DELIVERY_PARTNER).
 *
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 *
 * Note: order-finance flows (refunds, settlements) live in
 * `financeValidation.js` since they are coupled to per-order operations.
 * Wallet-level credit / debit / withdrawal schemas live here.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const objectIdLike = trimmedString.min(8).max(64);

const ownerType = trimmedString.valid("CUSTOMER", "SELLER", "DELIVERY_PARTNER");

export const creditWalletSchema = Joi.object({
  ownerType: ownerType.required(),
  ownerId: objectIdLike.required(),
  amount: Joi.number().min(0.01).required(),
  reason: trimmedString.max(500).required(),
  referenceType: trimmedString.max(80).optional(),
  referenceId: trimmedString.max(120).optional(),
  metadata: Joi.object().unknown(true).optional(),
});

export const debitWalletSchema = creditWalletSchema;

export const withdrawalCreateSchema = Joi.object({
  amount: Joi.number().min(1).required(),
  bankAccountId: trimmedString.optional(),
  upiId: trimmedString.max(120).optional(),
  notes: trimmedString.max(500).optional(),
});

export const withdrawalActionSchema = Joi.object({
  withdrawalId: objectIdLike.required(),
  action: trimmedString.valid("approve", "reject", "process", "complete").required(),
  notes: trimmedString.max(500).optional(),
  transactionRef: trimmedString.max(200).optional(),
});

export const codSubmissionSchema = Joi.object({
  amount: Joi.number().min(0).required(),
  notes: trimmedString.max(500).optional(),
});

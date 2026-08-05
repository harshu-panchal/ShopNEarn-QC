import Joi from "joi";
import { ALL_FRANCHISE_POS_PAYMENT_METHODS } from "../constants/franchise.js";

const posLineItemSchema = Joi.object({
  productId: Joi.string().trim().required(),
  quantity: Joi.number().integer().min(1).max(999).required(),
});

export const posPreviewBodySchema = Joi.object({
  items: Joi.array().items(posLineItemSchema).min(1).max(50).required(),
});

export const posSaleBodySchema = Joi.object({
  items: Joi.array().items(posLineItemSchema).min(1).max(50).required(),
  buyer: Joi.object({
    kind: Joi.string().valid("guest", "registered").default("guest"),
    name: Joi.string().trim().max(120).allow(""),
    phone: Joi.string().trim().max(20).allow(""),
    customerId: Joi.string().trim().allow(null, ""),
  }).default({ kind: "guest" }),
  payment: Joi.object({
    method: Joi.string()
      .valid(...ALL_FRANCHISE_POS_PAYMENT_METHODS)
      .required(),
    upiReference: Joi.string().trim().max(120).allow(""),
  }).required(),
});

export const posLookupPhoneQuerySchema = Joi.object({
  phone: Joi.string().trim().min(8).max(20).required(),
});

export const posSaleUpdateBodySchema = Joi.object({
  items: Joi.array().items(posLineItemSchema).min(1).max(50).required(),
  buyer: Joi.object({
    kind: Joi.string().valid("guest", "registered").default("guest"),
    name: Joi.string().trim().max(120).allow(""),
    phone: Joi.string().trim().max(20).allow(""),
    customerId: Joi.string().trim().allow(null, ""),
  }).default({ kind: "guest" }),
  payment: Joi.object({
    method: Joi.string()
      .valid(...ALL_FRANCHISE_POS_PAYMENT_METHODS)
      .required(),
    upiReference: Joi.string().trim().max(120).allow(""),
  }).required(),
  reason: Joi.string().trim().max(250).allow(""),
});

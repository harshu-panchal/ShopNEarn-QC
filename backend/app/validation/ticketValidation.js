/**
 * Joi schemas for support-ticket endpoints.
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();

export const createTicketSchema = Joi.object({
  subject: trimmedString.min(2).max(200).required(),
  description: trimmedString.min(2).max(5000).required(),
  priority: trimmedString.valid("low", "medium", "high", "urgent").optional(),
  userType: trimmedString
    .valid("Customer", "Seller", "Delivery", "User")
    .optional(),
  mediaUrl: trimmedString.uri().max(2048).allow("", null).optional(),
  mediaType: trimmedString.max(40).allow("", null).optional(),
  mimeType: trimmedString.max(120).allow("", null).optional(),
});

export const addTicketMessageSchema = Joi.object({
  text: trimmedString.max(5000).allow("", null).optional(),
  mediaUrl: trimmedString.uri().max(2048).allow("", null).optional(),
  mediaType: trimmedString.max(40).allow("", null).optional(),
  mimeType: trimmedString.max(120).allow("", null).optional(),
}).or("text", "mediaUrl");

export const updateTicketStatusSchema = Joi.object({
  status: trimmedString
    .valid("open", "in_progress", "resolved", "closed", "reopened")
    .required(),
  resolutionNote: trimmedString.max(2000).optional(),
});

import Joi from "joi";
import {
    LEGAL_PAGE_APPS,
    LEGAL_PAGE_STATUSES,
} from "../models/legalPage.js";

const slugRule = Joi.string()
    .trim()
    .lowercase()
    .min(2)
    .max(80)
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .messages({
        "string.pattern.base":
            "slug must be lowercase kebab-case (e.g. privacy-policy)",
    });

export const createLegalPageSchema = Joi.object({
    app: Joi.string()
        .valid(...LEGAL_PAGE_APPS)
        .required(),
    slug: slugRule.required(),
    title: Joi.string().trim().min(2).max(200).required(),
    content: Joi.string().allow("").max(200_000).default(""),
    status: Joi.string()
        .valid(...LEGAL_PAGE_STATUSES)
        .default("draft"),
});

export const updateLegalPageSchema = Joi.object({
    title: Joi.string().trim().min(2).max(200),
    // Slug edits are allowed but rare — they break public URLs and
    // any deep links the marketing team has handed out. Frontend
    // surfaces a warning when the field changes.
    slug: slugRule,
    content: Joi.string().allow("").max(200_000),
    status: Joi.string().valid(...LEGAL_PAGE_STATUSES),
}).min(1);

export const listLegalPagesSchema = Joi.object({
    app: Joi.string().valid(...LEGAL_PAGE_APPS),
    status: Joi.string().valid(...LEGAL_PAGE_STATUSES),
    search: Joi.string().trim().max(200).allow(""),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(50),
});

export function validateSchema(schema, payload) {
    const { error, value } = schema.validate(payload, {
        abortEarly: false,
        stripUnknown: true,
    });
    if (!error) return value;
    const err = new Error(error.details.map((d) => d.message).join("; "));
    err.statusCode = 400;
    throw err;
}

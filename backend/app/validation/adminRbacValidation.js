import Joi from "joi";
import { ALL_ADMIN_PERMISSION_KEYS } from "../constants/adminPermissions.js";

const objectId = Joi.string().hex().length(24);

const passwordSchema = Joi.string()
  .min(10)
  .max(128)
  .pattern(/[a-z]/, "lowercase")
  .pattern(/[A-Z]/, "uppercase")
  .pattern(/[0-9]/, "number")
  .required();

export const createRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  key: Joi.string()
    .trim()
    .lowercase()
    .pattern(/^[a-z0-9_]+$/)
    .max(64)
    .optional(),
  description: Joi.string().trim().allow("").max(500).optional(),
  permissions: Joi.array()
    .items(Joi.string().valid(...ALL_ADMIN_PERMISSION_KEYS))
    .default([]),
  isActive: Joi.boolean().optional(),
});

export const updateRoleSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).optional(),
  description: Joi.string().trim().allow("").max(500).optional(),
  permissions: Joi.array()
    .items(Joi.string().valid(...ALL_ADMIN_PERMISSION_KEYS))
    .optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

export const createAdminSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email().required(),
  phone: Joi.string().trim().allow("", null).max(20).optional(),
  password: passwordSchema,
  roleId: objectId.required(),
});

export const updateAdminSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).optional(),
  email: Joi.string().trim().lowercase().email().optional(),
  phone: Joi.string().trim().allow("", null).max(20).optional(),
  isActive: Joi.boolean().optional(),
}).min(1);

export const assignRoleSchema = Joi.object({
  roleId: objectId.required(),
});

export const resetAdminPasswordSchema = Joi.object({
  password: passwordSchema,
});

export const roleIdParamsSchema = Joi.object({
  id: objectId.required(),
});

export const adminIdParamsSchema = Joi.object({
  id: objectId.required(),
});

export const listAdminsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(50),
});

import Joi from "joi";

export const updateFranchiseLocationBodySchema = Joi.object({
  displayName: Joi.string().trim().max(120).allow(""),
  phone: Joi.string().trim().max(20).allow(""),
  address: Joi.string().trim().max(250).allow(""),
  locality: Joi.string().trim().max(120).allow(""),
  pincode: Joi.string().trim().max(10).allow(""),
  city: Joi.string().trim().max(100).allow(""),
  state: Joi.string().trim().max(100).allow(""),
  lat: Joi.number().min(-90).max(90).allow(null, ""),
  lng: Joi.number().min(-180).max(180).allow(null, ""),
});

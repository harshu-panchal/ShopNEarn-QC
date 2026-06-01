/**
 * Joi schemas for the maps controller.
 * Refactor P5.2. Opt-in adoption — see orderValidation.js header.
 *
 * Used via `validate(schema)` middleware OR `validateBodySafe`/`validateBody`
 * for query-string payloads (mapped through `req.query`).
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();
const latitude = Joi.number().min(-90).max(90);
const longitude = Joi.number().min(-180).max(180);

/**
 * Query schema for `/maps/geocode`. Either `address` or `placeId` is
 * required (the controller falls back from one to the other).
 */
export const geocodeQuerySchema = Joi.object({
  address: trimmedString.min(3).max(500).optional(),
  placeId: trimmedString.min(3).max(200).optional(),
  country: trimmedString.length(2).uppercase().optional(),
}).or("address", "placeId");

/** Query schema for `/maps/reverse-geocode`. */
export const reverseGeocodeQuerySchema = Joi.object({
  lat: latitude.required(),
  lng: longitude.required(),
});

/** Body schema for `/maps/route`. */
export const routeRequestSchema = Joi.object({
  origin: Joi.object({
    lat: latitude.required(),
    lng: longitude.required(),
  }).required(),
  destination: Joi.object({
    lat: latitude.required(),
    lng: longitude.required(),
  }).required(),
  mode: trimmedString
    .valid("driving", "walking", "bicycling", "transit")
    .optional(),
});

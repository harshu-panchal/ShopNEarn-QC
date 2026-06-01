import express from "express";
import { geocodeAddressController } from "../controller/mapsController.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import { mapsRateLimit } from "../middleware/mapsRateLimit.js";
import { validate } from "../middleware/validate.js";
import { geocodeQuerySchema } from "../validation/mapsValidation.js";

const router = express.Router();

// Forward geocode: address string -> lat/lng (server-side key).
// Auth required to avoid public abuse of the server API key.
// Query validation wired in Phase 1 (audit-plan ticket P1-4); the
// controller's own "ADDRESS_REQUIRED" guard remains as a defensive
// net for any consumer bypassing the schema.
router.get(
    "/geocode",
    verifyToken,
    mapsRateLimit,
    validate(geocodeQuerySchema, "query"),
    geocodeAddressController,
);

export default router;

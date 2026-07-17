import express from "express";
import {
  getPublicOffers,
  getAdminOffers,
  createOffer,
  updateOffer,
  deleteOffer,
  reorderOffers,
} from "../controller/offerController.js";
import {
  getPublicOfferSections,
  getAdminOfferSections,
  createOfferSection,
  updateOfferSection,
  deleteOfferSection,
  reorderOfferSections,
} from "../controller/offerSectionController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/offers", getPublicOffers);
router.get("/offer-sections", getPublicOfferSections);

router.get("/admin-offers", ...adminPermissionGuard("marketing:view"), getAdminOffers);
router.post("/admin-offers", ...adminPermissionGuard("marketing:create"), createOffer);
router.put("/admin-offers/reorder", ...adminPermissionGuard("marketing:update"), reorderOffers);
router.put("/admin-offers/:id", ...adminPermissionGuard("marketing:update"), updateOffer);
router.delete("/admin-offers/:id", ...adminPermissionGuard("marketing:delete"), deleteOffer);

router.get("/admin-offer-sections", ...adminPermissionGuard("marketing:view"), getAdminOfferSections);
router.post("/admin-offer-sections", ...adminPermissionGuard("marketing:create"), createOfferSection);
router.put(
  "/admin-offer-sections/reorder",
  ...adminPermissionGuard("marketing:update"),
  reorderOfferSections,
);
router.put("/admin-offer-sections/:id", ...adminPermissionGuard("marketing:update"), updateOfferSection);
router.delete(
  "/admin-offer-sections/:id",
  ...adminPermissionGuard("marketing:delete"),
  deleteOfferSection,
);

export default router;

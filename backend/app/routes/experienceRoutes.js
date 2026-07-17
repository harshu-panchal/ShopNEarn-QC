import express from "express";
import multer from "multer";
import {
  uploadBannerImage,
  getPublicHeroConfig,
  getAdminHeroConfig,
  upsertHeroConfig,
} from "../controller/experienceController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Admin hero config
router.get(
  "/admin/experience/hero",
  ...adminPermissionGuard("marketing:view"),
  getAdminHeroConfig
);
router.put(
  "/admin/experience/hero",
  ...adminPermissionGuard("marketing:update"),
  upsertHeroConfig
);

router.post(
  "/admin/experience/upload-banner",
  ...adminPermissionGuard("marketing:update"),
  upload.single("image"),
  uploadBannerImage
);

// Public routes
router.get("/experience/hero", getPublicHeroConfig);

export default router;

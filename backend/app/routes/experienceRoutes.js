import express from "express";
import multer from "multer";
import {
  uploadBannerImage,
  getPublicHeroConfig,
  getAdminHeroConfig,
  upsertHeroConfig,
} from "../controller/experienceController.js";
import { verifyToken, allowRoles } from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Admin hero config
router.get(
  "/admin/experience/hero",
  verifyToken,
  allowRoles("admin"),
  getAdminHeroConfig
);
router.put(
  "/admin/experience/hero",
  verifyToken,
  allowRoles("admin"),
  upsertHeroConfig
);

router.post(
  "/admin/experience/upload-banner",
  verifyToken,
  allowRoles("admin"),
  upload.single("image"),
  uploadBannerImage
);

// Public routes
router.get("/experience/hero", getPublicHeroConfig);

export default router;

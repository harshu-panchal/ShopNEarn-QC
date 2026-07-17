import express from "express";
import {
    listCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    validateCoupon,
} from "../controller/couponController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin management
router.get("/admin/coupons", ...adminPermissionGuard("marketing:view"), listCoupons);
router.post("/admin/coupons", ...adminPermissionGuard("marketing:create"), createCoupon);
router.put("/admin/coupons/:id", ...adminPermissionGuard("marketing:update"), updateCoupon);
router.delete("/admin/coupons/:id", ...adminPermissionGuard("marketing:delete"), deleteCoupon);

// Customer‑facing
router.post("/coupons/validate", validateCoupon);
router.get("/coupons", listCoupons);

export default router;

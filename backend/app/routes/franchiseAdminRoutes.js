import express from "express";
import { allowRoles, verifyToken } from "../middleware/authMiddleware.js";
import {
  getFranchiseAdminDashboard,
  listRegistrationReviews,
  approveRegistration,
  rejectRegistration,
  listTopUpReviews,
  approveTopUp,
  rejectTopUp,
  listPartners,
  getPartnerDetail,
  patchPartnerTerritory,
  adjustWallet,
  updateFranchiseSettings,
  getFranchiseSettings,
  markHubSeller,
  listFranchiseDispatchOrders,
  assignFranchiseDispatchDelivery,
} from "../controller/admin/franchiseAdminController.js";

const router = express.Router();
const adminGuard = [verifyToken, allowRoles("admin")];

router.get("/dashboard", ...adminGuard, getFranchiseAdminDashboard);
router.get("/settings", ...adminGuard, getFranchiseSettings);
router.put("/settings", ...adminGuard, updateFranchiseSettings);
router.post("/hub-seller/:sellerId", ...adminGuard, markHubSeller);

router.get("/registrations", ...adminGuard, listRegistrationReviews);
router.post("/registrations/:id/approve", ...adminGuard, approveRegistration);
router.post("/registrations/:id/reject", ...adminGuard, rejectRegistration);

router.get("/topups", ...adminGuard, listTopUpReviews);
router.post("/topups/:id/approve", ...adminGuard, approveTopUp);
router.post("/topups/:id/reject", ...adminGuard, rejectTopUp);

router.get("/partners", ...adminGuard, listPartners);
router.get("/partners/:id", ...adminGuard, getPartnerDetail);
router.patch("/partners/:id/territory", ...adminGuard, patchPartnerTerritory);
router.post("/partners/:id/adjust-wallet", ...adminGuard, adjustWallet);

router.get("/orders", ...adminGuard, listFranchiseDispatchOrders);
router.post("/orders/:orderId/assign-delivery", ...adminGuard, assignFranchiseDispatchDelivery);

export default router;

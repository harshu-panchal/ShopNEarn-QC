import express from "express";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";
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
  issueHubSellerImpersonationToken,
  listFranchiseDispatchOrders,
  assignFranchiseDispatchDelivery,
  listAdminStockOrders,
  dispatchAdminStockOrder,
  approveAdminStockOrderReceipt,
} from "../controller/admin/franchiseAdminController.js";

const router = express.Router();

router.get("/dashboard", ...adminPermissionGuard("franchise:view"), getFranchiseAdminDashboard);
router.get("/settings", ...adminPermissionGuard("franchise:settings"), getFranchiseSettings);
router.put("/settings", ...adminPermissionGuard("franchise:settings"), updateFranchiseSettings);
router.post(
  "/hub-seller/impersonation-token",
  ...adminPermissionGuard("franchise:impersonate"),
  issueHubSellerImpersonationToken,
);
router.post("/hub-seller/:sellerId", ...adminPermissionGuard("franchise:settings"), markHubSeller);

router.get("/registrations", ...adminPermissionGuard("franchise:view"), listRegistrationReviews);
router.post("/registrations/:id/approve", ...adminPermissionGuard("franchise:approve"), approveRegistration);
router.post("/registrations/:id/reject", ...adminPermissionGuard("franchise:reject"), rejectRegistration);

router.get("/topups", ...adminPermissionGuard("franchise:view"), listTopUpReviews);
router.post("/topups/:id/approve", ...adminPermissionGuard("franchise:approve"), approveTopUp);
router.post("/topups/:id/reject", ...adminPermissionGuard("franchise:reject"), rejectTopUp);

router.get("/partners", ...adminPermissionGuard("franchise:view"), listPartners);
router.get("/partners/:id", ...adminPermissionGuard("franchise:view"), getPartnerDetail);
router.patch("/partners/:id/territory", ...adminPermissionGuard("franchise:adjust"), patchPartnerTerritory);
router.post("/partners/:id/adjust-wallet", ...adminPermissionGuard("franchise:adjust"), adjustWallet);

router.get("/orders", ...adminPermissionGuard("franchise:dispatch"), listFranchiseDispatchOrders);
router.post(
  "/orders/:orderId/assign-delivery",
  ...adminPermissionGuard("franchise:dispatch"),
  assignFranchiseDispatchDelivery,
);

router.get("/stock-orders", ...adminPermissionGuard("franchise:view"), listAdminStockOrders);
router.post("/stock-orders/:orderId/dispatch", ...adminPermissionGuard("franchise:approve"), dispatchAdminStockOrder);
router.post("/stock-orders/:orderId/approve-receipt", ...adminPermissionGuard("franchise:approve"), approveAdminStockOrderReceipt);

export default router;

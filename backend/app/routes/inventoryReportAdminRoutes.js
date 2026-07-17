import express from "express";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";
import {
  exportAdminInventoryReports,
  getAdminInventoryB2bReports,
  getAdminInventoryCustomerReports,
  getAdminInventoryCustomerRetailReports,
  getAdminInventoryFranchiseReports,
  getAdminInventoryHubReports,
  getAdminInventoryOverviewReports,
  getAdminInventorySellerReports,
  getAdminInventoryTransferReconciliation,
} from "../controller/inventoryReportController.js";

const router = express.Router();

router.get("/overview", ...adminPermissionGuard("inventory:view"), getAdminInventoryOverviewReports);
router.get("/sellers", ...adminPermissionGuard("inventory:view"), getAdminInventorySellerReports);
router.get("/franchise", ...adminPermissionGuard("inventory:view"), getAdminInventoryFranchiseReports);
router.get("/hub", ...adminPermissionGuard("inventory:view"), getAdminInventoryHubReports);
router.get("/b2b-purchases", ...adminPermissionGuard("inventory:view"), getAdminInventoryB2bReports);
router.get(
  "/customer-retail",
  ...adminPermissionGuard("inventory:view"),
  getAdminInventoryCustomerRetailReports,
);
router.get("/customer", ...adminPermissionGuard("inventory:view"), getAdminInventoryCustomerReports);
router.get(
  "/transfers/reconciliation",
  ...adminPermissionGuard("inventory:view"),
  getAdminInventoryTransferReconciliation,
);
router.get("/export", ...adminPermissionGuard("inventory:export"), exportAdminInventoryReports);

export default router;

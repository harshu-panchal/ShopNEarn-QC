import express from "express";
import { allowRoles, verifyToken } from "../middleware/authMiddleware.js";
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

router.get("/overview", verifyToken, allowRoles("admin"), getAdminInventoryOverviewReports);
router.get("/sellers", verifyToken, allowRoles("admin"), getAdminInventorySellerReports);
router.get("/franchise", verifyToken, allowRoles("admin"), getAdminInventoryFranchiseReports);
router.get("/hub", verifyToken, allowRoles("admin"), getAdminInventoryHubReports);
router.get("/b2b-purchases", verifyToken, allowRoles("admin"), getAdminInventoryB2bReports);
router.get(
  "/customer-retail",
  verifyToken,
  allowRoles("admin"),
  getAdminInventoryCustomerRetailReports,
);
router.get("/customer", verifyToken, allowRoles("admin"), getAdminInventoryCustomerReports);
router.get(
  "/transfers/reconciliation",
  verifyToken,
  allowRoles("admin"),
  getAdminInventoryTransferReconciliation,
);
router.get("/export", verifyToken, allowRoles("admin"), exportAdminInventoryReports);

export default router;

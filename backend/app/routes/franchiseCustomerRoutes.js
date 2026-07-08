import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import {
  getFranchiseMe,
  initiateRegistration,
  submitRegistrationProof,
  getRegistrationPayment,
  getCatalog,
  requestWalletTopUp,
  submitTopUpProof,
  listMyTopUps,
  getTransactionHistory,
  purchaseStock,
  getStock,
  getInventorySummary,
  getInventoryMovements,
  adjustInventory,
  listOrders,
  acceptOrder,
  rejectOrder,
  fulfillOrder,
  createShipment,
} from "../controller/franchiseCustomerController.js";
import {
  exportFranchiseInventoryReports,
  getFranchiseInventoryReports,
} from "../controller/inventoryReportController.js";

const router = express.Router();

router.get("/me", verifyToken, getFranchiseMe);
router.post("/register/initiate", verifyToken, initiateRegistration);
router.post("/register/submit-proof", verifyToken, submitRegistrationProof);
router.get("/register/payment/:paymentId", verifyToken, getRegistrationPayment);
router.get("/catalog", verifyToken, getCatalog);
router.post("/wallet/topup", verifyToken, requestWalletTopUp);
router.post("/wallet/submit-proof", verifyToken, submitTopUpProof);
router.get("/wallet/topups", verifyToken, listMyTopUps);
router.get("/wallet/transactions", verifyToken, getTransactionHistory);
router.post("/stock/purchase", verifyToken, purchaseStock);
router.get("/stock", verifyToken, getStock);
router.get("/inventory/summary", verifyToken, getInventorySummary);
router.get("/inventory/movements", verifyToken, getInventoryMovements);
router.get("/inventory/reports", verifyToken, getFranchiseInventoryReports);
router.get("/inventory/reports/export", verifyToken, exportFranchiseInventoryReports);
router.post("/inventory/adjust", verifyToken, adjustInventory);
router.get("/orders", verifyToken, listOrders);
router.patch("/orders/:orderId/accept", verifyToken, acceptOrder);
router.patch("/orders/:orderId/reject", verifyToken, rejectOrder);
router.patch("/orders/:orderId/fulfill", verifyToken, fulfillOrder);
router.post("/orders/:orderId/shipment", verifyToken, createShipment);

export default router;

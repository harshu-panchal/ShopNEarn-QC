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
  purchaseStock,
  getStock,
  listOrders,
  acceptOrder,
  rejectOrder,
  fulfillOrder,
} from "../controller/franchiseCustomerController.js";

const router = express.Router();

router.get("/me", verifyToken, getFranchiseMe);
router.post("/register/initiate", verifyToken, initiateRegistration);
router.post("/register/submit-proof", verifyToken, submitRegistrationProof);
router.get("/register/payment/:paymentId", verifyToken, getRegistrationPayment);
router.get("/catalog", verifyToken, getCatalog);
router.post("/wallet/topup", verifyToken, requestWalletTopUp);
router.post("/wallet/submit-proof", verifyToken, submitTopUpProof);
router.get("/wallet/topups", verifyToken, listMyTopUps);
router.post("/stock/purchase", verifyToken, purchaseStock);
router.get("/stock", verifyToken, getStock);
router.get("/orders", verifyToken, listOrders);
router.patch("/orders/:orderId/accept", verifyToken, acceptOrder);
router.patch("/orders/:orderId/reject", verifyToken, rejectOrder);
router.patch("/orders/:orderId/fulfill", verifyToken, fulfillOrder);

export default router;

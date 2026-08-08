import express from "express";
import {
  placeOrder,
  getMyOrders,
  getOrderDetails,
  cancelOrder,
  updateOrderStatus,
  getSellerOrders,
  getAvailableOrders,
  acceptOrder,
  skipOrder,
  requestReturn,
  getReturnDetails,
  getSellerReturns,
  approveReturnRequest,
  rejectReturnRequest,
  updateReturnQcStatus,
  assignReturnDelivery,
  acceptReturnPickup,
  rejectReturnPickup,
  updateReturnStatus,
  uploadReturnPickupProof,
  getSellerFranchiseStockOrders,
  dispatchSellerFranchiseStockOrder,
  cancelSellerFranchiseStockOrder,
} from "../controller/orderController.js";
import {
  createOrderWithFinancialSnapshot,
  markCodCollectedAfterDelivery,
  markOrderDeliveredAndSettle,
  previewCheckoutFinance,
  reconcileCodCashSubmission,
  verifyOnlineOrderPayment,
} from "../controller/orderFinanceController.js";
import {
  confirmPickup,
  markArrivedAtStore,
  advanceDeliveryRiderUi,
  requestDeliveryOtp,
  verifyDeliveryOtp,
  requestReturnPickupOtp,
  verifyReturnPickupOtp,
  requestReturnDropOtp,
  verifyReturnDropOtp,
  getOrderRoute,
} from "../controller/orderWorkflowController.js";
import {
  verifyToken,
  allowRoles,
  requireApprovedSeller,
  requireAdminPermissionIfAdmin,
} from "../middleware/authMiddleware.js";
import {
  exportCustomerPurchaseReports,
  getCustomerPurchaseReports,
} from "../controller/inventoryReportController.js";

const router = express.Router();

// Finance-aware checkout/order flow
router.post(
  "/checkout/preview",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:view"),
  previewCheckoutFinance,
);
router.post(
  "/",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  createOrderWithFinancialSnapshot,
);
router.post(
  "/:id/payment/verify-online",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  verifyOnlineOrderPayment,
);
router.post(
  "/:id/cod/mark-collected",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  markCodCollectedAfterDelivery,
);
router.post(
  "/:id/delivered",
  verifyToken,
  allowRoles("delivery", "admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:update"),
  markOrderDeliveredAndSettle,
);
router.post(
  "/:id/cod/reconcile",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  reconcileCodCashSubmission,
);

// Customer routes
router.post(
  "/place",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  placeOrder,
);
router.get("/my-orders", verifyToken, getMyOrders);
router.get(
  "/purchase-reports",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:view"),
  getCustomerPurchaseReports,
);
router.get(
  "/purchase-reports/export",
  verifyToken,
  allowRoles("customer", "user", "admin"),
  requireAdminPermissionIfAdmin("orders:view"),
  exportCustomerPurchaseReports,
);
router.get("/details/:orderId", verifyToken, getOrderDetails);
router.put("/cancel/:orderId", verifyToken, cancelOrder);
router.post("/:orderId/returns", verifyToken, requestReturn);
router.get("/:orderId/returns", verifyToken, getReturnDetails);

// Admin/Seller routes
router.get(
  "/seller-orders",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:view"),
  getSellerOrders,
);
router.get(
  "/seller-franchise-stock-orders",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:view"),
  getSellerFranchiseStockOrders,
);
router.post(
  "/seller-franchise-stock-orders/:orderId/dispatch",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:update"),
  dispatchSellerFranchiseStockOrder,
);
router.post(
  "/seller-franchise-stock-orders/:orderId/cancel",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:update"),
  cancelSellerFranchiseStockOrder,
);
router.put(
  "/status/:orderId",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:update"),
  updateOrderStatus,
);
router.get(
  "/seller-returns",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:returns"),
  getSellerReturns,
);
router.put(
  "/returns/:orderId/approve",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:returns"),
  approveReturnRequest,
);
router.put(
  "/returns/:orderId/reject",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:returns"),
  rejectReturnRequest,
);
router.put(
  "/returns/:orderId/qc",
  verifyToken,
  allowRoles("admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  updateReturnQcStatus,
);
router.put(
  "/returns/:orderId/assign-delivery",
  verifyToken,
  allowRoles("admin", "seller"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:returns"),
  assignReturnDelivery,
);

// Delivery routes
router.get(
  "/available",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:view"),
  getAvailableOrders,
);
router.put(
  "/accept/:orderId",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:update"),
  acceptOrder,
);
router.put(
  "/skip/:orderId",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:update"),
  skipOrder,
);
router.put(
  "/returns/:orderId/accept-pickup",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:returns"),
  acceptReturnPickup,
);
router.put(
  "/returns/:orderId/reject-pickup",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:returns"),
  rejectReturnPickup,
);
router.put(
  "/return-status/:orderId",
  verifyToken,
  allowRoles("admin", "delivery"),
  requireAdminPermissionIfAdmin("orders:returns"),
  updateReturnStatus,
);

// Workflow routes — standard delivery
router.post(
  "/workflow/:orderId/pickup/confirm",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  confirmPickup,
);
router.post(
  "/workflow/:orderId/pickup/ready",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  markArrivedAtStore,
);
router.post(
  "/workflow/:orderId/rider/advance-ui",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  advanceDeliveryRiderUi,
);
router.post(
  "/workflow/:orderId/otp/request",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  requestDeliveryOtp,
);
router.post(
  "/workflow/:orderId/otp/verify",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:update"),
  verifyDeliveryOtp,
);

// Workflow routes — return pickup OTP (customer)
router.post(
  "/workflow/:orderId/return-otp/request",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  requestReturnPickupOtp,
);
router.post(
  "/workflow/:orderId/return-otp/verify",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  verifyReturnPickupOtp,
);

// Workflow routes — return drop OTP (seller)
router.post(
  "/workflow/:orderId/return-drop-otp/request",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  requestReturnDropOtp,
);
router.post(
  "/workflow/:orderId/return-drop-otp/verify",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  verifyReturnDropOtp,
);

// Return pickup proof (images + condition)
router.post(
  "/returns/:orderId/pickup-proof",
  verifyToken,
  allowRoles("delivery", "admin"),
  requireAdminPermissionIfAdmin("orders:returns"),
  uploadReturnPickupProof,
);

// Route map
router.get(
  "/workflow/:orderId/route",
  verifyToken,
  allowRoles("customer", "user", "delivery", "seller", "admin"),
  requireApprovedSeller,
  requireAdminPermissionIfAdmin("orders:view"),
  getOrderRoute,
);

export default router;

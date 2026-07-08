import express from "express";
import {
    getProducts,
    getSellerProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    getProductById,
    getModerationProducts,
    approveProduct,
    rejectProduct,
} from "../controller/productController.js";
import {
    getBulkUploadTemplate,
    bulkUploadProducts,
} from "../controller/productBulkController.js";
import { adjustStock, getStockHistory, getInventorySummary } from "../controller/stockController.js";
import {
    verifyToken,
    allowRoles,
    optionalVerifyToken,
    requireApprovedSeller,
} from "../middleware/authMiddleware.js";
import {
    exportSellerInventoryReports,
    getSellerHubTransferReports,
    getSellerInventoryReports,
    getSellerTransferReconciliation,
} from "../controller/inventoryReportController.js";
import multer from "multer";

const storage = multer.memoryStorage();
const upload = multer({ storage });

const router = express.Router();

// Public routes with optional auth (to detect admin/seller vs customer)
router.get("/", optionalVerifyToken, getProducts);

// Seller protected routes
router.get("/seller/me", verifyToken, allowRoles("seller"), requireApprovedSeller, getSellerProducts);
router.get("/seller/bulk-template", verifyToken, allowRoles("seller"), getBulkUploadTemplate);
router.post("/seller/bulk-upload", verifyToken, allowRoles("seller"), requireApprovedSeller, upload.single("file"), bulkUploadProducts);
router.get("/stock-history", verifyToken, allowRoles("seller"), requireApprovedSeller, getStockHistory);
router.get("/inventory/summary", verifyToken, allowRoles("seller"), requireApprovedSeller, getInventorySummary);
router.get("/inventory/reports", verifyToken, allowRoles("seller"), requireApprovedSeller, getSellerInventoryReports);
router.get(
    "/inventory/reports/hub-transfers",
    verifyToken,
    allowRoles("seller"),
    requireApprovedSeller,
    getSellerHubTransferReports
);
router.get(
    "/inventory/reports/transfers/reconciliation",
    verifyToken,
    allowRoles("seller"),
    requireApprovedSeller,
    getSellerTransferReconciliation
);
router.get(
    "/inventory/reports/export",
    verifyToken,
    allowRoles("seller"),
    requireApprovedSeller,
    exportSellerInventoryReports
);
router.post("/adjust-stock", verifyToken, allowRoles("seller"), requireApprovedSeller, adjustStock);
router.get("/moderation", verifyToken, allowRoles("admin"), getModerationProducts);
router.patch("/moderation/:id/approve", verifyToken, allowRoles("admin"), approveProduct);
router.patch("/moderation/:id/reject", verifyToken, allowRoles("admin"), rejectProduct);
router.get("/:id", optionalVerifyToken, getProductById);

router.post(
    "/",
    verifyToken,
    allowRoles("seller", "admin"),
    requireApprovedSeller,
    upload.any(),
    createProduct
);

router.put(
    "/:id",
    verifyToken,
    allowRoles("seller", "admin"),
    requireApprovedSeller,
    upload.any(),
    updateProduct
);

router.delete(
    "/:id",
    verifyToken,
    allowRoles("seller", "admin"),
    requireApprovedSeller,
    deleteProduct
);

export default router;

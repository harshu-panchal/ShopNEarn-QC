import express from "express";
import {
    bootstrapAdmin,
    signupAdmin,
    loginAdmin,
} from "../controller/adminAuthController.js";
import {
    getAdminProfile,
    updateAdminProfile,
    updateAdminPassword,
    getAdminStats,
    getDeliveryPartners,
    approveDeliveryPartner,
    rejectDeliveryPartner,
    getActiveFleet,
    getAdminWalletData,
    getDeliveryTransactions,
    settleTransaction,
    bulkSettleDelivery,
    getActiveSellers,
    getPendingSellers,
    issueSellerImpersonationToken,
    approveSellerApplication,
    rejectSellerApplication,
    getSellerWithdrawals,
    getDeliveryWithdrawals,
    updateWithdrawalStatus,
    getSellerTransactions,
    getDeliveryCashBalances,
    getRiderCashDetails,
    settleRiderCash,
    getCashSettlementHistory,
    getUsers,
    getUserById,
    getSellers,
    getSellerLocations,
    getPlatformSettings,
    updatePlatformSettings
} from "../controller/adminController.js";
import {
    exportAdminFinanceStatementController,
    getAdminFinanceLedgerController,
    getAdminFinancePayoutsController,
    getAdminFinanceSummaryController,
    getDeliverySettingsController,
    processAdminFinancePayoutsController,
    updateDeliverySettingsController,
} from "../controller/adminFinanceController.js";

import {
    adminAuthGuard,
    adminPermissionGuard,
} from "../middleware/authMiddleware.js";
import {
    adminBootstrapRateLimiter,
    authRouteRateLimiter,
    createContentLengthGuard,
} from "../middleware/securityMiddlewares.js";
import { getAdminNavBadges } from "../controller/navBadgeController.js";

const router = express.Router();

const smallAdminPayload = createContentLengthGuard(
    parseInt(process.env.ADMIN_AUTH_MAX_PAYLOAD_BYTES || "20480", 10),
    "Admin auth payload too large",
);
router.post("/bootstrap", adminBootstrapRateLimiter, smallAdminPayload, bootstrapAdmin);
router.post("/signup", adminBootstrapRateLimiter, smallAdminPayload, signupAdmin);
router.post("/login", authRouteRateLimiter, smallAdminPayload, loginAdmin);

// Profile routes — any active admin
router.get("/profile", ...adminAuthGuard, getAdminProfile);
router.put("/profile", ...adminAuthGuard, updateAdminProfile);
router.put("/profile/password", ...adminAuthGuard, updateAdminPassword);

router.get("/stats", ...adminPermissionGuard("dashboard:view"), getAdminStats);
router.get("/finance/summary", ...adminPermissionGuard("finance:view"), getAdminFinanceSummaryController);
router.get("/finance/ledger", ...adminPermissionGuard("finance:view"), getAdminFinanceLedgerController);
router.get("/finance/payouts", ...adminPermissionGuard("finance:view"), getAdminFinancePayoutsController);
router.post("/finance/payouts/process", ...adminPermissionGuard("finance:process"), processAdminFinancePayoutsController);
router.get("/finance/export-statement", ...adminPermissionGuard("finance:export"), exportAdminFinanceStatementController);

router.get("/settings/platform", ...adminPermissionGuard("settings:view"), getPlatformSettings);
router.get("/settings/delivery", ...adminPermissionGuard("settings:view"), getDeliverySettingsController);
router.put("/settings/delivery", ...adminPermissionGuard("settings:update"), updateDeliverySettingsController);
router.put("/settings/platform", ...adminPermissionGuard("settings:update"), updatePlatformSettings);

router.get("/users", ...adminPermissionGuard("customers:view"), getUsers);
router.get("/users/:id", ...adminPermissionGuard("customers:view"), getUserById);
router.get("/sellers", ...adminPermissionGuard("sellers:view"), getSellers);
router.get("/sellers/locations", ...adminPermissionGuard("sellers:view"), getSellerLocations);
router.get("/sellers/active", ...adminPermissionGuard("sellers:view"), getActiveSellers);
router.post(
    "/sellers/:id/impersonation-token",
    ...adminPermissionGuard("sellers:impersonate"),
    issueSellerImpersonationToken,
);
router.get("/sellers/pending", ...adminPermissionGuard("sellers:view"), getPendingSellers);
router.patch("/sellers/approve/:id", ...adminPermissionGuard("sellers:approve"), approveSellerApplication);
router.delete("/sellers/reject/:id", ...adminPermissionGuard("sellers:reject"), rejectSellerApplication);

router.get("/delivery-partners", ...adminPermissionGuard("delivery:view"), getDeliveryPartners);
router.patch("/delivery-partners/approve/:id", ...adminPermissionGuard("delivery:approve"), approveDeliveryPartner);
router.delete("/delivery-partners/reject/:id", ...adminPermissionGuard("delivery:reject"), rejectDeliveryPartner);

router.get("/active-fleet", ...adminPermissionGuard("delivery:track"), getActiveFleet);
router.get("/wallet-data", ...adminPermissionGuard("finance:view"), getAdminWalletData);

router.get("/delivery-transactions", ...adminPermissionGuard("delivery:view"), getDeliveryTransactions);
router.put("/transactions/:id/settle", ...adminPermissionGuard("delivery:settle"), settleTransaction);
router.put("/transactions/bulk-settle-delivery", ...adminPermissionGuard("delivery:settle"), bulkSettleDelivery);

router.get("/delivery-cash", ...adminPermissionGuard("cash:view"), getDeliveryCashBalances);
router.get("/rider-cash-details/:id", ...adminPermissionGuard("cash:view"), getRiderCashDetails);
router.post("/settle-cash", ...adminPermissionGuard("cash:settle"), settleRiderCash);
router.get("/cash-history", ...adminPermissionGuard("cash:view"), getCashSettlementHistory);

router.get("/seller-withdrawals", ...adminPermissionGuard("finance:view"), getSellerWithdrawals);
router.get("/delivery-withdrawals", ...adminPermissionGuard("finance:view"), getDeliveryWithdrawals);
router.get("/seller-transactions", ...adminPermissionGuard("finance:view"), getSellerTransactions);
router.put("/withdrawals/:id", ...adminPermissionGuard("finance:settle"), updateWithdrawalStatus);

router.get("/nav-badges", ...adminAuthGuard, getAdminNavBadges);

router.get("/dashboard", ...adminPermissionGuard("dashboard:view"), (req, res) => {
    res.json({
        success: true,
        message: "Welcome to Admin Dashboard",
    });
});

export default router;

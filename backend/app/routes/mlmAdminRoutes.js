import express from "express";
import {
  addChildMember,
  adjustMemberWallet,
  approveJoiningReview,
  approveMlmMember,
  approveUpgradeReview,
  approveWithdrawal,
  createMilestoneRule,
  deactivateMember,
  deleteMilestoneRule,
  getMlmDashboard,
  getMlmMemberDetail,
  getMlmMemberDownlineTree,
  getMlmSettings,
  issueImpersonationToken,
  listAdminWithdrawals,
  listJoiningReviews,
  listUpgradeReviews,
  listMilestoneRules,
  listMlmMembers,
  exportMlmMembers,
  rejectJoiningReview,
  rejectUpgradeReview,
  rejectWithdrawal,
  softDeleteMember,
  deleteNonMlmCustomer,
  updateMemberProfile,
  updateMilestoneRule,
  updateMlmSettings,
  verifyMemberWalletEndpoint,
  listMlmMaintenanceJobs,
  runMlmMaintenanceJob,
  previewMoveBinaryMember,
  moveBinaryMember,
  listMlmPayoutReports,
  getMlmPayoutReport,
  generateMlmPayoutReport,
  patchMlmPayoutReportLineItem,
  applyMlmPayoutReportCorrection,
  finalizeMlmPayoutReport,
  exportMlmPayoutReport,
  deleteMlmPayoutReport,
} from "../controller/admin/mlmAdminController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", ...adminPermissionGuard("mlm:view"), getMlmDashboard);
router.get("/members/export", ...adminPermissionGuard("mlm:view"), exportMlmMembers);
router.get("/members", ...adminPermissionGuard("mlm:view"), listMlmMembers);
router.get("/members/:id", ...adminPermissionGuard("mlm:view"), getMlmMemberDetail);
router.get("/members/:id/downline", ...adminPermissionGuard("mlm:view"), getMlmMemberDownlineTree);
router.post("/members/:id/adjust-wallet", ...adminPermissionGuard("mlm:adjust"), adjustMemberWallet);
router.get("/members/:id/wallet-verification", ...adminPermissionGuard("mlm:view"), verifyMemberWalletEndpoint);

router.post("/members/:id/approve", ...adminPermissionGuard("mlm:approve"), approveMlmMember);
router.post("/members/:id/add-child", ...adminPermissionGuard("mlm:move"), addChildMember);
router.post("/members/:id/move-binary/preview", ...adminPermissionGuard("mlm:move"), previewMoveBinaryMember);
router.post("/members/:id/move-binary", ...adminPermissionGuard("mlm:move"), moveBinaryMember);
router.post("/members/:id/impersonation-token", ...adminPermissionGuard("mlm:impersonate"), issueImpersonationToken);
router.post("/members/:id/soft-delete", ...adminPermissionGuard("mlm:adjust"), softDeleteMember);
router.post("/customers/:customerId/delete-non-member", ...adminPermissionGuard("customers:view"), deleteNonMlmCustomer);
router.patch("/members/:id/profile", ...adminPermissionGuard("mlm:adjust"), updateMemberProfile);
router.post("/members/:id/deactivate", ...adminPermissionGuard("mlm:approve"), deactivateMember);

router.get("/withdrawals", ...adminPermissionGuard("mlm:view"), listAdminWithdrawals);
router.post("/withdrawals/:id/approve", ...adminPermissionGuard("mlm:approve"), approveWithdrawal);
router.post("/withdrawals/:id/reject", ...adminPermissionGuard("mlm:reject"), rejectWithdrawal);

router.get("/joining-reviews", ...adminPermissionGuard("mlm:view"), listJoiningReviews);
router.post("/joining-reviews/:id/approve", ...adminPermissionGuard("mlm:approve"), approveJoiningReview);
router.post("/joining-reviews/:id/reject", ...adminPermissionGuard("mlm:reject"), rejectJoiningReview);

router.get("/upgrade-reviews", ...adminPermissionGuard("mlm:view"), listUpgradeReviews);
router.post("/upgrade-reviews/:id/approve", ...adminPermissionGuard("mlm:approve"), approveUpgradeReview);
router.post("/upgrade-reviews/:id/reject", ...adminPermissionGuard("mlm:reject"), rejectUpgradeReview);

router.get("/settings", ...adminPermissionGuard("mlm:settings"), getMlmSettings);
router.put("/settings", ...adminPermissionGuard("mlm:settings"), updateMlmSettings);

router.get("/maintenance/jobs", ...adminPermissionGuard("mlm:maintenance"), listMlmMaintenanceJobs);
router.post("/maintenance/jobs/:jobId/run", ...adminPermissionGuard("mlm:maintenance"), runMlmMaintenanceJob);

router.get("/milestone-rules", ...adminPermissionGuard("mlm:settings"), listMilestoneRules);
router.post("/milestone-rules", ...adminPermissionGuard("mlm:settings"), createMilestoneRule);
router.put("/milestone-rules/:id", ...adminPermissionGuard("mlm:settings"), updateMilestoneRule);
router.delete("/milestone-rules/:id", ...adminPermissionGuard("mlm:settings"), deleteMilestoneRule);

router.get("/payout-reports", ...adminPermissionGuard("mlm:payout"), listMlmPayoutReports);
router.get("/payout-reports/:date/export", ...adminPermissionGuard("mlm:payout"), exportMlmPayoutReport);
router.get("/payout-reports/:date", ...adminPermissionGuard("mlm:payout"), getMlmPayoutReport);
router.post("/payout-reports/:date/generate", ...adminPermissionGuard("mlm:payout"), generateMlmPayoutReport);
router.delete("/payout-reports/:date", ...adminPermissionGuard("mlm:payout"), deleteMlmPayoutReport);
router.patch(
  "/payout-reports/:date/line-items/:lineItemId",
  ...adminPermissionGuard("mlm:payout"),
  patchMlmPayoutReportLineItem,
);
router.post(
  "/payout-reports/:date/line-items/:lineItemId/apply-correction",
  ...adminPermissionGuard("mlm:payout"),
  applyMlmPayoutReportCorrection,
);
router.post("/payout-reports/:date/finalize", ...adminPermissionGuard("mlm:payout"), finalizeMlmPayoutReport);

export default router;

import express from "express";
import {
  addChildMember,
  adjustMemberWallet,
  approveJoiningReview,
  approveMlmMember,
  approveWithdrawal,
  createMilestoneRule,
  deleteMilestoneRule,
  getMlmDashboard,
  getMlmMemberDetail,
  getMlmMemberDownlineTree,
  getMlmSettings,
  issueImpersonationToken,
  listAdminWithdrawals,
  listJoiningReviews,
  listMilestoneRules,
  listMlmMembers,
  rejectJoiningReview,
  rejectWithdrawal,
  updateMilestoneRule,
  updateMlmSettings,
  verifyMemberWalletEndpoint,
} from "../controller/admin/mlmAdminController.js";
import { allowRoles, verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();
const adminGuard = [verifyToken, allowRoles("admin")];

router.get("/dashboard", ...adminGuard, getMlmDashboard);
router.get("/members", ...adminGuard, listMlmMembers);
router.get("/members/:id", ...adminGuard, getMlmMemberDetail);
router.get("/members/:id/downline", ...adminGuard, getMlmMemberDownlineTree);
router.post("/members/:id/adjust-wallet", ...adminGuard, adjustMemberWallet);
router.get("/members/:id/wallet-verification", ...adminGuard, verifyMemberWalletEndpoint);

// Phase 7 (PO-request): admin-initiated "approve without payment".
// Flips a REGISTERED_UNPAID member to ACTIVE / Plan A. Idempotent.
router.post("/members/:id/approve", ...adminGuard, approveMlmMember);

// Genealogy redesign — admin places a brand-new member into a
// specific empty L/R slot directly under the parent identified by
// `:id`. Mirrors the customer endpoint at
// `POST /api/customer/mlm/genealogy/add-member` but bypasses the
// downline-ownership check (admins can place anywhere).
router.post("/members/:id/add-child", ...adminGuard, addChildMember);

// Admin support tool (PO-request Jun 2026): mint a short-lived
// customer JWT so the admin can open a new tab pre-authenticated
// as this member. See controller for the audit / security notes.
router.post(
  "/members/:id/impersonation-token",
  ...adminGuard,
  issueImpersonationToken,
);

router.get("/withdrawals", ...adminGuard, listAdminWithdrawals);
router.post("/withdrawals/:id/approve", ...adminGuard, approveWithdrawal);
router.post("/withdrawals/:id/reject", ...adminGuard, rejectWithdrawal);

router.get("/joining-reviews", ...adminGuard, listJoiningReviews);
router.post(
  "/joining-reviews/:id/approve",
  ...adminGuard,
  approveJoiningReview,
);
router.post("/joining-reviews/:id/reject", ...adminGuard, rejectJoiningReview);

router.get("/settings", ...adminGuard, getMlmSettings);
router.put("/settings", ...adminGuard, updateMlmSettings);

router.get("/milestone-rules", ...adminGuard, listMilestoneRules);
router.post("/milestone-rules", ...adminGuard, createMilestoneRule);
router.put("/milestone-rules/:id", ...adminGuard, updateMilestoneRule);
router.delete("/milestone-rules/:id", ...adminGuard, deleteMilestoneRule);

export default router;

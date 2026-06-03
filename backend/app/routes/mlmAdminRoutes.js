import express from "express";
import {
  adjustMemberWallet,
  approveJoiningReview,
  approveWithdrawal,
  createMilestoneRule,
  deleteMilestoneRule,
  getMlmDashboard,
  getMlmMemberDetail,
  getMlmMemberDownlineTree,
  getMlmSettings,
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

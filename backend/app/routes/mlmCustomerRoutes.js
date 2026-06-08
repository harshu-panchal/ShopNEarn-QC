import express from "express";
import {
  addMemberAtSlot,
  cancelMyWithdrawal,
  claimHomeShopping,
  getDashboardOverview,
  getEarningsHistory,
  getEarningsSummary,
  getJoiningPayment,
  getMyBinaryGenealogy,
  getMyDirectReferrals,
  getMyDirectSponsor,
  getMyGenealogyTree,
  getMyMatchingReport,
  getMyMembership,
  getMyReferralCode,
  getMyTreeLayout,
  getMyUpline,
  getMyWalletHistory,
  initiateJoin,
  listMyWithdrawals,
  requestWithdrawal,
  submitJoiningProof,
  updateMyTreeLayout,
} from "../controller/mlmCustomerController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

/**
 * Customer-facing MLM endpoints. All routes require a verified customer
 * token. Membership-status checks happen inside each controller — most
 * GETs are open to all logged-in customers (so the dashboard can show
 * "you're not a member yet, here's the joining package"), while
 * `POST /withdrawals` etc. require an active MLM membership.
 */
const router = express.Router();

router.get("/membership", verifyToken, getMyMembership);
router.get("/referral-code", verifyToken, getMyReferralCode);
router.get("/direct-referrals", verifyToken, getMyDirectReferrals);
router.get("/upline", verifyToken, getMyUpline);
router.get("/earnings-summary", verifyToken, getEarningsSummary);
router.get("/earnings-history", verifyToken, getEarningsHistory);

// Customer-MLM-rebuild Phase 5 — Main dashboard one-shot payload.
router.get("/dashboard-overview", verifyToken, getDashboardOverview);

// Customer-MLM-rebuild Phase 5 — Genealogy section: Tree View,
// Binary Genealogy, Matching Report, Direct Sponsor, Tree Layout.
router.get("/genealogy/tree", verifyToken, getMyGenealogyTree);
router.get("/genealogy/binary", verifyToken, getMyBinaryGenealogy);
router.get("/genealogy/matching-report", verifyToken, getMyMatchingReport);
router.get("/genealogy/direct-sponsor", verifyToken, getMyDirectSponsor);
router.get("/genealogy/tree-layout", verifyToken, getMyTreeLayout);
router.put("/genealogy/tree-layout", verifyToken, updateMyTreeLayout);

// Redesigned Genealogy page — actor places a brand-new member into
// a specific empty L/R slot under a filled parent that sits in
// their downline (or is themselves). OTP is skipped; the new row
// lands `isVerified=true, status=REGISTERED_UNPAID`.
router.post("/genealogy/add-member", verifyToken, addMemberAtSlot);

// Customer-MLM-rebuild Phase 5 — Payouts section: My Earnings
// reuses /earnings-summary + /earnings-history; My Payout reuses
// /withdrawals. Wallet History is the new unified LedgerEntry feed.
router.get("/payouts/wallet-history", verifyToken, getMyWalletHistory);

router.post("/withdrawals", verifyToken, requestWithdrawal);
router.get("/withdrawals", verifyToken, listMyWithdrawals);
router.patch("/withdrawals/:id/cancel", verifyToken, cancelMyWithdrawal);

router.post("/home-shopping/claim", verifyToken, claimHomeShopping);

router.post("/join/initiate", verifyToken, initiateJoin);
router.post("/join/submit-proof", verifyToken, submitJoiningProof);
router.get("/join/payment/:paymentId", verifyToken, getJoiningPayment);

export default router;

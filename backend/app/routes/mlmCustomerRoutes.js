import express from "express";
import {
  cancelMyWithdrawal,
  claimHomeShopping,
  getEarningsHistory,
  getEarningsSummary,
  getMyDirectReferrals,
  getMyMembership,
  getMyReferralCode,
  getMyUpline,
  initiateJoin,
  listMyWithdrawals,
  requestWithdrawal,
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

router.post("/withdrawals", verifyToken, requestWithdrawal);
router.get("/withdrawals", verifyToken, listMyWithdrawals);
router.patch("/withdrawals/:id/cancel", verifyToken, cancelMyWithdrawal);

router.post("/home-shopping/claim", verifyToken, claimHomeShopping);

router.post("/join/initiate", verifyToken, initiateJoin);

export default router;

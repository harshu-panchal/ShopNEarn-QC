import logger from "../services/logger.js";
import MlmMembership from "../models/mlmMembership.js";
import Wallet from "../models/wallet.js";
import LedgerEntry from "../models/ledgerEntry.js";
import { OWNER_TYPE } from "../constants/finance.js";
import { roundCurrency } from "../utils/money.js";

/**
 * MLM Wallet ↔ Ledger Verifier Job (Phase 5 - observability).
 *
 * For every active MLM member:
 *   - Loads their customer Wallet.
 *   - Re-computes expected balance from the ledger journal:
 *       expectedCredited = Σ(amount of CREDIT entries for walletId)
 *       expectedDebited  = Σ(amount of DEBIT  entries for walletId)
 *       expectedNet      = expectedCredited - expectedDebited
 *       actualNet        = shopping + earnings + pending + available
 *   - If |expectedNet - actualNet| > tolerance (default ₹0.01) the
 *     wallet is reported as a drift event. We do NOT auto-correct;
 *     reconciliation is a human decision (the admin "MLM Compensation"
 *     tool below is the only sanctioned write surface).
 *
 * Default cadence: daily at 03:00 IST. Off by default — flip
 *   `ENABLE_MLM_WALLET_LEDGER_VERIFIER_JOB=true` to enable.
 *
 * Pure read-only job. Writes only structured log lines so the SRE
 * pipeline can alert on `metric=mlm_wallet_drift count>0`.
 */

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const DRIFT_TOLERANCE_INR = 0.01;
const BATCH_SIZE = 100;

const isVerifierEnabled = () =>
  String(process.env.ENABLE_MLM_WALLET_LEDGER_VERIFIER_JOB || "false").toLowerCase() === "true";

const getVerifierInterval = () =>
  parseInt(process.env.MLM_WALLET_LEDGER_VERIFIER_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10);

async function aggregateLedgerForWallet(walletId) {
  const rows = await LedgerEntry.aggregate([
    { $match: { walletId } },
    {
      $group: {
        _id: "$direction",
        total: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
  ]);
  const totals = { CREDIT: 0, DEBIT: 0, creditCount: 0, debitCount: 0 };
  for (const row of rows) {
    if (row._id === "CREDIT") {
      totals.CREDIT = row.total || 0;
      totals.creditCount = row.count || 0;
    } else if (row._id === "DEBIT") {
      totals.DEBIT = row.total || 0;
      totals.debitCount = row.count || 0;
    }
  }
  return totals;
}

async function verifyOneMember(membership) {
  const wallet = await Wallet.findOne(
    { ownerType: OWNER_TYPE.CUSTOMER, ownerId: membership.userId },
  ).lean();
  if (!wallet) return null;

  const actualNet = roundCurrency(
    (wallet.shoppingBalance || 0)
    + (wallet.earningsBalance || 0)
    + (wallet.pendingBalance || 0)
    + (wallet.availableBalance || 0),
  );

  const ledger = await aggregateLedgerForWallet(wallet._id);
  const expectedNet = roundCurrency((ledger.CREDIT || 0) - (ledger.DEBIT || 0));

  const drift = roundCurrency(actualNet - expectedNet);
  const totalCreditedDrift = roundCurrency((wallet.totalCredited || 0) - ledger.CREDIT);
  const totalDebitedDrift = roundCurrency((wallet.totalDebited || 0) - ledger.DEBIT);

  return {
    membershipId: String(membership._id),
    userId: String(membership.userId),
    walletId: String(wallet._id),
    actualNet,
    expectedNet,
    drift,
    totalCreditedDrift,
    totalDebitedDrift,
    breakdown: {
      shopping: wallet.shoppingBalance || 0,
      earnings: wallet.earningsBalance || 0,
      pending: wallet.pendingBalance || 0,
      available: wallet.availableBalance || 0,
    },
    ledger: {
      credit: ledger.CREDIT,
      debit: ledger.DEBIT,
      creditEntries: ledger.creditCount,
      debitEntries: ledger.debitCount,
    },
  };
}

const mlmWalletLedgerVerifierHandler = async () => {
  const startTime = Date.now();
  try {
    let scanned = 0;
    let drifts = 0;
    let totalDriftAbs = 0;
    let lastId = null;

    while (true) {
      const query = lastId ? { _id: { $gt: lastId } } : {};
      const batch = await MlmMembership.find(query)
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .select({ _id: 1, userId: 1 })
        .lean();
      if (!batch.length) break;

      for (const m of batch) {
        const result = await verifyOneMember(m);
        scanned += 1;
        if (!result) continue;
        if (Math.abs(result.drift) > DRIFT_TOLERANCE_INR) {
          drifts += 1;
          totalDriftAbs += Math.abs(result.drift);
          logger.warn("MLM wallet ledger drift detected", {
            jobName: "mlmWalletLedgerVerifierJob",
            metric: "mlm_wallet_drift",
            ...result,
          });
        }
      }
      lastId = batch[batch.length - 1]._id;
      if (batch.length < BATCH_SIZE) break;
    }

    const duration = Date.now() - startTime;
    logger.info("MLM wallet ledger verifier completed", {
      jobName: "mlmWalletLedgerVerifierJob",
      duration,
      scanned,
      drifts,
      totalDriftAbs: roundCurrency(totalDriftAbs),
    });
  } catch (err) {
    const duration = Date.now() - startTime;
    logger.error("MLM wallet ledger verifier failed", {
      jobName: "mlmWalletLedgerVerifierJob",
      duration,
      error: err.message,
      stack: err.stack,
    });
  }
};

/**
 * One-off on-demand check for a single member. Re-uses the same
 * computation so admin UIs can display the drift status.
 */
export async function verifyMlmMemberWallet(userId) {
  const membership = await MlmMembership.findOne({ userId })
    .select({ _id: 1, userId: 1 })
    .lean();
  if (!membership) return null;
  return verifyOneMember(membership);
}

export const getMlmWalletLedgerVerifierJobHandler = () => mlmWalletLedgerVerifierHandler;
export const getMlmWalletLedgerVerifierJobIntervalMs = () => getVerifierInterval();
export const isMlmWalletLedgerVerifierJobEnabled = () => isVerifierEnabled();

export default mlmWalletLedgerVerifierHandler;

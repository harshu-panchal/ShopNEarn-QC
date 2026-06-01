/**
 * Wallet ↔ Ledger drift verifier (Phase 2 ticket P2-9).
 *
 * Read-only sampling job. For every recently-mutated wallet it sums the
 * CREDIT / DEBIT ledger rows for that owner and compares the net to the
 * canonical wallet balance. Any drift larger than `FINANCE_VERIFIER_TOLERANCE`
 * (default ₹0.01) is logged as a structured warning so ops can investigate.
 *
 * Disabled by default. Enable per env via:
 *   FINANCE_VERIFIER_ENABLED=true
 *   FINANCE_VERIFIER_INTERVAL_MS=3600000   (default = 1h)
 *   FINANCE_VERIFIER_SAMPLE_SIZE=100       (default = 100 wallets/cycle)
 *   FINANCE_VERIFIER_TOLERANCE=0.01        (default = ₹0.01)
 *
 * This job NEVER mutates wallets or ledger entries. It only observes
 * and reports — the heal path is human-in-the-loop by design.
 */

import Wallet from "../models/wallet.js";
import LedgerEntry from "../models/ledgerEntry.js";
import { LEDGER_DIRECTION } from "../constants/finance.js";
import logger from "../services/logger.js";
import { roundCurrency } from "../utils/money.js";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_SAMPLE_SIZE = 100;
const DEFAULT_TOLERANCE = 0.01;

function getIntervalMs() {
  return parseInt(
    process.env.FINANCE_VERIFIER_INTERVAL_MS || String(DEFAULT_INTERVAL_MS),
    10,
  );
}

function getSampleSize() {
  return Math.max(
    1,
    parseInt(
      process.env.FINANCE_VERIFIER_SAMPLE_SIZE || String(DEFAULT_SAMPLE_SIZE),
      10,
    ),
  );
}

function getTolerance() {
  const raw = parseFloat(
    process.env.FINANCE_VERIFIER_TOLERANCE || String(DEFAULT_TOLERANCE),
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TOLERANCE;
}

async function verifyOneWallet(wallet, tolerance) {
  const ownerId = wallet.ownerId || null;
  // Match the same `null`-collapses-to-null convention used by
  // walletService.normalizeOwnerId(): admin wallets store ownerId=null.
  const ownerMatch = ownerId
    ? { actorType: wallet.ownerType, actorId: ownerId }
    : { actorType: wallet.ownerType, actorId: null };

  // Net = total CREDIT − total DEBIT against this owner across all
  // ledger rows. We intentionally ignore status=FAILED rows.
  const [agg] = await LedgerEntry.aggregate([
    {
      $match: {
        ...ownerMatch,
        status: { $ne: "FAILED" },
      },
    },
    {
      $group: {
        _id: null,
        credit: {
          $sum: {
            $cond: [
              { $eq: ["$direction", LEDGER_DIRECTION.CREDIT] },
              "$amount",
              0,
            ],
          },
        },
        debit: {
          $sum: {
            $cond: [
              { $eq: ["$direction", LEDGER_DIRECTION.DEBIT] },
              "$amount",
              0,
            ],
          },
        },
      },
    },
  ]);

  const credit = roundCurrency(agg?.credit || 0);
  const debit = roundCurrency(agg?.debit || 0);
  const ledgerNet = roundCurrency(credit - debit);

  // Canonical wallet "money owed" view: available + pending. cashInHand
  // is not part of the ledger total because the rider physically holds
  // it — it is tracked by separate cash-settlement rows.
  const walletNet = roundCurrency(
    (wallet.availableBalance || 0) + (wallet.pendingBalance || 0),
  );

  const drift = roundCurrency(walletNet - ledgerNet);
  if (Math.abs(drift) > tolerance) {
    logger.warn("walletLedgerVerifier: drift detected", {
      jobName: "walletLedgerVerifierJob",
      walletId: wallet._id?.toString?.(),
      ownerType: wallet.ownerType,
      ownerId: ownerId?.toString?.() ?? null,
      walletNet,
      ledgerNet,
      drift,
      tolerance,
    });
    return { drifted: true, drift };
  }
  return { drifted: false, drift };
}

const walletLedgerVerifierHandler = async () => {
  const startedAt = Date.now();
  const tolerance = getTolerance();
  const sampleSize = getSampleSize();

  try {
    // Most-recently-modified wallets first. We rely on Mongoose's auto
    // `updatedAt` index added by `{ timestamps: true }`.
    const wallets = await Wallet.find({})
      .sort({ updatedAt: -1 })
      .limit(sampleSize)
      .lean();

    let drifted = 0;
    let checked = 0;
    let maxDrift = 0;
    for (const wallet of wallets) {
      checked += 1;
      try {
        const result = await verifyOneWallet(wallet, tolerance);
        if (result.drifted) {
          drifted += 1;
          if (Math.abs(result.drift) > Math.abs(maxDrift)) {
            maxDrift = result.drift;
          }
        }
      } catch (innerError) {
        logger.error("walletLedgerVerifier: wallet check failed", {
          jobName: "walletLedgerVerifierJob",
          walletId: wallet?._id?.toString?.(),
          error: innerError.message,
        });
      }
    }

    logger.info("walletLedgerVerifier cycle complete", {
      jobName: "walletLedgerVerifierJob",
      duration: Date.now() - startedAt,
      checked,
      drifted,
      maxDrift,
      tolerance,
    });
  } catch (error) {
    logger.error("walletLedgerVerifier cycle failed", {
      jobName: "walletLedgerVerifierJob",
      duration: Date.now() - startedAt,
      error: error.message,
      stack: error.stack,
    });
  }
};

export const getWalletLedgerVerifierHandler = () => walletLedgerVerifierHandler;
export const getWalletLedgerVerifierInterval = () => getIntervalMs();
export const isWalletLedgerVerifierEnabled = () =>
  String(process.env.FINANCE_VERIFIER_ENABLED || "false").toLowerCase() ===
  "true";

export default walletLedgerVerifierHandler;

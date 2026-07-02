/**
 * backfill-mlm-earnings-earned-dates.js
 *
 * Rewrites commission-event and paired ledger createdAt timestamps to the
 * real eligibility time (downline Plan A activation replay), without
 * changing wallet balances.
 *
 * Usage:
 *   node scripts/backfill-mlm-earnings-earned-dates.js
 *   node scripts/backfill-mlm-earnings-earned-dates.js --apply
 *   node scripts/backfill-mlm-earnings-earned-dates.js --apply --code SEUHTFTX5K
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import {
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
} from "../app/constants/mlm.js";
import {
  buildEarnedAtLookups,
  resolveEarnedAtForCommissionEvent,
} from "../app/services/mlm/mlmEarningsDisplayService.js";
import { resolvePerActivationActivatedUserId } from "../app/services/mlm/mlmSignupBonusService.js";
import { lookupMembershipTimelineByUserIds } from "../app/utils/mlmMemberJoinedAt.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");
const codeArg = process.argv.find((arg) => arg.startsWith("--code="));
const ONLY_CODE = codeArg ? codeArg.split("=")[1] : null;

function log(...args) {
  console.log("[backfill-mlm-earnings-earned-dates]", ...args);
}

function sameInstant(a, b, toleranceMs = 60_000) {
  if (!a || !b) return false;
  const aTime = new Date(a).getTime();
  const bTime = new Date(b).getTime();
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime)) return false;
  return Math.abs(aTime - bTime) <= toleranceMs;
}

async function backfillMember(membership, totals) {
  const userId = membership.userId;
  const code = membership.referralCode || String(userId);

  const events = await MlmCommissionEvent.find({
    recipientId: userId,
    status: {
      $in: [
        MLM_COMMISSION_EVENT_STATUS.CREDITED,
        MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
        MLM_COMMISSION_EVENT_STATUS.HELD_AWAITING_DOWNLINE_ACTIVATION,
      ],
    },
    walletBucket: { $in: ["earnings", "pending"] },
  }).lean();

  if (!events.length) return;

  const lookups = await buildEarnedAtLookups(membership);
  const activatedUserIds = events
    .map((row) => resolvePerActivationActivatedUserId(row))
    .filter(Boolean);
  const timelineByUserId = await lookupMembershipTimelineByUserIds(activatedUserIds);

  for (const event of events) {
    const earnedAt = resolveEarnedAtForCommissionEvent(
      event,
      lookups,
      timelineByUserId,
    );
    if (!earnedAt || sameInstant(earnedAt, event.createdAt)) {
      totals.unchanged += 1;
      continue;
    }

    totals.wouldUpdate += 1;
    if (VERBOSE) {
      log(
        `${code} ${event.bonusType} pair=${event.meta?.pairIndex || "-"} ${event.createdAt?.toISOString?.() || event.createdAt} -> ${new Date(earnedAt).toISOString()}`,
      );
    }

    if (!APPLY) continue;

    await MlmCommissionEvent.collection.updateOne(
      { _id: event._id },
      {
        $set: {
          createdAt: new Date(earnedAt),
          "meta.earnedAtBackfilledAt": new Date(),
          "meta.previousCreatedAt": event.createdAt,
        },
      },
    );

    if (event.ledgerEntryId) {
      await LedgerEntry.collection.updateOne(
        { _id: event.ledgerEntryId },
        { $set: { createdAt: new Date(earnedAt) } },
      );
      totals.ledgerUpdated += 1;
    }

    totals.updated += 1;
  }
}

async function main() {
  await connectDB();
  log(APPLY ? "APPLY mode" : "DRY-RUN");

  const query = ONLY_CODE ? { referralCode: ONLY_CODE } : {};
  const memberships = await MlmMembership.find({
    ...query,
    status: MLM_MEMBERSHIP_STATUS.ACTIVE,
  }).lean();

  const totals = {
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    unchanged: 0,
    ledgerUpdated: 0,
    errors: 0,
  };

  for (const membership of memberships) {
    totals.scanned += 1;
    try {
      await backfillMember(membership, totals);
    } catch (err) {
      totals.errors += 1;
      log(
        `ERROR ${membership.referralCode || membership.userId}: ${err.message}`,
      );
    }
  }

  log("Summary:", JSON.stringify(totals, null, 2));
  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  log("FATAL:", err.message);
  process.exit(1);
});

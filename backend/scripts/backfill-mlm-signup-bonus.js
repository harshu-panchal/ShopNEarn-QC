/**
 * backfill-mlm-signup-bonus.js
 *
 * Retroactively credits the new flat MLM signup bonus to every
 * existing MlmMembership that pre-dates the feature shipping in
 * Jun 2026. Two credits per processed row (per
 * `mlmSignupBonusService`):
 *
 *   - `signupBonusSelfAmount`     -> THIS member's `shopping` wallet
 *   - `signupBonusSponsorAmount`  -> sponsor's `shopping` wallet
 *
 * Per `idempotent-data-migration` skill, plus the
 * `wallet-ledger-atomicity` invariants enforced inside
 * `applyRegistrationBonusInSession`:
 *
 *   - DRY-RUN by default (no `--apply`). Reports {scanned,
 *     wouldCreditSelf, wouldCreditSponsor, alreadyCredited,
 *     skippedNoMembership, errors}. Touches no wallets.
 *   - `--apply` writes. Each membership processed inside its own
 *     transaction (via `applyRegistrationBonusStandalone`) so a
 *     single bad row never aborts the whole run.
 *   - Idempotency: the helper short-circuits when
 *     `membership.signupBonusCreditedAt` is set, AND
 *     `LedgerEntry.idempotencyKey` has a partial unique index so the
 *     DB rejects any duplicate ledger insert. Crash-restart is safe.
 *   - Cursor streaming — never loads every membership into memory.
 *   - Resumable: `--from-id <ObjectId>` resumes from a specific
 *     starting cursor position; combine with `--limit <N>` to chunk
 *     long runs.
 *   - Verbose audit trail per row when `--verbose` is supplied.
 *
 * Sponsor handling:
 *   - When the membership has no `sponsorId` (e.g. the bootstrap
 *     root member, or very old legacy rows that pre-date the
 *     mandatory-referral-code policy), the self-credit still fires
 *     and the sponsor-credit is silently skipped — exactly the same
 *     behaviour as the live signup hook.
 *   - When the sponsor's User row no longer exists (orphan
 *     reference), the wallet for that sponsor is still created via
 *     `getOrCreateWallet`, so the credit lands and remains
 *     reconcilable. We DO log this case so finance can chase up.
 *
 * Usage:
 *   node backend/scripts/backfill-mlm-signup-bonus.js                  # dry-run
 *   node backend/scripts/backfill-mlm-signup-bonus.js --apply          # write
 *   node backend/scripts/backfill-mlm-signup-bonus.js --apply --verbose
 *   node backend/scripts/backfill-mlm-signup-bonus.js --apply --limit 200
 *   node backend/scripts/backfill-mlm-signup-bonus.js --apply --from-id <ObjectId>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import MlmMembership from "../app/models/mlmMembership.js";
// The "User" Mongoose model is registered inside `customer.js` (the
// schema was renamed via the discriminator migration but the file
// path kept the legacy name). Importing it ensures `User.exists(...)`
// works against the same collection MlmMembership.sponsorId refs.
import User from "../app/models/customer.js";
import {
  applyRegistrationBonusStandalone,
} from "../app/services/mlm/mlmSignupBonusService.js";
import { getSignupBonusConfig } from "../app/services/mlm/mlmConfigService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const VERBOSE = process.argv.includes("--verbose");

function flagValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const LIMIT = (() => {
  const raw = flagValue("--limit");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
})();

const FROM_ID = (() => {
  const raw = flagValue("--from-id");
  if (!raw) return null;
  if (!mongoose.isValidObjectId(raw)) {
    throw new Error(`--from-id must be a valid ObjectId. Got: ${raw}`);
  }
  return raw;
})();

function tag(...args) {
  console.log("[backfill-mlm-signup-bonus]", ...args);
}

async function backfillOne(membership, totals) {
  // Fast-path: the membership flag is the cheapest "already done"
  // signal. The service's idempotency-key index is the backstop.
  if (membership.signupBonusCreditedAt) {
    totals.alreadyCredited += 1;
    if (VERBOSE) {
      tag(`SKIP ${String(membership.userId)} — already credited at ${membership.signupBonusCreditedAt.toISOString()}`);
    }
    return;
  }

  // Dry-run: report what we WOULD do, touch nothing.
  if (!APPLY) {
    totals.wouldCreditSelf += 1;
    if (membership.sponsorId) totals.wouldCreditSponsor += 1;
    else totals.noSponsor += 1;
    if (VERBOSE) {
      tag(
        `WOULD CREDIT ${String(membership.userId)} (sponsor=${
          membership.sponsorId ? String(membership.sponsorId) : "none"
        })`,
      );
    }
    return;
  }

  // Write path.
  try {
    const res = await applyRegistrationBonusStandalone({
      newCustomerId: membership.userId,
      newMembership: membership,
      sponsorUserId: membership.sponsorId || null,
      correlationId: `backfill-signup-bonus-${String(membership._id)}`,
    });

    if (res?.skipped === "DISABLED") {
      // Feature disabled in DB — abort the whole run; running a
      // backfill while disabled would be operator error.
      totals.disabledMidRun += 1;
      throw new Error(
        "Signup bonus is DISABLED in Setting.mlm — flip it on before backfilling.",
      );
    }
    if (res?.skipped === "ZERO_AMOUNT") {
      totals.zeroAmount += 1;
      return;
    }
    if (res?.skipped === "ALREADY_CREDITED") {
      // Race-condition: another runner credited this row between our
      // cursor read and the helper's flag check. Safe — counts as
      // alreadyCredited.
      totals.alreadyCredited += 1;
      return;
    }

    if (res?.selfCredit) totals.creditedSelf += 1;
    if (res?.sponsorCredit) totals.creditedSponsor += 1;
    if (!membership.sponsorId) totals.noSponsor += 1;

    if (VERBOSE) {
      tag(
        `OK ${String(membership.userId)} — self=${res?.selfCredit?.amount ?? 0} sponsor=${
          res?.sponsorCredit?.amount ?? 0
        }`,
      );
    }
  } catch (err) {
    totals.errors += 1;
    tag(
      `ERROR membership=${String(membership._id)} user=${String(
        membership.userId,
      )}: ${err.message}`,
    );
    if (err.message?.includes("DISABLED in Setting.mlm")) {
      // Propagate the abort.
      throw err;
    }
  }
}

async function main() {
  await connectDB();
  tag(APPLY ? "APPLY mode (writes will happen)" : "DRY-RUN mode (no writes)");

  // Sanity check: don't even start if the feature flag is off — a
  // dry-run is harmless but an apply would corrupt the wallet+ledger
  // by writing rows the live hook would NEVER write. Force the
  // operator to flip the flag first.
  const cfg = await getSignupBonusConfig();
  tag(
    `Signup bonus config: enabled=${cfg.enabled} selfAmount=₹${cfg.selfAmount} sponsorAmount=₹${cfg.sponsorAmount}`,
  );
  if (!cfg.enabled) {
    tag(
      "Signup bonus is DISABLED in Setting.mlm. Flip `mlm.signupBonusEnabled = true` before running with --apply.",
    );
    if (APPLY) {
      await mongoose.connection.close();
      process.exit(1);
    }
    // For dry-run we keep going so the operator can preview the
    // backfill scope, but every row will be a no-op at write time.
    tag("(continuing dry-run for scope estimate only)");
  }
  if (cfg.selfAmount <= 0 && cfg.sponsorAmount <= 0) {
    tag("Both amounts are 0 — nothing to credit. Exiting.");
    await mongoose.connection.close();
    process.exit(0);
  }

  const totals = {
    scanned: 0,
    alreadyCredited: 0,
    creditedSelf: 0,
    creditedSponsor: 0,
    wouldCreditSelf: 0,
    wouldCreditSponsor: 0,
    noSponsor: 0,
    zeroAmount: 0,
    disabledMidRun: 0,
    errors: 0,
    sponsorMissingUser: 0,
  };

  // Deterministic order by _id. Cursor streaming avoids loading
  // every membership into memory at once. Soft-deleted rows are
  // automatically excluded by the `pre('find')` hook on the model.
  const filter = FROM_ID ? { _id: { $gte: FROM_ID } } : {};
  const cursor = MlmMembership.find(filter, {
    userId: 1,
    sponsorId: 1,
    signupBonusCreditedAt: 1,
  })
    .sort({ _id: 1 })
    .cursor();

  for await (const m of cursor) {
    totals.scanned += 1;
    if (LIMIT && totals.scanned > LIMIT) {
      tag(`Hit --limit ${LIMIT}; stopping.`);
      break;
    }

    // Pre-check: does the sponsor still have a User row? Surfaced
    // as an info log only — the credit still fires because the
    // wallet layer materialises on demand.
    if (APPLY && m.sponsorId) {
      const sponsorExists = await User.exists({ _id: m.sponsorId });
      if (!sponsorExists) {
        totals.sponsorMissingUser += 1;
        tag(
          `INFO sponsor User missing for membership ${String(m._id)} (sponsorId=${String(
            m.sponsorId,
          )}) — credit will still land on the orphan wallet.`,
        );
      }
    }

    try {
      // Re-load the full doc inside the apply path so the helper has
      // a Mongoose-managed instance it can `.save()` after stamping
      // `signupBonusCreditedAt`.
      const membershipDoc = APPLY
        ? await MlmMembership.findById(m._id)
        : m;
      await backfillOne(membershipDoc, totals);
    } catch (err) {
      if (err.message?.includes("DISABLED in Setting.mlm")) {
        tag("Aborting run — signup bonus disabled mid-flight.");
        break;
      }
      tag(`UNCAUGHT while processing ${String(m._id)}: ${err.message}`);
      totals.errors += 1;
    }
  }

  tag("Summary:", JSON.stringify(totals, null, 2));
  if (!APPLY) {
    tag(
      "Dry-run only — re-run with `--apply` to actually credit wallets.",
    );
  }

  await mongoose.connection.close();
  process.exit(totals.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  tag("FATAL", err?.stack || err?.message || err);
  process.exit(1);
});

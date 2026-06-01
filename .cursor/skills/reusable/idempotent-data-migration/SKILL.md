---
name: idempotent-data-migration
description: Write Mongoose data migration scripts that are idempotent (safe to re-run), resumable (can crash and continue), and observable (dry-run + progress + summary). Every migration has a forward function, an inverse where reasonable, and a checksum step that re-verifies the invariant after the write. Use when backfilling discriminator values, creating Wallet rows from User.walletBalance, generating LedgerEntry from legacy Transaction, dropping orphan indexes, or any large-scale data fix that the user mentions ("migration script", "backfill", "data fix", "rewrite all rows").
---

# Idempotent Data Migration

## Purpose

Production data migrations have three failure modes:

1. **Re-run damage** — running the script twice doubles the effect.
2. **Crash mid-flight** — process dies after rewriting half the rows; restart picks up where it left off, ideally without re-doing the first half.
3. **Silent partial failure** — some rows fail validation but the script reports success.

This skill defines a script template that prevents all three. Every migration in this codebase follows this shape.

## When To Use

- The user mentions "migration", "backfill", "data fix", "rewrite all rows", "data cleanup"
- A schema change requires preparing data before deploy
- A discriminator value renames (`Customer` → `User`)
- A new collection needs to be backfilled from an old one (`LedgerEntry` from `Transaction`)
- Dropping dead indexes from production
- During Phase 3 (index hygiene) and Phases 4-7 of `database_audit_plan_part3.md`

## File Layout

```
backend/scripts/
├── README.md                           # one paragraph + run instructions for each script
├── migrate-customer-to-user-discriminator.js
├── backfill-wallet-from-user-walletbalance.js
├── backfill-ledger-from-transactions.js
├── drop-dead-indexes.js
└── _runner.js                          # shared bootstrapping (db connect, logging, dry-run plumbing)
```

Every script:

- Is invoked from CLI with `node scripts/<name>.js [--dry-run] [--limit N] [--from-id ID]`
- Imports through `_runner.js` to share connection bootstrapping
- Writes a structured log with a `migrationId`, `batchIndex`, `processed`, `modified` shape
- Reports a final JSON summary and exits with code 0 on success / non-zero on any failure

## The Canonical Script Template

```js
// scripts/_runner.js
import mongoose from 'mongoose';
import { logger } from '../app/services/loggerService.js';

export async function runMigration({ name, run }) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limit  = numFlag(args, '--limit');
  const fromId = strFlag(args, '--from-id');
  const migrationId = `${name}-${Date.now()}`;
  const start = Date.now();

  await mongoose.connect(process.env.MONGO_URI);
  logger.info('migration.start', { migrationId, name, dryRun, limit, fromId });

  let summary;
  try {
    summary = await run({ migrationId, dryRun, limit, fromId, logger });
    logger.info('migration.done', { migrationId, ...summary, elapsedMs: Date.now() - start });
  } catch (err) {
    logger.error('migration.failed', { migrationId, err: err.message, stack: err.stack });
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
  return summary;
}

const numFlag = (args, key) => {
  const i = args.indexOf(key);
  return i >= 0 ? Number(args[i + 1]) : null;
};
const strFlag = (args, key) => {
  const i = args.indexOf(key);
  return i >= 0 ? args[i + 1] : null;
};
```

```js
// scripts/migrate-customer-to-user-discriminator.js
import mongoose from 'mongoose';
import { runMigration } from './_runner.js';

const REWRITES = [
  { coll: 'notifications',  field: 'recipientModel',  from: 'Customer', to: 'User'     },
  { coll: 'mediametadatas', field: 'uploadedByModel', from: 'Customer', to: 'User'     },
  { coll: 'tickets',        field: 'userType',        from: 'Customer', to: 'User'     },
  { coll: 'tickets',        field: 'userType',        from: 'Rider',    to: 'Delivery' },
  { coll: 'otpsessions',    field: 'userType',        from: 'Customer', to: 'User'     },
];

runMigration({
  name: 'migrate-customer-to-user-discriminator',
  run: async ({ dryRun, logger }) => {
    const db = mongoose.connection.db;
    const stats = { processed: 0, modified: 0, byRewrite: [] };

    for (const r of REWRITES) {
      const filter = { [r.field]: r.from };
      const count = await db.collection(r.coll).countDocuments(filter);
      stats.processed += count;

      let modified = 0;
      if (!dryRun && count > 0) {
        const res = await db.collection(r.coll).updateMany(filter, { $set: { [r.field]: r.to } });
        modified = res.modifiedCount;
        stats.modified += modified;
      }
      stats.byRewrite.push({ ...r, planned: count, modified });
      logger.info('migration.batch', { ...r, planned: count, modified, dryRun });
    }

    // Verify
    for (const r of REWRITES) {
      const residue = await db.collection(r.coll).countDocuments({ [r.field]: r.from });
      if (residue > 0 && !dryRun) {
        throw new Error(`Residue: ${r.coll}.${r.field} still has ${residue} '${r.from}' rows`);
      }
    }

    return stats;
  },
});
```

Invocation:

```bash
# Dry-run (no writes)
node scripts/migrate-customer-to-user-discriminator.js --dry-run

# Real run
node scripts/migrate-customer-to-user-discriminator.js
```

## The Five Properties

| Property | How this template provides it |
|---|---|
| **Idempotent** | Filter is the legacy value (`recipientModel: 'Customer'`). After the update, the same filter matches zero rows. Re-running is a no-op. |
| **Resumable** | The filter is stateless. A crash mid-batch leaves the unmigrated rows still matching the filter. Restart resumes naturally. |
| **Observable** | Per-batch logs, dry-run mode, structured summary, final verification step. |
| **Reversible (where possible)** | Pair each migration with an `unmigrate-*.js` that runs the reverse rewrite. For some migrations (e.g., dropping dead indexes), inverse is trivial; for others (e.g., generating LedgerEntry from Transaction), inverse is dropping the new rows. |
| **Batched for large collections** | Use `bulkWrite` or cursor with `limit` for collections > 100k rows (see "Batched writes" below). |

## Idempotency Patterns

### Filter-Based (preferred)

The script's filter matches only "not yet migrated" rows. Re-runs match nothing.

```js
// Match rows that haven't been migrated
await coll.updateMany(
  { recipientModel: 'Customer' },
  { $set: { recipientModel: 'User' } },
);
// Subsequent runs find zero rows with 'Customer' — safe re-run
```

### Marker-Based (when no natural filter exists)

Set a `migrationApplied: 'name-v1'` field on each row. Subsequent runs skip rows where this marker matches.

```js
await coll.updateMany(
  { migrationApplied: { $ne: 'backfill-wallet-v1' } },
  [
    { $set: { /* derive new fields from existing */ } },
    { $set: { migrationApplied: 'backfill-wallet-v1' } },
  ],
);
```

Use this only when the migration writes new fields without overwriting old ones.

### Unique-Index-Based (best for inserts)

For backfills that **insert** rows (e.g., create LedgerEntry from Transaction), rely on a unique index to reject duplicates:

```js
// scripts/backfill-ledger-from-transactions.js
for await (const tx of Transaction.find({}).cursor()) {
  try {
    await LedgerEntry.create({
      transactionId: tx._id,                       // unique index field
      actorType: ownerTypeFromUserModel(tx.userModel),
      actorId:   tx.user,
      amount:    tx.amount,
      // ... derived fields ...
      idempotencyKey: `legacy-transaction-${tx._id}`,
    });
  } catch (err) {
    if (err.code === 11000) continue;              // already inserted — skip
    throw err;
  }
}
```

Re-runs encounter the unique-violation and skip — exactly the right behavior.

## Batched Writes For Large Collections

Don't `updateMany` a million-row collection in one call. Even though MongoDB chunks it internally, you lose progress observability and ability to throttle.

```js
const BATCH_SIZE = 1000;
let lastId = null;
let total = 0;

while (true) {
  const filter = { recipientModel: 'Customer', ...(lastId ? { _id: { $gt: lastId } } : {}) };
  const batch  = await coll.find(filter).sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
  if (batch.length === 0) break;

  if (!dryRun) {
    const ids = batch.map((d) => d._id);
    const res = await coll.updateMany({ _id: { $in: ids } }, { $set: { recipientModel: 'User' } });
    total += res.modifiedCount;
  }

  lastId = batch[batch.length - 1]._id;
  logger.info('migration.batch', { batchSize: batch.length, total, lastId: String(lastId) });

  // Throttle to avoid CPU spike
  await new Promise((r) => setTimeout(r, 50));
}
```

Resumability bonus: pass `--from-id <ObjectId>` on restart to skip already-processed rows.

## Verification Step (mandatory)

Every migration ends with a verification:

```js
const residue = await coll.countDocuments({ recipientModel: 'Customer' });
if (residue > 0) {
  throw new Error(`Migration incomplete: ${residue} rows still have 'Customer'`);
}
```

For backfills:

```js
const sourceCount = await Transaction.countDocuments({});
const targetCount = await LedgerEntry.countDocuments({ transactionId: { $exists: true } });
if (targetCount < sourceCount * 0.999) {                          // allow some skip on bad rows
  throw new Error(`Backfill incomplete: ${sourceCount - targetCount} transactions not migrated`);
}
```

A migration without a verification step is not done.

## Running Order And Coordination

```
1. Run --dry-run on staging      →  inspect planned counts; investigate surprises
2. Run real on staging           →  verify post-conditions; smoke-test affected flows
3. Schedule production window    →  off-peak; coordinate with on-call
4. Run --dry-run on production   →  re-confirm counts haven't drifted
5. Run real on production        →  monitor; have rollback ready
6. Post-run verification         →  re-run script; modifiedCount should be 0
```

## Codebase-Specific Migration Catalog

| Script | Purpose | Audit-plan ref |
|---|---|---|
| `migrate-customer-to-user-discriminator.js` | Rewrite `Customer`/`Rider` discriminator values | Part 4 §M5-1 / Phase 5 P5-3 |
| `backfill-wallet-from-user-walletbalance.js` | Create `Wallet` rows for every customer with `walletBalance > 0` | Part 4 §M4-1 / Phase 4 P4-4 |
| `backfill-ledger-from-transactions.js` | Generate `LedgerEntry` rows from legacy `Transaction` rows | Part 4 §M4-2 / Phase 4 P4-5 |
| `drop-dead-indexes.js` | Drop indexes that reference non-existent fields/collections | Part 4 §M3-1 / Phase 3 P3-1 |
| `backfill-payout-beneficiary-model.js` | Derive `Payout.beneficiaryModel` from `payoutType` | Phase 5 P5-4 |
| `drop-deprecated-order-fields.js` | Final `$unset` of `payment.*`, `pricing.*`, `deliveryPartner` after Phase 7 soak | Phase 7 P7-1/2/3 |
| `archive-transaction-collection.js` | Rename `transactions` → `transactions_archive` after backfill verified | Phase 7 P7-5 |

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| `updateMany({}, { $set: { ... } })` with no filter | Hits every row; re-run doubles the effect on aggregations | Filter for "unmigrated" rows |
| No dry-run mode | Can't preview impact before damaging data | Always implement `--dry-run` first |
| No verification step | "Success" means nothing | Compute residue/coverage at the end; throw if non-zero |
| Skipping logging per batch | Lost progress on crash; reviewers can't diff runs | Log per batch with `migrationId` and `batchIndex` |
| Hard-coded connection string | Same script can't run staging → prod | Use `process.env.MONGO_URI` |
| `for ... of` over a non-cursor full result | OOM on > 100k rows | Use `.cursor()` or batched `find` |
| Modifying schema in the same PR as the migration | Old code crashes on the new field shape mid-deploy | Migration ships first, schema PR ships after |
| Catching all errors silently | Bad rows are skipped without a record | Collect into `failures` array, log summary, exit non-zero if any |
| No `--limit` / `--from-id` flags | Cannot test on a tiny slice | Always add throttling flags |
| Mixing reads and writes in the same transaction at scale | Long-running transaction aborts | Migrations run **outside** transactions — they are append-only or filter-based and naturally idempotent |
| Re-creating dropped indexes by re-running `databaseIndexManager.createAllIndexes()` after fixing it | Old indexes return | Fix the manager **before** running the drop script |

## Backward Compatibility

- Migrations themselves are deploy-neutral: they only change data.
- The **schema PR that consumes the migrated data** must ship **after** the migration completes.
- Until then, code reads from both old and new shapes (the sync hooks from `legacy-field-deprecation` skill handle this).

## Rollback

| Migration type | Rollback |
|---|---|
| Filter-based rewrite (e.g., `Customer` → `User`) | Re-run with reverse mapping (`User` → `Customer`) — but only if downstream code still tolerates it, which after enum-tightening it won't. Keep `mongodump` snapshot before running. |
| Insert backfill (e.g., LedgerEntry rows) | Delete inserted rows by their unique key (`transactionId: { $exists: true }` for the LedgerEntry backfill) |
| Index drop | Re-create the index via `databaseIndexManager` — instantaneous on small collections |
| `$unset` field drop | Cannot rollback data; restore from snapshot. Phase 7 ships only after 30-day soak. |

## Sequencing With The Audit Plan

| Audit-plan §/ticket | Script |
|---|---|
| Part 4 §M3-1 / Phase 3 P3-1 | `drop-dead-indexes.js` |
| Part 4 §M4-1 / Phase 4 P4-4 | `backfill-wallet-from-user-walletbalance.js` |
| Part 4 §M4-2 / Phase 4 P4-5 | `backfill-ledger-from-transactions.js` |
| Part 4 §M5-1 / Phase 5 P5-3 | `migrate-customer-to-user-discriminator.js` |
| Phase 5 P5-4 | `backfill-payout-beneficiary-model.js` |
| Phase 7 P7-1/2/3 | `drop-deprecated-order-fields.js` |
| Phase 7 P7-5/6 | `archive-transaction-collection.js`, `archive-otpverification-collection.js` |

## Related Skills

- `mongoose-ref-integrity` — context for the `Customer`→`User` migration
- `polymorphic-discriminator-discipline` — the schema side of discriminator backfills
- `legacy-field-deprecation` — the multi-phase pattern that drives most migrations
- `wallet-ledger-atomicity` — invariant the LedgerEntry backfill must preserve
- `safe-refactor-strategy` — pre/post-migration deploy choreography

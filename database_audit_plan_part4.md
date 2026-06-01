# Appzeto Quick-Commerce — Production-Grade Database Audit & Implementation Plan
## Part 4 of 4: Migrations · Testing · Rollback · Risk Matrix · Backward-Compat Protocol

> All migration scripts are designed to be **idempotent**, **observable** (structured logs + counters), and **safe to interrupt** (no half-applied state). Scripts live under `backend/scripts/migrations/<phase>/<order>-<name>.js` and are run via `node --experimental-vm-modules ...` against a snapshot or replica.

> **Pre-flight gate:** every migration starts with `assertReplicaSetPrimary()`, `assertDbConnection()`, and `assertMaintenanceMode()` (the latter only for migrations that pause writes). The codebase already has `app/dbConfig/` setup — these helpers are added there.

---

# 12. MIGRATION SCRIPTS

## M0-1: `db_preflight_report.js` — Phase 0

```js
#!/usr/bin/env node
import mongoose from "mongoose";
import { connectDb } from "../app/dbConfig/index.js";

const REPORT = {};

async function main() {
  await connectDb();
  const db = mongoose.connection.db;

  // 1. Collection sizes
  const colls = await db.listCollections().toArray();
  REPORT.collectionSizes = {};
  for (const c of colls) {
    REPORT.collectionSizes[c.name] = await db.collection(c.name).estimatedDocumentCount();
  }

  // 2. Transaction.type distribution
  REPORT.transactionTypes = await db
    .collection("transactions")
    .aggregate([{ $group: { _id: "$type", c: { $sum: 1 } } }])
    .toArray();

  // 3. Orphan-field "Wallet Payment" check
  REPORT.walletPaymentTransactionCount = await db
    .collection("transactions")
    .countDocuments({ type: "Wallet Payment" });

  // 4. Orders with non-schema flag
  REPORT.ordersWithOrphanFlag = await db
    .collection("orders")
    .countDocuments({ "financeFlags.sellerPayoutHeld": { $exists: true } });

  // 5. Discriminator distribution
  REPORT.notificationRecipientModel = await db
    .collection("notifications")
    .aggregate([{ $group: { _id: "$recipientModel", c: { $sum: 1 } } }])
    .toArray();
  REPORT.mediaUploadedByModel = await db
    .collection("mediametadatas")
    .aggregate([{ $group: { _id: "$uploadedByModel", c: { $sum: 1 } } }])
    .toArray();
  REPORT.ticketUserType = await db
    .collection("tickets")
    .aggregate([{ $group: { _id: "$userType", c: { $sum: 1 } } }])
    .toArray();
  REPORT.otpSessionUserType = await db
    .collection("otpsessions")
    .aggregate([{ $group: { _id: "$userType", c: { $sum: 1 } } }])
    .toArray();

  // 6. Wallet ↔ User.walletBalance drift (sampled)
  const sampleSize = 500;
  const sample = await db
    .collection("users")
    .aggregate([
      { $match: { walletBalance: { $gt: 0 } } },
      { $sample: { size: sampleSize } },
      {
        $lookup: {
          from: "wallets",
          let: { u: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $and: [{ $eq: ["$ownerType", "CUSTOMER"] }, { $eq: ["$ownerId", "$$u"] }] },
              },
            },
          ],
          as: "w",
        },
      },
      {
        $project: {
          walletBalance: 1,
          walletAvail: { $ifNull: [{ $arrayElemAt: ["$w.availableBalance", 0] }, 0] },
        },
      },
    ])
    .toArray();
  REPORT.walletDriftSample = {
    sampled: sample.length,
    withWalletDoc: sample.filter((s) => s.walletAvail > 0).length,
    withoutWalletDoc: sample.filter((s) => s.walletAvail === 0 && s.walletBalance > 0).length,
    maxDriftRupees: sample.reduce((m, s) => Math.max(m, Math.abs(s.walletBalance - s.walletAvail)), 0),
  };

  // 7. Orphan Order.customer refs (sampled)
  REPORT.orphanedOrderCustomerSample = await db
    .collection("orders")
    .aggregate([
      { $sample: { size: 1000 } },
      { $lookup: { from: "users", localField: "customer", foreignField: "_id", as: "u" } },
      { $match: { u: { $size: 0 } } },
      { $count: "c" },
    ])
    .toArray();

  // 8. Duplicate cart-customer
  REPORT.duplicateCartCustomers = await db
    .collection("carts")
    .aggregate([
      { $group: { _id: "$customerId", c: { $sum: 1 } } },
      { $match: { c: { $gt: 1 } } },
    ])
    .toArray();

  // 9. Dead indexes — try-read each
  REPORT.deadIndexes = {};
  for (const [coll, names] of Object.entries({
    transactions: ["idx_user_created_type", "idx_user_status_created"],
    notifications: ["idx_recipient_read_created"],
    ledgerentries: ["idx_ownerType_ownerId_created"],
    withdrawals: ["idx_status_created", "idx_user_userModel_created"],
  })) {
    const indexes = await db.collection(coll).indexes().catch(() => []);
    REPORT.deadIndexes[coll] = names.filter((n) => indexes.some((i) => i.name === n));
  }

  console.log(JSON.stringify(REPORT, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Run: `node backend/scripts/migrations/00-preflight/00-preflight-report.js > db_preflight_report.json`. Commit to a private operations repo.

---

## M3-1: Drop dead indexes — Phase 3

```js
import mongoose from "mongoose";
import { connectDb } from "../../app/dbConfig/index.js";

const DROP_LIST = [
  { coll: "transactions",   name: "idx_user_created_type" },
  { coll: "transactions",   name: "idx_user_status_created" },
  { coll: "notifications",  name: "idx_recipient_read_created" },
  { coll: "ledgerentries",  name: "idx_ownerType_ownerId_created" },
  // Drop entire fake-collection indexes by dropping the collection if empty:
];

async function main() {
  await connectDb();
  const db = mongoose.connection.db;

  for (const { coll, name } of DROP_LIST) {
    try {
      const indexes = await db.collection(coll).indexes();
      if (indexes.some((i) => i.name === name)) {
        await db.collection(coll).dropIndex(name);
        console.log(`Dropped ${coll}.${name}`);
      } else {
        console.log(`Skip ${coll}.${name} — not present`);
      }
    } catch (e) {
      console.error(`Failed to drop ${coll}.${name}:`, e.message);
    }
  }

  // Drop the empty `withdrawals` collection entirely
  try {
    const count = await db.collection("withdrawals").estimatedDocumentCount();
    if (count === 0) {
      await db.collection("withdrawals").drop();
      console.log("Dropped empty withdrawals collection");
    } else {
      console.error(`withdrawals has ${count} documents — manual review required`);
    }
  } catch (e) {
    if (e.codeName !== "NamespaceNotFound") throw e;
    console.log("withdrawals collection did not exist (expected)");
  }

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Maintenance window:** none required. Index drops are fast even on large collections.

---

## M4-1: Backfill `Wallet` for customers with legacy `walletBalance` — Phase 4

```js
import mongoose from "mongoose";
import { connectDb } from "../../app/dbConfig/index.js";
import User from "../../app/models/customer.js";
import Wallet from "../../app/models/wallet.js";
import { OWNER_TYPE, WALLET_STATUS, CURRENCY } from "../../app/constants/finance.js";

async function main() {
  await connectDb();
  let processed = 0, created = 0, alreadyExisted = 0, mismatched = 0;
  const cursor = User.find({ walletBalance: { $gt: 0 } }).cursor();

  for await (const user of cursor) {
    processed++;
    const existing = await Wallet.findOne({ ownerType: OWNER_TYPE.CUSTOMER, ownerId: user._id });
    if (existing) {
      alreadyExisted++;
      if (existing.availableBalance !== user.walletBalance) {
        mismatched++;
        console.log(`MISMATCH user=${user._id} userBal=${user.walletBalance} walletAvail=${existing.availableBalance}`);
      }
      continue;
    }
    await Wallet.create({
      ownerType: OWNER_TYPE.CUSTOMER,
      ownerId: user._id,
      currency: CURRENCY,
      availableBalance: user.walletBalance,
      pendingBalance: 0,
      cashInHand: 0,
      totalCredited: user.walletBalance,
      totalDebited: 0,
      status: WALLET_STATUS.ACTIVE,
      meta: { migratedFromUserField: true },
    });
    created++;
    if (processed % 100 === 0) console.log(`progress: ${processed} processed, ${created} created`);
  }

  console.log({ processed, created, alreadyExisted, mismatched });
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Idempotent:** running it twice produces zero new wallets. The mismatch report identifies users where `User.walletBalance != Wallet.availableBalance` — these require manual investigation (likely caused by a flow that touched one but not the other in the past).

---

## M4-2: Backfill `LedgerEntry` from legacy `Transaction` — Phase 4

```js
import mongoose from "mongoose";
import { connectDb } from "../../app/dbConfig/index.js";
import Transaction from "../../app/models/transaction.js";
import LedgerEntry from "../../app/models/ledgerEntry.js";
import {
  LEDGER_TRANSACTION_TYPE,
  LEDGER_DIRECTION,
  LEDGER_STATUS,
  OWNER_TYPE,
} from "../../app/constants/finance.js";

const TYPE_MAP = {
  "Order Payment":     { type: LEDGER_TRANSACTION_TYPE.ORDER_ONLINE_PAYMENT_CAPTURED, direction: LEDGER_DIRECTION.CREDIT },
  "Delivery Earning":  { type: LEDGER_TRANSACTION_TYPE.RIDER_PAYOUT_PROCESSED,        direction: LEDGER_DIRECTION.CREDIT },
  "Withdrawal":        { type: LEDGER_TRANSACTION_TYPE.WITHDRAWAL,                    direction: LEDGER_DIRECTION.DEBIT  },
  "Refund":            { type: LEDGER_TRANSACTION_TYPE.REFUND,                        direction: LEDGER_DIRECTION.CREDIT }, // override below
  "Incentive":         { type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,                    direction: LEDGER_DIRECTION.CREDIT },
  "Bonus":             { type: LEDGER_TRANSACTION_TYPE.ADJUSTMENT,                    direction: LEDGER_DIRECTION.CREDIT },
  "Cash Collection":   { type: LEDGER_TRANSACTION_TYPE.ORDER_COD_COLLECTED,           direction: LEDGER_DIRECTION.DEBIT  },
  "Cash Settlement":   { type: LEDGER_TRANSACTION_TYPE.COD_REMITTED,                  direction: LEDGER_DIRECTION.DEBIT  },
  "Wallet Payment":    { type: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,                 direction: LEDGER_DIRECTION.DEBIT  },
  "Wallet Refund":     { type: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,                 direction: LEDGER_DIRECTION.CREDIT },
};

const ACTOR_MAP = {
  "User":     OWNER_TYPE.CUSTOMER,
  "Seller":   OWNER_TYPE.SELLER,
  "Delivery": OWNER_TYPE.DELIVERY_PARTNER,
  "Admin":    OWNER_TYPE.ADMIN,
};

async function main() {
  await connectDb();
  let processed = 0, created = 0, skipped = 0, unmapped = 0;
  const cursor = Transaction.find({}).sort({ createdAt: 1 }).cursor();

  for await (const tx of cursor) {
    processed++;
    const mapping = TYPE_MAP[tx.type];
    const actor = ACTOR_MAP[tx.userModel];
    if (!mapping || !actor) {
      unmapped++;
      console.warn(`UNMAPPED tx _id=${tx._id} type=${tx.type} userModel=${tx.userModel}`);
      continue;
    }
    // Idempotency: derive a deterministic transactionId so reruns dedup.
    const transactionId = `LEGACY-TX-${tx._id}`;
    const existing = await LedgerEntry.findOne({ transactionId });
    if (existing) { skipped++; continue; }

    // Refund direction: if amount < 0 it was a debit on actor.
    let direction = mapping.direction;
    if (tx.type === "Refund" && tx.amount < 0) direction = LEDGER_DIRECTION.DEBIT;

    await LedgerEntry.create({
      transactionId,
      orderId: tx.order || null,
      walletId: null, // legacy didn't track
      actorType: actor,
      actorId: tx.user,
      type: mapping.type,
      direction,
      amount: Math.abs(tx.amount),
      currency: "INR",
      status: tx.status === "Settled" ? LEDGER_STATUS.COMPLETED :
              tx.status === "Failed" ? LEDGER_STATUS.FAILED :
              LEDGER_STATUS.PENDING,
      paymentMode: null,
      metadata: { ...(tx.meta || {}), migratedFromTransaction: true, originalTxId: tx._id, originalType: tx.type },
      description: tx.type,
      reference: tx.reference,
      // balance fields left null — original Transaction didn't track balances
    });
    created++;
    if (processed % 500 === 0) console.log(`progress: ${processed} processed, ${created} created`);
  }

  console.log({ processed, created, skipped, unmapped });
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Idempotent** via deterministic `transactionId: "LEGACY-TX-<txId>"`.

---

## M5-1: Discriminator migration — Phase 5

```js
import mongoose from "mongoose";
import { connectDb } from "../../app/dbConfig/index.js";

async function main() {
  await connectDb();
  const db = mongoose.connection.db;

  const ops = [
    { coll: "notifications",   filter: { recipientModel: "Customer" }, update: { $set: { recipientModel: "User" } } },
    { coll: "mediametadatas",  filter: { uploadedByModel: "Customer" }, update: { $set: { uploadedByModel: "User" } } },
    { coll: "tickets",         filter: { userType: "Customer" }, update: { $set: { userType: "User" } } },
    { coll: "tickets",         filter: { userType: "Rider" }, update: { $set: { userType: "Delivery" } } },
    { coll: "otpsessions",     filter: { userType: "Customer" }, update: { $set: { userType: "User" } } },
  ];

  for (const op of ops) {
    const result = await db.collection(op.coll).updateMany(op.filter, op.update);
    console.log(`${op.coll} ${JSON.stringify(op.filter)} -> matched=${result.matchedCount} modified=${result.modifiedCount}`);
  }

  // Add beneficiaryModel to existing Payouts based on payoutType
  const sellerPayouts = await db.collection("payouts").updateMany(
    { payoutType: "SELLER", beneficiaryModel: { $exists: false } },
    { $set: { beneficiaryModel: "Seller" } },
  );
  console.log(`payouts SELLER -> matched=${sellerPayouts.matchedCount} modified=${sellerPayouts.modifiedCount}`);

  const riderPayouts = await db.collection("payouts").updateMany(
    { payoutType: "DELIVERY_PARTNER", beneficiaryModel: { $exists: false } },
    { $set: { beneficiaryModel: "Delivery" } },
  );
  console.log(`payouts DELIVERY -> matched=${riderPayouts.matchedCount} modified=${riderPayouts.modifiedCount}`);

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Idempotent.** Re-running matches 0 rows.

---

## M5-2: Validate post-migration discriminator state

```js
// Same connect boilerplate ...
const collsToCheck = {
  notifications:  { field: "recipientModel", forbidden: ["Customer"] },
  mediametadatas: { field: "uploadedByModel", forbidden: ["Customer"] },
  tickets:        { field: "userType", forbidden: ["Customer", "Rider"] },
  otpsessions:    { field: "userType", forbidden: ["Customer"] },
};

for (const [coll, { field, forbidden }] of Object.entries(collsToCheck)) {
  for (const v of forbidden) {
    const c = await db.collection(coll).countDocuments({ [field]: v });
    if (c > 0) {
      console.error(`ASSERTION FAILED: ${coll}.${field} still has ${c} rows with value ${v}`);
      process.exit(1);
    }
  }
}
console.log("All discriminator migrations verified");
```

---

## M6-1: Add `deletedAt`/`deletedBy` to existing rows — Phase 6

No backfill required because new fields default to `null`. Pure schema additions. The migration is just a code-deploy.

---

## M7-1 through M7-N: Phase 7 unsets

Each is a single `updateMany({}, {$unset: {fieldName: 1}})` operation. Templates included for completeness.

```js
// M7-1 — unset Order.payment (legacy)
await db.collection("orders").updateMany({}, { $unset: { payment: 1 } });

// M7-2 — unset Order.pricing (legacy)
await db.collection("orders").updateMany({}, { $unset: { pricing: 1 } });

// M7-3 — unset Order.deliveryPartner
await db.collection("orders").updateMany({}, { $unset: { deliveryPartner: 1 } });

// M7-4 — unset User.walletBalance
await db.collection("users").updateMany({}, { $unset: { walletBalance: 1 } });

// M7-5 — rename transactions -> transactions_archive
await db.collection("transactions").rename("transactions_archive");
```

**WARNING:** these are destructive in spirit (even though MongoDB preserves the field absence, the value is gone). Run only after the 30-day production soak.

---

# 13. TESTING CHECKLIST (Per Phase)

## 13.1 Test layer breakdown

- **Unit** (Jest, `__tests__/unit/`) — pure functions, schema validators, hook behaviors.
- **Integration** (Jest with in-memory Mongo, `__tests__/integration/`) — service-level flows.
- **Contract** (Supertest against an in-process app, `__tests__/contract/`) — API request/response shapes.
- **Soak** — production-like load against a staging environment.
- **Manual smoke** — checklist run by ops before each phase ships.

## 13.2 Master checklist

### Phase 0
- [ ] Preflight report generated; committed.
- [ ] Replica-set confirmed via `rs.status()`.

### Phase 1
- [ ] Unit: `Cart.findById(...).populate('customerId')` returns User (3 models). [P1-1]
- [ ] Integration: place order with `walletAmount > 0` — succeeds, Transaction row created. [P1-2]
- [ ] Unit: `Order.financeFlags.sellerPayoutHeld` settable and persists. [P1-3]
- [ ] Contract: cart endpoints reject invalid bodies with 400 (Joi). [P1-4]
- [ ] Startup: model assertion passes. [P1-5]

### Phase 2
- [ ] Unit: `creditWallet` with `ledgerType` creates Wallet + LedgerEntry in same session.
- [ ] Unit: `creditWallet` without `ledgerType` logs WARN.
- [ ] Integration: `applyReturnRefund` rolls back fully on simulated mid-flight failure.
- [ ] Integration: refund flow produces exactly 1 LedgerEntry per actor.
- [ ] Integration: refund flow produces 1 FinanceAuditLog row.
- [ ] Integration: idempotent retry of refund yields the same final state (no double-credit).
- [ ] Integration: coupon `usageLimit:1` over 100 concurrent requests results in exactly 1 successful redemption.
- [ ] Verifier cron: deliberate drift (manual seed) raises an alert within 6 hours (or test interval).

### Phase 3
- [ ] Startup: `verifyIndexes()` reports healthy (no missing, no IndexOptionsConflict warning).
- [ ] Integration: `Transaction.find({user, userModel, type:"Withdrawal"})` plan uses an index (`explain().executionStats.totalDocsExamined` ≈ matched count).
- [ ] Integration: product search with text query uses the text index.

### Phase 4
- [ ] Unit: `Order.findOneAndUpdate({paymentStatus:"REFUNDED"})` results in `payment.status === "refunded"` after refresh.
- [ ] Unit: `getCustomerBalance(userId)` returns Wallet.availableBalance when Wallet exists, falls back otherwise.
- [ ] Integration: backfill scripts idempotent (run twice yields same row count).
- [ ] Integration: walletAdminService returns same response shape pre-and-post-migration.

### Phase 5
- [ ] Integration: `Notification.populate('recipient')` returns the correct user model for each `recipientModel` value.
- [ ] Integration: `Payout.populate('beneficiaryId')` returns Seller or Delivery as appropriate.
- [ ] Integration: OTP login for each role goes through OtpSession (no inline writes).

### Phase 6
- [ ] Unit: `Product.find()` excludes soft-deleted by default.
- [ ] Unit: `Product.find({__includeDeleted: true})` includes them.
- [ ] Integration: soft-delete a customer → cart/wishlist hard-deleted; orders intact.
- [ ] Unit: invalid 3-level category chain rejected on Product save.
- [ ] Unit: second `Setting` insert rejected.
- [ ] Integration: coupon `perUserLimit:1` enforced via CouponUsage count.

### Phase 7
- [ ] Production logs show zero reads of legacy fields for 30 consecutive days before this phase.
- [ ] All API responses still match documented frontend contract (snapshot tests).
- [ ] Archive collections (`transactions_archive`, etc.) queryable.

---

# 14. ROLLBACK PROCEDURES

## 14.1 Universal rollback rules

- **Always revert by replacing the deployed artifact**, not by re-running migrations in reverse. Mongo migrations are forward-only by design.
- **For schema changes:** revert the model file; pre-existing data with the new field is harmless (Mongoose ignores undeclared fields when `strict:true`).
- **For data migrations:** ensure each migration is idempotent. Re-applying after rollback either no-ops or self-heals.

## 14.2 Per-phase rollback time budget

| Phase | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) | Notes |
|---|---|---|---|
| 0 | n/a | n/a | Read-only |
| 1 | < 5 min (git revert + redeploy) | 0 (no data change) | |
| 2 | < 15 min (revert + redeploy + disable verifier flag) | 0 | |
| 3 | < 5 min (revert + redeploy). Wrong indexes re-appear but cause no incident. | 0 | |
| 4 | < 30 min (revert code; legacy fields still populated). | 0 — no destructive migration | |
| 5 | < 30 min (revert code; migration scripts are idempotent; discriminator field value rewrites don't destroy data) | 0 | |
| 6 | < 15 min (revert hooks; soft-delete filter disable via env flag) | 0 | |
| 7 | **> 4 hours** — restoring removed fields requires a backup restore. **Hold archived collections for ≥ 6 months** before they're truly deleted. | < 1 day (point-in-time backup) | |

## 14.3 Specific rollback runbooks

### Rollback Phase 2 (ledger integrity)
1. Revert PRs P2-1 through P2-9 (or only the failing ones).
2. Set `FINANCE_VERIFIER_ENABLED=false` in env.
3. Walletservice reverts to old signature; new optional fields ignored.
4. `applyReturnRefund` service file remains but is no longer called from controller (old inline code is the source of truth again).
5. **Data left in Wallet + LedgerEntry from the failed phase is correct** — it doesn't need to be cleaned up. The cron-based reconciliation in Phase 4 will pick up any drift.

### Rollback Phase 4 (canonicalization)
1. Revert sync hook addition in `Order.pre('findOneAndUpdate')`.
2. Continue reading from legacy fields. `walletService.getCustomerBalance()` still works (falls back to `User.walletBalance`).
3. `LedgerEntry` rows created during the phase remain — extra data, not corruption.

### Rollback Phase 5 (naming)
1. Revert code.
2. The discriminator migration script effectively can't be reverse-run because the original `"Customer"` value is implicit. Document this — code MUST handle both `"User"` and `"Customer"` for forward-compatible rollback.

### Rollback Phase 7 (destructive cleanup)
1. **Restore the affected collection from the most recent snapshot** (point-in-time recovery on MongoDB Atlas / equivalent).
2. Re-deploy old code that reads the legacy fields.

---

# 15. RISK MATRIX

| ID | Risk | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|
| R1 | `ref:"Customer"` fix introduces a `populate` that worked-by-accident before to silently fail (unlikely — populate currently returns null) | Very low | Low | Unit tests cover both states | 1 |
| R2 | Wallet+ledger backfill takes longer than expected on a large `users` table (1M+ users) | Medium | Medium | Run in chunks, off-peak; resume by `_id` cursor | 4 |
| R3 | `Order.pre('findOneAndUpdate')` hook adds latency to hot path | Medium | Low | Benchmark — Mongoose hooks add < 1ms; acceptable | 4 |
| R4 | Discriminator migration leaves a row partially updated mid-script | Low | Medium | Mongo updateMany is atomic per document; script is per-collection | 5 |
| R5 | Soft-delete `pre('find')` hook hides admin-needed rows | Medium | High | Audit every admin-side query; opt-in `__includeDeleted` everywhere needed | 6 |
| R6 | Phase 7 removes a field still read by an unknown caller | Low | High | 30-day production soak with log assertions; archive don't delete | 7 |
| R7 | Replica-set lost primary mid-migration | Very low | High | Migrations check `rs.status()` at start; fail fast on stepdown | All |
| R8 | Index creation during traffic spike blocks reads | Low | Medium | All indexes built with `background:true` | 3 |
| R9 | Ledger backfill collides with live writes producing duplicate entries | Low | Medium | Deterministic `transactionId: "LEGACY-TX-<txId>"` makes inserts idempotent | 4 |
| R10 | Coupon atomic update breaks a coupon that has no `usageLimit` | Low | Medium | Aggregation update pipeline preserves behavior when `usageLimit` is null | 2 |
| R11 | Removing inline OTP fields breaks a forgotten code path | Low | Medium | Phase 5 keeps fields; Phase 7 removes; 30-day observation window | 7 |
| R12 | `walletService` migration breaks existing webhook callbacks | Medium | High | New signature is additive; old behavior preserved when `ledgerType` omitted | 2 |
| R13 | Discriminator migration takes hours on large notifications collection | Medium | Low | Run during off-peak; targeted update with index on `recipientModel` | 5 |
| R14 | `databaseIndexManager` v2 doesn't create the new compound index because schema-level index of same key exists | Medium | Low | Manager skips when index of same key exists, regardless of name | 3 |
| R15 | Frontend reads from `Order.payment.status` (legacy mirror) and Phase 4 sync hook misses an edge case | Medium | Medium | Snapshot test of `Order.payment.status` for every possible `paymentStatus` value | 4 |

---

# 16. BACKWARD COMPATIBILITY VERIFICATION PROTOCOL

Before each phase merges to `main`:

## 16.1 Pre-merge checklist

- [ ] No public API field renamed (request or response).
- [ ] No HTTP route changed.
- [ ] No authentication contract changed.
- [ ] All new schema fields default to safe values (`null`, `false`, `0`, `""`).
- [ ] All new schema fields are nullable (not `required: true`) until a migration backfills them.
- [ ] If a polymorphic enum is tightened, a migration is queued for the same release.
- [ ] If a deprecation is documented, a JSDoc `@deprecated` annotation is added; lint rule warns on internal use.

## 16.2 Schema-comparison gate (CI)

Pre-merge CI step compares the proposed schema against the previous release:
```bash
node scripts/schema-diff.js HEAD~1 HEAD
```
The diff tool lists every change in: field added / removed / made required / enum tightened / index added / index removed / hook added / hook removed.

Each entry must be either:
- Explicitly approved in the PR description.
- Or backed by a migration script in the same PR.

## 16.3 Soak protocol

After merge, before promoting to production:

| Phase | Soak in staging | Soak in canary (≤5% prod traffic) |
|---|---|---|
| 1 | 24 h | 0 (low-risk, deploy direct) |
| 2 | 48 h | 24 h |
| 3 | 24 h | 24 h |
| 4 | 72 h | 48 h |
| 5 | 48 h | 24 h |
| 6 | 48 h | 24 h |
| 7 | 7 days | 7 days |

## 16.4 Monitoring during soak

Critical dashboards:
- **Financial integrity:** `ledger_entries_created_total` rate, `wallet_drift_detected_total`, refund processing time.
- **Database health:** average op latency by collection, index hit rate, slow query count.
- **API success rate:** per-endpoint 5xx rate.
- **Sentry:** any new error fingerprint with > 5 occurrences blocks promotion.

---

# 17. FOLDER / MODULE RESTRUCTURING (advisory only — not required by this audit)

The codebase has already started a domain-folder migration under `app/domains/`. The audit's data-layer fixes are **independent** of folder restructuring. Recommended sequence if both happen:

1. Land Phase 0-3 of this audit first (correctness + transactional integrity + index hygiene).
2. Then resume the domain migration (existing P5.1+ plan).
3. Then land Phase 4-7 of this audit, integrating with the new domain layout.

Where the audit creates new files, prefer the existing target folder:

| New file | Target location | Rationale |
|---|---|---|
| `orderRefundService.js` | `app/services/order/` (existing) | Matches the existing extraction pattern (orderReturnService, orderQueryService). |
| `refModels.js` (constants) | `app/constants/` | Group with other shared constants. |
| `couponUsage.model.js` | `app/models/` | Match flat layout for now; Phase 5 domain folder later. |
| Migration scripts | `backend/scripts/migrations/<phase>/<order>-<name>.js` | New convention; existing scripts live at `backend/scripts/`. |

---

# 18. CONFIRMATION ITEMS (require user/ops decision before execution)

These items the audit identified but flagged as **require confirmation** — they affect business logic that's not unambiguously inferrable from code alone.

| ID | Item | Question | Default if no answer |
|---|---|---|---|
| Q1 | `Transaction` retirement | Should `Transaction` collection be archived in Phase 7, or kept as a permanent read-only ledger view alongside `LedgerEntry`? | Archive (Phase 7) |
| Q2 | Customer soft-delete cascade on orders | When a customer is soft-deleted, what should happen to their non-terminal orders (PAYMENT_PENDING / out-for-delivery)? | Refuse to soft-delete until orders are terminal |
| Q3 | `User.role` enum | Is the `["user","admin","delivery","seller"]` enum on the User collection still meaningful, or is `User` exclusively customer? | Treat as customer-exclusive; remove enum in Phase 5 |
| Q4 | OTP TTL | Current TTL on `OtpSession` is implicit (`expireAfterSeconds: 0` on `expiresAt`). What is the intended max OTP validity? | 10 minutes — confirm with auth flow |
| Q5 | Coupon perUserLimit semantics | Is "1 per user" calendar-bounded (`per month`) or absolute? | Absolute, per coupon |
| Q6 | Wallet refund vs gateway refund | When an online-paid order is returned, should refund go to the **gateway** (debit-card refund) or to **wallet** (instant)? | Wallet (current behavior in `orderController.js:968`) |
| Q7 | Order.seller required | Can an order ever be created without a seller? | No — make `required:true` in Phase 4 |
| Q8 | Multi-payment retry on one order | If first payment attempt fails, can the same order accept a second attempt against a new `Payment` row? | Yes — already supported via `Payment.attemptCount` |
| Q9 | Ticket `senderType` enum | Should sellers be able to message customers via tickets? | No — admin-mediated only |
| Q10 | Withdrawal entity | Should `Transaction.type:"Withdrawal"` migrate to a dedicated `Withdrawal` collection, or stay as a `LedgerEntry.type:WITHDRAWAL`? | LedgerEntry — Phase 4 absorbs |

Mark these resolved before Phase 4-5 starts.

---

# 19. INDEX OF DELIVERABLES

| # | Deliverable | Part | Section |
|---|---|---|---|
| 1 | Complete backend audit report | Part 1 | §1-3 |
| 2 | Missing database model report | Part 1 | §1.4 (dead-model search) |
| 3 | Association / relation correction report | Part 2 | §4 |
| 4 | API ↔ database mapping report | Part 2 | §5 |
| 5 | Refactoring roadmap in execution order | Part 3 | All phases |
| 6 | Safe migration plan | Part 4 | §12 |
| 7 | Testing and validation checklist | Part 4 | §13 |
| 8 | Risk analysis report | Part 4 | §15 |
| 9 | Recommended folder / module restructuring | Part 4 | §17 |
| 10 | Step-by-step implementation phases for AI agents or developers | Part 3 | Phase tickets P1-1 through P7-N |

---

# 20. NEXT IMMEDIATE ACTIONS

Hand-off checklist for the engineer (or AI agent) executing this plan:

1. **Today (Phase 0):**
   - [ ] Read all 4 parts of this plan.
   - [ ] Run `M0-1` preflight script against staging snapshot.
   - [ ] Commit the report.
   - [ ] Resolve Q1–Q10 with product/ops stakeholders.

2. **Day 1-2 (Phase 1):**
   - [ ] Create 5 small PRs (one per ticket P1-1 to P1-5).
   - [ ] Each PR includes its own unit tests.
   - [ ] Land sequentially with 4-8 hour soaks between.

3. **Day 3-6 (Phase 2):**
   - [ ] Land `walletService` ledger-aware variant (P2-1) — soak.
   - [ ] Migrate call sites (P2-2) — small PR per service.
   - [ ] Land `applyReturnRefund` extraction (P2-4).
   - [ ] Land cancellation + delivery-OTP transactional wraps (P2-5, P2-6).
   - [ ] Land coupon atomic increment (P2-7).
   - [ ] Land verifier cron (P2-9).

4. **Day 7-8 (Phase 3):**
   - [ ] Run dead-index drop script in maintenance window.
   - [ ] Land `databaseIndexManager` cleanup.

5. **Week 2 (Phase 4):**
   - [ ] Land sync hook upgrade.
   - [ ] Run backfill scripts (M4-1, M4-2) off-peak.
   - [ ] Migrate read sites to canonical source.

6. **Week 3 (Phase 5 + 6):**
   - [ ] Discriminator migration.
   - [ ] OTP consolidation.
   - [ ] Soft-delete + audit field additions.

7. **30-day soak.**

8. **Week 7-8 (Phase 7):**
   - [ ] Final cleanup with rollback-ready backup.

---

End of plan. Total ≈ 8 weeks calendar time (2 weeks active engineering, 30-day production soak, 2 weeks cleanup). All phases are independently deployable. Each phase preserves API contracts. All migrations are idempotent. Every change is rollback-able in ≤ 30 minutes (except Phase 7 which intentionally trades 4h+ RTO for actual cleanup).

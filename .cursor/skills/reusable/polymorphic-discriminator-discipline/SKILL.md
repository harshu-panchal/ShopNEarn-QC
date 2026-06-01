---
name: polymorphic-discriminator-discipline
description: Enforce a single shared enum for every polymorphic Mongoose refPath discriminator (userModel, recipientModel, actorType, ownerType, uploadedByModel, userType). All discriminator fields draw from app/constants/refModels.js. Migration backfills retire legacy values like "Customer" and "Rider" so the enum can tighten to canonical values only. Use when adding a refPath field, when discriminator enums drift across files, or during Phase 5 of the database audit plan.
---

# Polymorphic Discriminator Discipline

## Purpose

This codebase has at least five different polymorphic discriminator fields, each declaring its own enum. The same conceptual entity ("the human who acted") shows up as `User`, `Customer`, `Seller`, `Delivery`, `Rider`, `Admin` across files with no agreement.

This skill enforces:

1. **One shared constant file** (`app/constants/refModels.js`) exports the canonical enum.
2. **Every `refPath` discriminator** imports from that file.
3. **Migration backfills** retire legacy discriminator values **before** the enum tightens.
4. **No model name is used in code that isn't registered with `mongoose.model()`.**

## When To Use

- Adding a new `refPath`-backed field to any schema
- The user mentions "discriminator", "userType", "actorType", "ownerType", "userModel", "recipientModel"
- Two schemas have similar polymorphic fields with different enums
- A migration is renaming `"Customer"` → `"User"` or `"Rider"` → `"Delivery"`
- Phase 5 tickets (P5-1, P5-2, P5-3, P5-4) of `database_audit_plan_part3.md`

## The Canonical Constants File

```js
// app/constants/refModels.js  — single source of truth
export const USER_MODEL_NAMES = Object.freeze({
  USER:     'User',       // customer file at app/models/customer.js registers as 'User'
  SELLER:   'Seller',
  DELIVERY: 'Delivery',
  ADMIN:    'Admin',
});

export const ALL_USER_MODEL_NAMES = Object.freeze(
  Object.values(USER_MODEL_NAMES),
);

// Subsets for fields that don't accept the full set.
export const PAYOUT_BENEFICIARY_MODEL_NAMES = Object.freeze([
  USER_MODEL_NAMES.SELLER,
  USER_MODEL_NAMES.DELIVERY,
]);

export const FINANCE_ACTOR_MODEL_NAMES = Object.freeze([
  USER_MODEL_NAMES.USER,
  USER_MODEL_NAMES.SELLER,
  USER_MODEL_NAMES.DELIVERY,
  USER_MODEL_NAMES.ADMIN,
]);
```

Every schema imports from here. The constant name and the registered Mongoose model name are kept identical to avoid translation layers.

## The Schema Pattern

```js
// CORRECT — refPath with shared enum and explicit foreign key field
import { ALL_USER_MODEL_NAMES } from '../constants/refModels.js';

const notificationSchema = new Schema({
  recipientModel: {
    type:     String,
    enum:     ALL_USER_MODEL_NAMES,
    required: true,
  },
  recipient: {
    type:     Schema.Types.ObjectId,
    refPath:  'recipientModel',
    required: true,
    index:    true,
  },
});
```

Now `Notification.findById(id).populate('recipient')` resolves to the correct concrete model based on `recipientModel`. No manual `mongoose.model(doc.recipientModel)` calls anywhere.

## The Migration Sequence (before tightening the enum)

You cannot tighten an enum to `['User']` while rows still have `recipientModel: 'Customer'`. The order is:

```
1. Backfill data        →  rename legacy values to canonical
2. Verify zero residue  →  count documents with old values; assert zero
3. Tighten the enum     →  replace the wide enum with ALL_USER_MODEL_NAMES
4. Deploy schema change
```

### Backfill script template

```js
// scripts/migrate-customer-to-user-discriminator.js
import mongoose from 'mongoose';
import { logger } from '../app/services/loggerService.js';

const REWRITES = [
  { coll: 'notifications',   field: 'recipientModel',  from: 'Customer', to: 'User' },
  { coll: 'mediametadatas',  field: 'uploadedByModel', from: 'Customer', to: 'User' },
  { coll: 'tickets',         field: 'userType',        from: 'Customer', to: 'User' },
  { coll: 'tickets',         field: 'userType',        from: 'Rider',    to: 'Delivery' },
  { coll: 'otpsessions',     field: 'userType',        from: 'Customer', to: 'User' },
];

export async function migrateDiscriminators({ dryRun = true } = {}) {
  const db = mongoose.connection.db;
  for (const r of REWRITES) {
    const cursor = db.collection(r.coll).find({ [r.field]: r.from });
    const count = await cursor.count();
    logger.info('discriminator.migration.plan', { ...r, count });
    if (!dryRun && count > 0) {
      const res = await db.collection(r.coll).updateMany(
        { [r.field]: r.from },
        { $set: { [r.field]: r.to } },
      );
      logger.info('discriminator.migration.applied', { ...r, modified: res.modifiedCount });
    }
  }
}
```

Run with `dryRun: true` first. Verify the planned counts make sense. Then run with `dryRun: false` during a low-traffic window.

### Verification before tightening

```js
db.notifications.distinct('recipientModel');
// Expect: ['User', 'Seller', 'Delivery', 'Admin'] — no 'Customer'

db.tickets.distinct('userType');
// Expect: ['User', 'Seller', 'Delivery'] — no 'Customer' or 'Rider'
```

Only after the production query returns the clean set does the schema PR tighten the enum.

## Adding `refPath` Where It's Missing

Some fields are polymorphic in spirit but lack `refPath`. They use `*Type` + `*Id` pairs and require manual `mongoose.model(doc.xxxType).findById(doc.xxxId)`. Phase 5 introduces `refPath` for these.

Worked example — `Payout.beneficiaryId`:

```diff
+ import { PAYOUT_BENEFICIARY_MODEL_NAMES } from '../constants/refModels.js';

  const payoutSchema = new Schema({
+   beneficiaryModel: {
+     type:     String,
+     enum:     PAYOUT_BENEFICIARY_MODEL_NAMES,
+     required: true,
+   },
    beneficiaryId: {
      type:    Schema.Types.ObjectId,
+     refPath: 'beneficiaryModel',
      required: true,
      index:    true,
    },
  });
```

Backfill derives `beneficiaryModel` from `payoutType`:

```js
await Payout.updateMany({ payoutType: 'SELLER'           }, { $set: { beneficiaryModel: 'Seller'   } });
await Payout.updateMany({ payoutType: 'DELIVERY_PARTNER' }, { $set: { beneficiaryModel: 'Delivery' } });
```

After backfill, schema PR adds `required: true` on `beneficiaryModel`.

## Codebase Audit Table

From `database_audit_plan_part1.md` §0.1 finding C-9:

| Schema file | Discriminator field | Current enum | Target enum | Backfill |
|---|---|---|---|---|
| `transaction.js:10-14` | `userModel` | `['Seller','Delivery','Admin','User']` | `ALL_USER_MODEL_NAMES` (same) | none |
| `notification.js:71` | `recipientModel` | `['Seller','Admin','Customer','Delivery','User']` | `ALL_USER_MODEL_NAMES` | rename `Customer` → `User` |
| `mediaMetadata.js:115` | `uploadedByModel` | `['Customer','Seller','Admin','Delivery']` | `ALL_USER_MODEL_NAMES` | rename `Customer` → `User` |
| `ticket.js:12` | `userType` | `['Customer','Seller','Rider']` | `['User','Seller','Delivery']` | rename both |
| `otp.model.js:13` | `userType` | `['Admin','Seller','Customer','Delivery']` | `ALL_USER_MODEL_NAMES` | rename `Customer` → `User` |
| `ledgerEntry.js` | `actorType` | string, no refPath | enum + refPath (Phase 5+) | none — already uses correct names where set |
| `wallet.js` | `ownerType` | string, no refPath | enum + refPath (Phase 5+) | none — uses `CUSTOMER` (different domain) |
| `payout.js` | (none) | — | add `beneficiaryModel` with refPath | derive from `payoutType` |

Note: `wallet.ownerType` uses `'CUSTOMER'` not `'User'` because that field is **not** a Mongoose ref — it's a domain enum from `OWNER_TYPE` in `constants/finance.js`. Don't conflate `OWNER_TYPE` with refModels. The conversion to a `refPath` is a separate decision and may not happen at all (see audit Part 2 §2.4).

## Two Discriminator Namespaces

Keep these conceptually separate:

| Namespace | Used by | Values |
|---|---|---|
| **Mongoose model names** (`refModels.js`) | `refPath` fields | `User`, `Seller`, `Delivery`, `Admin` — exact `mongoose.model(...)` names |
| **Domain owner types** (`constants/finance.js`) | `Wallet.ownerType`, `LedgerEntry.actorType`, internal logic | `CUSTOMER`, `SELLER`, `DELIVERY_PARTNER`, `ADMIN` — domain enum |

A small mapper bridges them when needed:

```js
// app/services/finance/ownerMapping.js
import { OWNER_TYPE } from '../../constants/finance.js';
import { USER_MODEL_NAMES } from '../../constants/refModels.js';

const OWNER_TO_MODEL = {
  [OWNER_TYPE.CUSTOMER]:         USER_MODEL_NAMES.USER,
  [OWNER_TYPE.SELLER]:           USER_MODEL_NAMES.SELLER,
  [OWNER_TYPE.DELIVERY_PARTNER]: USER_MODEL_NAMES.DELIVERY,
  [OWNER_TYPE.ADMIN]:            USER_MODEL_NAMES.ADMIN,
};
export const ownerTypeToModelName = (t) => OWNER_TO_MODEL[t] ?? null;

const MODEL_TO_OWNER = Object.fromEntries(
  Object.entries(OWNER_TO_MODEL).map(([k, v]) => [v, k]),
);
export const modelNameToOwnerType = (m) => MODEL_TO_OWNER[m] ?? null;
```

Don't put this mapping inline in controllers. One file, two functions, used everywhere.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Inline string literals (`enum: ['Customer','User']`) in each schema | Drift across files; no compile-time check | Single shared constant |
| Tightening the enum before backfill | Existing rows fail revalidation; new writes 500 | Backfill, verify, then tighten |
| `'Customer'` as a value when no `Customer` model is registered | `populate()` returns `null` silently | Use `'User'` (the registered name) |
| `'Rider'` synonymous with `'Delivery'` | Same population mismatch | Use the registered name `'Delivery'` |
| `*Type` + `*Id` pair without `refPath` | Cannot use `populate()`, manual joins everywhere | Add `refPath` if it's a Mongoose model reference |
| Conflating `OWNER_TYPE` (domain enum) with model names | Mixing concerns, confusing readers | Two namespaces + a single mapper |
| Discriminator field without `required: true` | Mongoose can't resolve `refPath` on save | Always required when paired with `refPath` |
| Backfill that updates without dry-run | Production data damaged irreversibly | Always two-step: dry-run, then commit |
| Schema PR + backfill in same PR | Cannot deploy schema before data is clean | Backfill PR ships first, then schema tighten PR |

## Backward Compatibility

- During backfill: both old and new discriminator values coexist; enum stays wide.
- After tighten: production data is uniform; old values would fail save but none exist.
- API request/response shapes unchanged — no public field is renamed; only internal discriminator values shift.

## Rollback

| Change | Rollback |
|---|---|
| Schema imports constants | Revert single import line |
| Enum tightened | Re-widen the enum to include old values — production data already clean, so no immediate impact |
| Backfill applied | Reverse mapper exists (`User` → `Customer`) but reverting is rarely useful since nothing depends on the old value |
| New `refPath` added | Drop the field with `$unset` migration; old code path is unaffected if not yet using it |

## Sequencing With The Audit Plan

| Audit-plan ticket | Skill section |
|---|---|
| P5-1 (`refModels.js`) | Canonical constants file |
| P5-2 (update polymorphic enums) | Schema pattern + audit table |
| P5-3 (migration script) | Migration sequence + dry-run pattern |
| P5-4 (`Payout.beneficiaryId` refPath) | Adding refPath where missing |
| P5-5 (`Payout.createdBy` ref:Admin) | Trivial fix — single-target `ref`, not polymorphic |

## Related Skills

- `mongoose-ref-integrity` — the broader ref/refPath audit framework
- `idempotent-data-migration` — for the backfill script implementation
- `legacy-field-deprecation` — when retiring an entire discriminator field instead of widening its values

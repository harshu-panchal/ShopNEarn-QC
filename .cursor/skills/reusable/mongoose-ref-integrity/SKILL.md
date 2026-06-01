---
name: mongoose-ref-integrity
description: Detect and fix broken Mongoose populate references - ref strings pointing to unregistered model names, refPath enums missing values that controllers write, duplicate FK fields (e.g. deliveryBoy + deliveryPartner) drifting, and polymorphic discriminators with no refPath wiring. Use when populate() silently returns null, when the user mentions "broken ref", "Customer vs User model", "refPath audit", or before any model rename/migration to ensure no silent populate breakage.
---

# Mongoose Ref Integrity

## Purpose

Guarantee that every Mongoose `ref:`, `refPath:`, and inferred FK string resolves to a real registered model name at runtime. Mongoose **silently returns `null`** when `populate()` targets a model that was never registered — there is no error, no warning. This skill catches that class of bug before it ships and during migrations.

## When To Use

- A `populate()` call returns `null` for documents that clearly exist
- The user reports "ref" issues, "Customer vs User", "refPath", "polymorphic FK", "populate returning empty"
- Before renaming a Mongoose model (e.g. `mongoose.model("Customer", …)` → `"User"`)
- After adding a new schema with `refPath` — verify the enum matches actual registered models
- A controller writes a discriminator value (`"Wallet Payment"`, `"Customer"`) that throws `ValidationError`
- During the Phase 1 + Phase 5 work of `database_audit_plan_part3.md`

## The Three Failure Modes

| Failure | Symptom | Root cause |
|---|---|---|
| **Stale `ref:` string** | `populate()` returns `null` for valid IDs | Model file declares `ref: "Customer"` but the file `models/customer.js` actually calls `mongoose.model("User", …)` |
| **Missing `refPath` enum value** | `ValidationError` on document save, or `populate()` returns `null` | Controller writes `recipientModel: "Customer"` but schema enum is `["User", "Seller"]` |
| **Dual-ref drift** | Two fields point at the same FK but only one is indexed/updated | `Order.deliveryBoy` and `Order.deliveryPartner` both exist; some code writes A, some writes B |

## Workflow

```
Ref Integrity Audit Progress:
- [ ] Step 1: Enumerate registered model names at runtime
- [ ] Step 2: Grep every `ref: "..."` and `refPath: "..."` in schemas
- [ ] Step 3: Diff: every ref string must appear in the registered set
- [ ] Step 4: Grep every controller/service writing to a refPath-backed field
- [ ] Step 5: Verify the written discriminator value is in the schema enum
- [ ] Step 6: Identify dual-ref fields; pick canonical, deprecate other
- [ ] Step 7: Add a startup-time assertion (see below)
```

## Step 1 — Enumerate Registered Models

In a one-off REPL or boot log:

```js
import mongoose from 'mongoose';
import './app/dbConfig/connection.js';
console.log(mongoose.modelNames().sort());
```

Save this list as the **ground truth** for ref strings.

## Step 2 — Audit `ref:` Strings

```bash
rg "ref:\s*[\"']([A-Z][A-Za-z0-9_]+)[\"']" -or '$1' --no-filename app/models | sort -u
```

Compare against `mongoose.modelNames()`. Every left-side value must appear on the right.

**Typical mismatches in this codebase** (already cataloged in audit plan):

| Model file | Field | Declared `ref` | Registered model | Fix |
|---|---|---|---|---|
| `app/models/cart.js:7` | `customerId` | `"Customer"` | `User` (from `customer.js`) | Change to `ref: "User"` |
| `app/models/wishlist.js:7` | `customerId` | `"Customer"` | `User` | Change to `ref: "User"` |
| `app/models/checkoutGroup.js:19` | `customer` | `"Customer"` | `User` | Change to `ref: "User"` |

## Step 3 — Audit `refPath:` enums

For each schema using `refPath`, identify three things:

1. The **discriminator field** (e.g. `recipientModel`, `userType`, `actorType`).
2. The **enum** declared on that field.
3. The **actual values** controllers write into that field.

```bash
rg "refPath:\s*[\"']([a-zA-Z]+)[\"']" -or '$1' --no-filename app/models | sort -u

rg "recipientModel:\s*[\"']" --type js app/controller app/services app/modules
```

Cross-reference each written value against the enum. Mismatches manifest as:

- Mongoose validation errors on save (loud failure)
- `populate()` returning `null` (silent failure)

### Polymorphic discriminator canonical list

This codebase's polymorphic user discriminator is **`User | Seller | Delivery | Admin`**. There is no `"Customer"` or `"Rider"` registered model. Audit every `refPath`-backed field against this set.

| Schema file | Discriminator field | Correct enum | Drift to fix |
|---|---|---|---|
| `transaction.js:10-14` | `userModel` | `["User","Seller","Delivery","Admin"]` | OK |
| `notification.js:71` | `recipientModel` | `["User","Seller","Delivery","Admin"]` | Drop `"Customer"` |
| `mediaMetadata.js:115` | `uploadedByModel` | `["User","Seller","Delivery","Admin"]` | Rename `"Customer"` → `"User"` |
| `ticket.js:12` | `userType` | `["User","Seller","Delivery"]` | Rename `"Customer"`→`"User"`, `"Rider"`→`"Delivery"` |
| `otp.model.js:13` | `userType` | `["User","Seller","Delivery","Admin"]` | Rename `"Customer"` → `"User"` |

## Step 4 — Audit Implicit Polymorphic Pairs (no `refPath`)

Some FKs use a `*Type` + `*Id` field pair **without** `refPath`. These cannot use `populate()` and require manual `mongoose.model(doc.ownerType).findById(doc.ownerId)`.

Audit list for this codebase:

| Schema | Type field | ID field | Action |
|---|---|---|---|
| `ledgerEntry.js` | `actorType` | `actorId` | Phase 5: introduce explicit `refPath` |
| `wallet.js` | `ownerType` | `ownerId` | Phase 5: introduce explicit `refPath` |
| `payout.js` | `payoutType` | `beneficiaryId` | Phase 5: add `beneficiaryModel` with `refPath` |

Until `refPath` is added, every read site must resolve the model manually. Document this requirement in the schema's JSDoc.

## Step 5 — Dual-Ref Drift Resolution

Two fields, same FK semantics. Pick one canonical:

```js
// Order schema
deliveryBoy:     { type: ObjectId, ref: 'Delivery', index: true },  // CANONICAL (used by indexes)
deliveryPartner: { type: ObjectId, ref: 'Delivery', index: true },  // LEGACY MIRROR
```

Rule:

1. Pick the field referenced by indexes and the most call-sites.
2. Add a `pre('save')` hook to mirror writes to the other.
3. Mark the legacy field `@deprecated` in JSDoc.
4. New code only reads/writes the canonical.
5. Phase 7 drops the legacy field after soak.

## Step 6 — Startup-Time Model Assertion (REQUIRED)

Add to `app/core/startup.js` and call before `app.listen`:

```js
import mongoose from 'mongoose';

const REQUIRED_MODELS = [
  'User', 'Seller', 'Delivery', 'Admin',
  'Order', 'Payment', 'PaymentWebhookEvent',
  'Cart', 'Wishlist', 'CheckoutGroup',
  'Product', 'Category', 'Coupon',
  'Wallet', 'LedgerEntry', 'Payout', 'Transaction', 'FinanceAuditLog',
  'OrderOtp', 'OtpVerification', 'OtpSession',
  'Notification', 'NotificationPreference', 'PushToken',
  'Review', 'Ticket', 'FAQ',
  'Offer', 'OfferSection', 'ExperienceSection', 'HeroConfig',
  'Setting', 'MediaMetadata', 'GeocodeCache', 'StockHistory',
  'DashboardStats', 'SellerMetrics', 'FinanceReports',
  'SearchIndexFailure', 'DeliveryAssignment',
];

export function assertAllModelsRegistered() {
  const registered = new Set(mongoose.modelNames());
  const missing = REQUIRED_MODELS.filter((m) => !registered.has(m));
  if (missing.length > 0) {
    throw new Error(`Required Mongoose models missing: ${missing.join(', ')}`);
  }
}
```

This is the **single most effective guard** against future ref-string regressions. A rename that breaks the registry now crashes at boot instead of returning `null` from `populate()` weeks later.

## Step 7 — Tests Per Fixed Ref

For each `ref:` correction, add a populate test:

```js
test('Cart.customerId populates to User', async () => {
  const user = await User.create({ phone: '9000000000', firstName: 'T' });
  const cart = await Cart.create({ customerId: user._id, items: [] });
  const fetched = await Cart.findById(cart._id).populate('customerId');
  expect(fetched.customerId).not.toBeNull();
  expect(String(fetched.customerId._id)).toBe(String(user._id));
});
```

Same shape for every ref change — the test is the contract.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Trusting `ref:` strings without verifying the model is registered | Silent `null` from populate | Boot-time `assertAllModelsRegistered()` |
| Adding a new `refPath`-backed field without an enum | Mongoose allows any string, downstream breaks | Always declare `enum` on the discriminator field |
| Adding a new value to a `refPath` enum without checking writers | Existing rows fail revalidation | Migration must run **before** the enum tightens |
| Renaming a model name without grep-then-fix on all `ref:` strings | Silent breakage everywhere | Always grep + boot-time assertion |
| Two FK fields pointing at the same entity, both writable | Drift between code paths | Pick canonical, mirror via hook, deprecate other |
| Polymorphic pair (`ownerType`+`ownerId`) without `refPath` | Cannot use `populate()`, requires manual joins | Add `refPath` in Phase 5; until then, document and use manual resolution |
| Discriminator enum allows both old and new value (`["Customer","User"]`) | Permanent drift; nothing forces migration completion | Enum tightens to canonical only after backfill migration |

## Sequencing With The Audit Plan

This skill is the methodology behind **Phase 1 (tickets P1-1, P1-5)** and **Phase 5 (tickets P5-1, P5-2, P5-3, P5-4, P5-5)**.

| Audit-plan ticket | Maps to step here |
|---|---|
| P1-1 (fix `ref:"Customer"`) | Step 2 + Step 7 |
| P1-5 (startup model assertion) | Step 6 |
| P5-1 (`refModels.js` constants file) | Step 3 (formalize the canonical enum) |
| P5-2 (update polymorphic enums) | Step 3 |
| P5-3 (migrate `"Customer"`→`"User"` data) | Backfill before tightening enum |
| P5-4 (add `refPath` to `Payout.beneficiaryId`) | Step 4 → Step 3 |

## Rollback

| Change | Rollback |
|---|---|
| `ref:` string correction | One-line revert; old populate path returns `null` again (current production behavior) |
| `refPath` enum value addition | Remove the enum value (must verify no rows persist with it) |
| Startup assertion added | Remove the assertion call; service no longer crashes on missing model |
| Data migration `"Customer"`→`"User"` | Re-run with reverse mapping (rarely needed; old discriminator was never registered) |

## Related Skills

- `polymorphic-discriminator-discipline` — sister skill for the `refPath` enum + shared-constants pattern
- `legacy-field-deprecation` — for retiring drifting dual-ref fields
- `safe-refactor-strategy` — the wrap-and-improve umbrella
- `idempotent-data-migration` — for the `"Customer"`→`"User"` backfill script

---
name: legacy-field-deprecation
description: Retire duplicated or legacy Mongoose schema fields (Order.payment.*, User.walletBalance, Transaction collection, Order.deliveryPartner) using the canonical "sync hook + deprecate + soak + drop" pattern. Preserves backward compatibility for the entire transition window (>=30 days). Use when the user mentions "deprecate field", "remove legacy", "drop field", "two sources of truth", "schema migration", or during Phase 4 and Phase 7 of the database audit plan.
---

# Legacy Field Deprecation

## Purpose

Remove fields that duplicate authoritative data — without breaking the API, without losing data, without downtime, and without coordinating client releases. The pattern is named "sync hook + deprecate + soak + drop".

This skill is the *only* approved way to retire a Mongoose schema field in this codebase. Direct removal is forbidden until the field has soaked through all four phases.

## When To Use

- Two fields hold the same value (e.g. `Order.payment.status` and `Order.paymentStatus`)
- A nested doc duplicates a top-level field (e.g. `Order.pricing` and `Order.paymentBreakdown`)
- A balance is mirrored in two places (`User.walletBalance` vs `Wallet.availableBalance`)
- A whole collection is being replaced (`Transaction` → `LedgerEntry`)
- A FK has a legacy alias (`Order.deliveryPartner` vs `Order.deliveryBoy`)
- The user mentions "deprecate", "remove", "drop", "legacy", "two sources of truth"
- Phase 4 or Phase 7 tickets of `database_audit_plan_part3.md`

## The Four Stages

```
[Stage A] Identify canonical    →    decide which field/collection becomes the source of truth
[Stage B] Sync hook              →    pre('save') + pre('findOneAndUpdate') hooks mirror writes both ways
[Stage C] Read migration         →    every read site switches to the canonical field
[Stage D] Soak                   →    >= 30 days in production with zero reads on the legacy field
[Stage E] Drop                   →    remove the legacy field + schema in a Phase 7 PR
```

Each stage ships as a separate PR. Phase 4 of the audit plan covers Stages A-C. Phase 7 covers Stages D-E.

## Stage A — Pick The Canonical

For every duplicated pair, decide:

1. **Which field has stronger invariants?** (typed enum, validation, foreign-key relationship)
2. **Which field is referenced by more recent code?** (recent commits, new features)
3. **Which field has indexes pointing at it?**

Document the decision in the schema:

```js
// app/models/order.js
{
  // CANONICAL — single source of truth from Phase 4 onwards.
  paymentStatus: {
    type: String,
    enum: PAYMENT_STATUS_VALUES,
    default: PAYMENT_STATUS.CREATED,
    index: true,
  },

  /**
   * @deprecated since Phase 4. Mirrors `paymentStatus` via pre-save hook.
   * Removed in Phase 7 after 30-day soak. Do not write directly.
   */
  payment: {
    method: { type: String, default: 'COD' },
    status: { type: String, enum: ['pending','completed','failed','refunded'], default: 'pending' },
    transactionId: { type: String, default: null },
  },
}
```

## Stage B — Sync Hooks (Both Ways)

The sync hook keeps the legacy field aligned with the canonical so old readers continue to work. New writes target either field; the hook propagates.

### `pre('save')` example

```js
orderSchema.pre('save', function(next) {
  if (this.isModified('paymentStatus')) {
    this.payment ||= {};
    this.payment.status = mapCanonicalToLegacy(this.paymentStatus);
  }
  if (this.isModified('payment.status') && !this.isModified('paymentStatus')) {
    this.paymentStatus = mapLegacyToCanonical(this.payment.status);
  }
  next();
});

function mapCanonicalToLegacy(canonical) {
  return canonical === 'PAID'      ? 'completed' :
         canonical === 'REFUNDED'  ? 'refunded'  :
         canonical === 'FAILED'    ? 'failed'    :
                                     'pending';
}
function mapLegacyToCanonical(legacy) {
  return legacy === 'completed' ? 'PAID'     :
         legacy === 'refunded'  ? 'REFUNDED' :
         legacy === 'failed'    ? 'FAILED'   :
                                  'CREATED';
}
```

### `pre('findOneAndUpdate')` example (the silent killer)

`save()` hooks fire only for `.save()`. `findOneAndUpdate()` bypasses them. **Add a second hook** for every update path:

```js
orderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate() || {};
  const $set = update.$set || update;

  if ($set.paymentStatus && !$set['payment.status']) {
    $set['payment.status'] = mapCanonicalToLegacy($set.paymentStatus);
  }
  if ($set['payment.status'] && !$set.paymentStatus) {
    $set.paymentStatus = mapLegacyToCanonical($set['payment.status']);
  }
  next();
});
```

Test both code paths. Forgetting `findOneAndUpdate` is the most common bug in this pattern.

### Cross-collection sync (Wallet ↔ User.walletBalance)

When the legacy field lives on a different document, the sync happens inside `walletService`:

```js
// inside creditWallet, after Wallet.save:
if (ownerType === OWNER_TYPE.CUSTOMER) {
  await User.findByIdAndUpdate(
    ownerId,
    { $inc: { walletBalance: signedAmount } },
    { session },
  );
}
```

This is the bridge that keeps `User.walletBalance` (legacy) accurate until Phase 7 drops it.

## Stage C — Read Migration

Every read of the legacy field migrates to the canonical. Use grep to enumerate:

```bash
rg "\.payment\.(method|status|transactionId)" --type js app/
rg "user\.walletBalance" --type js app/
rg "from\s+['\"].*models/transaction" --type js app/
rg "\.deliveryPartner" --type js app/
```

For each hit, switch to the canonical and **add a helper** if multiple call sites need the same fallback:

```js
// app/services/finance/walletService.js
export async function getCustomerBalance(userId, { session } = {}) {
  const wallet = await Wallet.findOne({ ownerType: 'CUSTOMER', ownerId: userId }).session(session);
  if (wallet) return wallet.availableBalance;
  // Fallback for users not yet backfilled (rare after Phase 4 migration script).
  const user = await User.findById(userId).select('walletBalance').session(session);
  return user?.walletBalance ?? 0;
}
```

The fallback removal is a separate Phase 7 commit, gated on backfill completion.

## Stage D — Soak

Before dropping anything:

1. Add a metric `legacy_field_read_total` that increments whenever the legacy field is read in production.
2. Wait until the counter is **zero for ≥ 30 consecutive days**.
3. Confirm no client/app version still on the road reads the legacy field (frontend log analysis or API gateway header inspection).
4. Run the production audit script from `database_audit_plan_part4.md` §M7-1 to confirm zero recent writes that bypassed the canonical.

If any of these fail, extend the soak. **The soak window is non-negotiable.**

### How To Add The Read Counter

```js
// app/models/order.js — opt-in instrumentation, removed at drop time
const _origGetter = orderSchema.path('payment').getters.slice();
orderSchema.path('payment').getters.length = 0;
orderSchema.path('payment').get(function(v) {
  metrics.increment('legacy_field_read_total', { field: 'order.payment' });
  return _origGetter.reduce((acc, g) => g.call(this, acc), v);
});
```

Or simpler: log-sample at the controller boundary when the field is included in the response.

## Stage E — Drop

In **one PR per legacy field**, in this order:

1. Run an `unset` migration to strip the field from existing docs (idempotent).
2. Remove the field declaration from the schema.
3. Remove the sync hooks for that field.
4. Remove the read fallback helper.
5. Remove the instrumentation counter.

```js
// scripts/drop-order-payment-nested.js
await Order.collection.updateMany({}, { $unset: { payment: '' } });
```

```diff
- payment: {
-   method: { type: String, default: 'COD' },
-   status: { type: String, enum: [...], default: 'pending' },
-   transactionId: { type: String, default: null },
- },
```

## Legacy Field Catalog For This Codebase

From `database_audit_plan_part1.md` §0.1 and Part 3 Phase 4/7:

| Legacy field/collection | Canonical | Sync hook owner | Stage at start of Phase 4 |
|---|---|---|---|
| `Order.payment.method` | `Order.paymentMode` | `order.js` pre-save | A (decide) → B (hook) → C (read switch) |
| `Order.payment.status` | `Order.paymentStatus` | `order.js` pre-save + pre-findOneAndUpdate | A → B → C |
| `Order.payment.transactionId` | `Payment.gatewayTransactionId` (collection lookup) | None (read-only mirror) | C |
| `Order.pricing.total` | `Order.paymentBreakdown.grandTotal` | `order.js` pre-save | A → B → C |
| `Order.pricing.deliveryFee` | `Order.paymentBreakdown.deliveryFee` | same | same |
| `Order.deliveryPartner` | `Order.deliveryBoy` | `order.js` pre-save | B → C |
| `User.walletBalance` | `Wallet.availableBalance` (where `ownerType:'CUSTOMER'`) | `walletService` | B (cross-coll sync) → C |
| `Transaction` collection | `LedgerEntry` collection | None — backfill once + dual-write | C (after backfill) |
| `User.otp*` inline fields | `OtpSession` collection | None — controllers switch entry point | C |
| `Delivery.otp*` inline fields | `OtpSession` | same | C |
| `OfferSection.categoryId` (singular) | `OfferSection.categoryIds[]` (array) | `offer.js` pre-save | B → C |
| `Notification.recipient` / `recipientModel` | `Notification.userId` / `role` | `notification.js` pre-save | B → C (already partial) |

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Removing a field in the same PR that adds the canonical | Breaks rollback path | Strict four-stage sequence |
| `pre('save')` hook only — no `findOneAndUpdate` hook | Updates via `findByIdAndUpdate` skip the hook; drift accumulates | Always pair both hook types |
| Dropping a column before zero-reads is confirmed | Production 500s on legacy read sites | 30-day soak with metric |
| Removing the read fallback before backfill completes | Users without backfilled rows see balance 0 | Fallback stays until backfill script reports 100% |
| One-way mirror only (canonical → legacy) | Code that writes legacy directly drifts forever | Bi-directional mirror, then enforce single-writer in Stage C |
| Aliased getter that points to canonical | Save reads still return legacy; appears to work then explodes on update | Real field with hook, not a virtual alias |
| Hook silently swallows enum mismatches | Drift goes undetected | Hook throws on unknown mapping |
| `@deprecated` JSDoc without instrumentation | No way to know when it's safe to drop | Always pair JSDoc with read counter |
| Same PR removes hook + field | Some replicas may still call the hook | Remove field first, hook one PR later |

## Backward Compatibility

- API response shapes preserved at every stage — legacy field still serialized while hook is alive.
- Frontend can migrate to canonical at any pace during Stage D.
- Mobile apps on old API versions continue receiving the legacy field through the entire soak.
- The Stage E drop is the **first** stage that breaks compatibility, and only for fields confirmed unread.

## Rollback Per Stage

| Stage | Rollback |
|---|---|
| A | Revert schema deprecation JSDoc — no behavior change |
| B | Revert hook commit — fields drift again but reads still work |
| C | Revert read migration — slightly stale reads from canonical |
| D | No code change — extend soak by adjusting calendar |
| E | Re-add the schema field with `default: null` — **data is gone**; recover from archive collection or `mongodump` snapshot |

## Sequencing With The Audit Plan

| Audit-plan ticket | Stage |
|---|---|
| P4-1 (strengthen Order sync hooks) | B |
| P4-2 (canonical read path) | C |
| P4-3 (User.walletBalance two-way sync via walletService) | B (cross-collection) |
| P4-4 (backfill Wallet for users with walletBalance > 0) | Prereq for C → D |
| P4-5 (backfill LedgerEntry from Transaction) | Prereq for retiring Transaction |
| P4-6 (walletAdminService reads from ledger) | C |
| P4-7 (deprecate `Order.payment.*` in JSDoc) | A |
| P4-8 (reverse virtuals — additive) | Optional aid for Stage C |
| P4-9 (deprecate Order.deliveryPartner) | A → B |
| P7-1 to P7-9 | E |

## Related Skills

- `mongoose-ref-integrity` — for deprecating fields whose `ref` was wrong
- `idempotent-data-migration` — for backfill scripts that prep Stage C
- `wallet-ledger-atomicity` — for the cross-collection sync of `User.walletBalance`
- `safe-refactor-strategy` — for the underlying "wrap, never rewrite" discipline

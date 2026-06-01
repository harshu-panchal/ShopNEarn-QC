---
name: soft-delete-cascade-pattern
description: Standardize soft-delete across the codebase using a deletedAt / deletedBy / updatedBy triad plus a pre('find') hook that auto-filters tombstoned documents, with explicit opt-in via __includeDeleted for admin views. Defines per-entity cascade rules (customer soft-delete prunes cart and wishlist but never touches financial documents). Use when adding soft-delete to a new model, when the user mentions "soft delete", "deletedAt", "cascade", "tombstone", "audit fields", or during Phase 6 of the database audit plan.
---

# Soft-Delete & Cascade Pattern

## Purpose

A consistent, project-wide soft-delete contract:

- Every financially-relevant or user-facing entity carries `deletedAt`, `deletedBy`, `updatedBy`.
- Reads automatically filter tombstoned rows via a `pre('find')` hook.
- Admin/audit views opt in via `__includeDeleted: true`.
- Cascades are **explicit** — defined per entity, not magic.
- Financial records are never soft-deleted; they are retained for audit even when the actor is deleted.

This skill is the only approved way to introduce soft-delete in this codebase.

## When To Use

- A schema lacks `deletedAt` but needs it (Order, Payment, Coupon, Product, …)
- The user mentions "soft delete", "tombstone", "deletedAt", "cascade", "retention"
- A delete operation must prune dependent docs (cart on user soft-delete)
- Phase 6 tickets (P6-1 to P6-9) of `database_audit_plan_part3.md`

## The Audit-Field Triad

All three fields are nullable so existing rows survive the migration:

```js
import { Schema } from 'mongoose';

const auditFields = {
  deletedAt: { type: Date,                  default: null, index: true },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
};

// Apply to every targeted schema
orderSchema.add(auditFields);
paymentSchema.add(auditFields);
// ...
```

| Field | Purpose | Set by |
|---|---|---|
| `deletedAt` | Tombstone timestamp; `null` ⇒ alive | `softDelete()` helper |
| `deletedBy` | Admin who performed the delete | `softDelete()` helper |
| `updatedBy` | Admin who last edited (audit-only writes) | Admin route middleware |

## The Soft-Delete Hook

One hook pattern, applied to every soft-deletable model:

```js
// Reusable helper
export function attachSoftDelete(schema) {
  schema.add({
    deletedAt: { type: Date, default: null, index: true },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'Admin', default: null },
  });

  schema.pre(/^find/, function(next) {
    const q = this.getQuery();
    // Admin code passes __includeDeleted to inspect tombstones
    if (q.__includeDeleted) {
      delete q.__includeDeleted;
      return next();
    }
    // Only add filter when caller hasn't already specified a deletedAt clause
    if (q.deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
    next();
  });

  // Bypass helper for admin endpoints
  schema.statics.findIncludingDeleted = function(filter = {}, ...rest) {
    return this.find({ ...filter, __includeDeleted: true }, ...rest);
  };

  schema.methods.softDelete = async function(adminId, { session } = {}) {
    this.deletedAt = new Date();
    this.deletedBy = adminId;
    return this.save({ session });
  };
}
```

Usage:

```js
// app/models/product.js
import { attachSoftDelete } from '../utils/softDelete.js';
attachSoftDelete(productSchema);
```

## When To Soft-Delete vs Hard-Delete vs Status-Flag

Three distinct concepts, do not mix:

| Pattern | Use for | Example |
|---|---|---|
| **Soft-delete** (`deletedAt`) | Entity is retired by an admin; should disappear from default lists but remain queryable for audit | `Product`, `Coupon`, `User`, `Seller`, `Delivery` |
| **Hard-delete** | Ephemeral state; no audit value retained | `Cart` items, `Wishlist` entries, `OtpSession`, `PushToken` |
| **Status flag** (`status: 'active' / 'inactive' / 'suspended'`) | Lifecycle state distinct from existence | `Product.status`, `Order.status`, `Wallet.status` |

A `Product` with `status: 'inactive'` is hidden from the storefront but might still be eligible for re-activation. A `deletedAt` product is gone.

**Financial records are exempt from soft-delete.** `Order`, `Payment`, `Transaction`, `LedgerEntry`, `Payout`, `Wallet`, `FinanceAuditLog` — these models carry `deletedAt` for **API uniformity** but the field is set only via emergency procedures (legal mandate, manual reconciliation). Routine "user deletes their account" never touches them.

## Cascade Rules — Explicit, Per Entity

Soft-deleting a user does **not** ripple through every collection. Each cascade is defined by hand in a `Lifecycle` service.

```js
// app/services/lifecycle/userLifecycleService.js
import mongoose from 'mongoose';
import User      from '../../models/customer.js';
import Cart      from '../../models/cart.js';
import Wishlist  from '../../models/wishlist.js';
import PushToken from '../../models/pushToken.js';
import { FinanceAuditLog } from '../../models/financeAuditLog.js';
import { FINANCE_AUDIT_ACTION } from '../../constants/finance.js';

export async function softDeleteCustomer(userId, adminId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user || user.deletedAt) return;

      // 1. Tombstone the user
      user.deletedAt = new Date();
      user.deletedBy = adminId;
      await user.save({ session });

      // 2. Hard-delete ephemeral state
      await Cart    .deleteOne ({ customerId: userId }, { session });
      await Wishlist.deleteOne ({ customerId: userId }, { session });
      await PushToken.deleteMany({ userId, role: 'customer' }, { session });

      // 3. Order, Payment, LedgerEntry — NEVER TOUCHED. Financial retention.

      // 4. Audit
      await FinanceAuditLog.create([{
        action:    FINANCE_AUDIT_ACTION.ENTITY_DELETED,
        actorType: 'ADMIN',
        actorId:   adminId,
        metadata:  { entityType: 'User', entityId: userId },
      }], { session });
    });
  } finally {
    session.endSession();
  }
}
```

| Entity soft-deleted | Cascade target | Action |
|---|---|---|
| **User** | `Cart` | hard delete |
| | `Wishlist` | hard delete |
| | `PushToken` | hard delete (role: customer) |
| | `OtpSession` | TTL handles expiry; no explicit action |
| | `Order` | NEVER TOUCH — financial retention |
| **Seller** | `Product` | soft delete all products with that seller |
| | `Order` (open) | NEVER TOUCH; existing orders fulfill normally; new orders blocked at write |
| **Delivery** | `DeliveryAssignment` | leave; let active assignments resolve |
| | `Order` | NEVER TOUCH |
| **Product** | `Cart.items` | `$pull` matching productId |
| | `Wishlist.products` | `$pull` matching productId |
| | `Order.items` | NEVER TOUCH — orders are historical |
| **Category** | `Product` | block deletion if any active product references; require reassignment first |
| **Coupon** | `Order` | NEVER TOUCH |

Cascades are always:

1. **Encapsulated** in a service function (never inline in controllers).
2. **Transactional** — use `mongoose-transaction-wrap` skill.
3. **Audit-logged** — `FinanceAuditLog` row per cascade event.

## Audit Hard-Deletes

Wherever `Model.deleteOne / deleteMany / findByIdAndDelete` is called, route through a `recordDeletion` helper:

```js
export async function recordDeletion(modelName, doc, actorId, { session } = {}) {
  await FinanceAuditLog.create([{
    action:    FINANCE_AUDIT_ACTION.ENTITY_HARD_DELETED,
    actorType: 'ADMIN',
    actorId,
    metadata:  { modelName, docId: doc._id, snapshot: doc.toObject?.() ?? doc },
  }], { session });
  await mongoose.model(modelName).deleteOne({ _id: doc._id }, { session });
}
```

Use a CI grep rule that flags raw `.deleteOne(`/`.deleteMany(` calls outside `app/services/lifecycle/` and `app/scripts/`.

## Admin Endpoints That Show Deleted Rows

Admin list endpoints frequently want to see tombstoned rows. Pass `__includeDeleted` explicitly:

```js
// app/controller/admin/userController.js
export const listAllUsers = async (req, res) => {
  const includeDeleted = req.query.includeDeleted === 'true';
  const query = includeDeleted
    ? User.findIncludingDeleted({})
    : User.find({});
  const users = await query.sort({ createdAt: -1 }).limit(100);
  res.json({ data: users });
};
```

Never make the default include deleted — that defeats the purpose of the hook.

## Customer-Facing Endpoints

The hook is opt-out, not opt-in. Customer-facing endpoints automatically exclude tombstones. No code change needed in controllers when the hook is attached.

## Common Pitfalls With The Pre-Find Hook

1. **`/^find/` matches every find variant**: `find`, `findOne`, `findById`, `findOneAndUpdate`, `findOneAndDelete`. Use this regex unless you have a specific reason.
2. **`findOneAndUpdate` callers may inadvertently revive a tombstone** if they don't include `deletedAt: null` in the filter. The hook adds the filter automatically, so an update on a soft-deleted doc returns `null` (correct).
3. **Aggregation pipelines bypass the hook.** Every `Model.aggregate([...])` must include `{ $match: { deletedAt: null } }` as its first stage unless intentionally including tombstones.
4. **`updateMany` / `deleteMany` may bypass the hook depending on Mongoose version.** Always include `deletedAt: null` explicitly in their filters.

## Three-Level Category Chain Validation

A specialized pre-save invariant (Phase 6 ticket P6-5):

```js
productSchema.pre('save', async function(next) {
  if (this.isModified('headerId') || this.isModified('categoryId') || this.isModified('subcategoryId')) {
    const [header, cat, sub] = await Promise.all([
      mongoose.model('Category').findById(this.headerId     ).select('type parentId'),
      mongoose.model('Category').findById(this.categoryId   ).select('type parentId'),
      mongoose.model('Category').findById(this.subcategoryId).select('type parentId'),
    ]);
    if (!header || header.type !== 'header')                     return next(new Error('headerId must reference a header'));
    if (!cat    || cat.type    !== 'category'   || String(cat.parentId) !== String(header._id))
                                                                   return next(new Error('categoryId must descend from headerId'));
    if (!sub    || sub.type    !== 'subcategory'|| String(sub.parentId) !== String(cat._id))
                                                                   return next(new Error('subcategoryId must descend from categoryId'));
  }
  next();
});
```

Same shape applies anywhere a parent-child chain must hold: order workflow status, return workflow, etc.

## Setting Singleton Enforcement

Where exactly one row is allowed (e.g. `Setting`), a pre-save invariant:

```js
settingSchema.pre('save', async function(next) {
  if (this.isNew && !this.tenantId) {
    const existing = await mongoose.model('Setting').findOne({ tenantId: null });
    if (existing) return next(new Error('Default Setting document already exists'));
  }
  next();
});
```

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Soft-deleting a financial document | Breaks audit retention | `Order`/`Payment`/`LedgerEntry`/`Payout` are exempt |
| Hook missing the `^` anchor on the regex | Only matches `find` literally, not `findOne` etc. | Use `/^find/` |
| Aggregation without `$match: { deletedAt: null }` first stage | Returns tombstoned rows | Always prefix the pipeline |
| Implicit cascade via global hooks | Surprises and bugs | Explicit cascade in a `Lifecycle` service |
| `Cart` carrying `deletedAt` | Cart is ephemeral; hard-delete is fine | No soft-delete on cart |
| `User.deletedAt = new Date()` without `deletedBy` | Cannot audit who did it | Always require admin id at the call site |
| Hard-delete bypassing `recordDeletion` | No audit trail | CI grep + lifecycle services only |
| Migration that sets `deletedAt` for existing rows | Data tombstoned by accident | Default value `null`, never backfill |
| Reading via `Model.findOne({ deletedAt: null }).where({})` (redundant filter) | Confuses the hook | Trust the hook; pass `__includeDeleted: true` only when needed |
| Cascade not transactional | Half-delete on failure | Always run cascade inside `withTransaction` |

## Backward Compatibility

- All new fields are nullable; existing rows continue working.
- Default queries change behavior (tombstones now hidden). Audit existing call sites for any that today rely on seeing inactive rows.
- The shift is one PR per model; feature-flag (`SOFT_DELETE_FILTERS_ENABLED=true`) recommended during initial rollout.

## Rollback

| Change | Rollback |
|---|---|
| Audit triad fields added | Schema rollback — fields remain in data but unread |
| Pre-find hook attached | Remove the hook OR set `SOFT_DELETE_FILTERS_ENABLED=false` |
| Cascade service introduced | Revert the service file; controllers continue to handle deletes manually (old behavior) |
| Hard-delete audit helper | Revert the wrapper; raw `deleteOne` returns to use |

## Sequencing With The Audit Plan

| Audit-plan ticket | Skill section |
|---|---|
| P6-1 (add audit fields) | Audit-field triad |
| P6-2 (pre-find filter) | Soft-delete hook + admin opt-in |
| P6-3 (customer soft-delete cascade) | Cascade rules + worked example |
| P6-4 (product moderation cascade) | Cascade rules |
| P6-5 (three-level category chain) | Pre-save invariant section |
| P6-6 (Setting singleton) | Pre-save invariant section |
| P6-7 (CouponUsage tracking) | Out of scope here — uses idempotent-data-migration |
| P6-8 (audit hard-deletes) | Audit hard-deletes helper |
| P6-9 (Ticket message archival) | Out of scope here — separate archival service |

## Related Skills

- `mongoose-transaction-wrap` — required for transactional cascades
- `legacy-field-deprecation` — for retiring `status: 'inactive'` style soft-delete in favor of `deletedAt`
- `idempotent-data-migration` — when backfilling `deletedAt` for legacy rows that used a different convention
- `safe-refactor-strategy` — phased rollout discipline

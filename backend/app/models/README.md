# Models — Conventions & Reference

Living guide for the Mongoose schema layer. Update this file whenever a
new convention is introduced.

---

## 1. Foreign-key naming

The codebase uses two conventions for foreign-key fields. Both are valid.
Pick the one that matches the **owner** of the relationship — do not mix.

### 1a. Bare-name form

When the FK is the **principal reference** for the document and the
parent's own `_id` already identifies the record, use the bare reference
name (no suffix).

```js
// Order.customer points at the User. The Order's own _id is the order's
// identity; `customer` is just the buyer.
customer: { type: ObjectId, ref: "User", required: true }
```

Used in: `Order.customer`, `Order.seller`, `Order.deliveryBoy`,
`Transaction.user`, `Payout.beneficiaryId` (historically — see §3).

### 1b. `<entity>Id` form

When the FK lives alongside the parent's own primary identifier and the
collection's purpose is to bundle entities together, use the `<entity>Id`
suffix to disambiguate.

```js
// A cart belongs to one customer; the cart has its own _id, and stores
// per-customer state. `customerId` is the explicit FK.
customerId: { type: ObjectId, ref: "User", required: true, index: true }
```

Used in: `Cart.customerId`, `Wishlist.customerId`,
`Product.{categoryId, subcategoryId, sellerId}`, `Notification.userId`,
`Wallet.ownerId`, `LedgerEntry.actorId`.

### 1c. Decision matrix

| Situation | Convention |
|---|---|
| Document represents a transaction / log / record that **happens to** the entity | bare name (`Order.customer`, `Transaction.user`) |
| Document is **owned by** the entity and aggregates that entity's data | `<entity>Id` (`Cart.customerId`, `Wishlist.customerId`) |
| Document points at multiple entities of different types via `refPath` | use both the discriminator + the bare or suffixed name consistently within the schema |

Do not rename existing fields to "fix" the convention — both forms are
correct, and a rename is a breaking change to every API consumer. New
fields SHOULD follow the dominant convention used in their parent
schema.

---

## 2. Polymorphic refs (`refPath` discriminator)

Polymorphic references use a sibling field that names the target model.
Pair these field names consistently:

| Owner field | Discriminator field | Convention |
|---|---|---|
| `Transaction.user` | `Transaction.userModel` | `<field>Model` |
| `Notification.recipient` | `Notification.recipientModel` | `<field>Model` |
| `Notification.userId` | `Notification.role` (string role) | `<field>` + role-string |
| `MediaMetadata.uploadedBy` | `MediaMetadata.uploadedByModel` | `<field>Model` |
| `LedgerEntry.actorId` | `LedgerEntry.actorType` | `<field>Type` (semantic role, not model name) |
| `Ticket.userId` | `Ticket.userType` | `<field>Type` |
| `Payout.beneficiaryId` | `Payout.beneficiaryModel` *(new in Phase 5 P5-4)* | `<field>Model` |

`actorType` / `userType` carry **semantic role names** that may or may
not match Mongoose model names — they exist primarily for filtering and
analytics. The other forms carry **actual Mongoose model names** and
work with `populate()` via `refPath`.

### Canonical model names

Single source of truth: `app/constants/refModels.js`.

```js
export const USER_MODEL_NAMES = Object.freeze({
  USER: "User",
  SELLER: "Seller",
  DELIVERY: "Delivery",
  ADMIN: "Admin",
});
```

Legacy values (`"Customer"`, `"Rider"`) still appear in historical rows.
The Phase 5 migration script
(`backend/scripts/migrate-customer-to-user-discriminator.js`) rewrites
every occurrence to the canonical form. Schemas that hold such data
declare their enum as `ALL_USER_MODEL_NAMES_WITH_LEGACY` (canonical +
legacy) during the migration window; Phase 7 narrows them.

---

## 3. Deprecated / legacy fields

The fields below are **read-only mirrors** maintained for frontend
compatibility. New writes should target the canonical field. Each is
annotated with `@deprecated` JSDoc on the schema.

| Legacy field | Canonical replacement | Notes |
|---|---|---|
| `Order.payment.method`, `Order.payment.status` | `Order.paymentMode`, `Order.paymentStatus` | Sync hooks (Phase 4 P4-1) keep them aligned on every `findOneAndUpdate`. |
| `Order.pricing.*` | `Order.paymentBreakdown.*` | Frozen finance snapshot. New flows write canonical only. |
| `Order.deliveryPartner` | `Order.deliveryBoy` | Mirror in both directions via pre('save') and pre('findOneAndUpdate') (Phase 4). |
| `User.walletBalance` | `Wallet({ownerType:"CUSTOMER"}).availableBalance` via `walletService.getCustomerBalance(userId)` | `walletService` (Phase 4 P4-3) auto-mirrors. |
| `Transaction` collection | `LedgerEntry` | Dual-written by some flows; Phase 4 P4-5 backfills history. |

Removal is scheduled for Phase 7, with a ≥ 30-day burn-in after the
sync hooks land.

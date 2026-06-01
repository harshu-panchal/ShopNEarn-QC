---
name: mongoose-transaction-wrap
description: Convert non-transactional multi-document write flows into atomic mongoose.startSession() + session.withTransaction() blocks. Every write inside the block carries { session }, the legacy callable signature is preserved, and rollback semantics are explicit. Use when extracting refund/return/cancellation flows, when the user mentions "half-refund", "partial write", "atomic order placement", "multi-doc transaction", or when an audit finds 3+ writes across different collections without a session.
---

# Mongoose Transaction Wrap

## Purpose

Any code path that mutates **two or more documents across different collections** must run inside one Mongoose session. Otherwise a mid-flight failure (network blip, validation error, process crash) leaves the database half-updated — half-refunded orders, orphan ledger entries, drifted wallets.

This skill provides the canonical wrapping pattern, identifies high-risk flows in this codebase, and codifies the rules for safe extraction.

## When To Use

- A controller / service performs `await Model.save()` two or more times on different models
- A failure midway through a flow would leave the DB in a state no automatic process repairs
- The user mentions "transactional", "atomic", "half-refunded", "partial write", "session"
- During Phase 2 of `database_audit_plan_part3.md` (return-refund flow, cancellation flow, delivery cash-collection flow)
- Before extracting any multi-write block from a controller into a service

## Prerequisite — Replica Set

MongoDB transactions require a replica set. Confirm before introducing the first transaction:

```js
db.runCommand({ replSetGetStatus: 1 });
```

If the connection is to a standalone server, `session.withTransaction()` throws `MongoServerError: Transaction numbers are only allowed on a replica set`. Phase 0 of the audit plan confirms this.

## The Canonical Wrap Template

```js
import mongoose from 'mongoose';

export async function applyXxx(arg, { actorId, actorType } = {}) {
  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      // 1. Read inside the session
      const doc = await Model.findById(arg).session(session);
      if (!doc) return;
      if (!isEligibleForXxx(doc)) return;

      // 2. Compute (pure, no side effects)
      const delta = computeDelta(doc);

      // 3. Writes — every call carries { session } or .session(session)
      await dependentService.applyEffect(doc, delta, { session });
      doc.status = 'next-state';
      await doc.save({ session });

      // 4. Audit log inside the same transaction
      await AuditLog.create([{ action: 'XXX_APPLIED', actorType, actorId, refId: doc._id }], { session });

      result = doc;
    }, {
      readConcern:  { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    });

    // 5. Post-commit side effects (notifications, queue jobs) — OUTSIDE the transaction
    if (result) {
      emitNotificationEvent(EVENT.XXX_DONE, { id: result._id });
    }
    return result;
  } finally {
    session.endSession();
  }
}
```

## The Seven Rules

1. **Every write inside the block passes `{ session }`.** Missing the session on even one write makes that write race-able and rollback-blind.
2. **No external side effects inside the block.** Notifications, queue enqueues, webhook calls happen **after** `withTransaction` resolves. They cannot be rolled back.
3. **Reads use `.session(session)`.** Otherwise you read pre-transaction snapshots and base writes on stale data.
4. **Use `readConcern: 'snapshot'` + `writeConcern: 'majority'`.** Matches the precedent in `orderPlacementService.js`.
5. **The closure is pure-ish.** Compute deltas inside. Validate inside. Throw inside to abort. Do not `console.log` business state mid-flight.
6. **Never call `session.startTransaction()` and `session.commitTransaction()` manually** when `withTransaction()` is available — it auto-retries on transient errors (MongoDB `TransientTransactionError`).
7. **Idempotency keys cross the session boundary.** If the caller may retry, pass `idempotencyKey` and let the unique partial index on `LedgerEntry`/`Payment` enforce single-effect.

## Codebase-Specific High-Risk Flows

Already enumerated in audit-plan Part 2/3. Each is a Phase 2 ticket:

| Flow | File / line | Writes per call | Current state | Target |
|---|---|---|---|---|
| Order placement | `orderPlacementService.js:276-450` | Order + Payment + Wallet + LedgerEntry + Transaction + Cart clear + CheckoutGroup update | **Already transactional** | Keep as reference |
| **Return-refund** | `orderController.js:949-1098` | Customer wallet credit + Transaction + Seller wallet debit + Transaction + Delivery wallet credit + Transaction + Order save | **Non-transactional** | Phase 2 P2-4 — extract to `orderRefundService.applyReturnRefund` |
| **Order cancellation** | `orderController.updateOrderStatus` | Stock reversal + payment refund + ledger + order save | Partial | Phase 2 P2-5 |
| **Delivery cash collection** | `deliveryController.js:162` | Order update + Wallet update + Transaction | Non-transactional | Phase 2 P2-6 |
| **Delivery withdrawal** | `deliveryController.js:313` | Wallet update + Transaction | Non-transactional | Phase 2 P2-6 |
| Payout queue/process | `payoutService.js` | Payout + Wallet + LedgerEntry | **Already transactional** | Keep as reference |
| Order finance settlement | `orderFinanceService.js` | Wallet + LedgerEntry + Order flags | **Already transactional** | Keep as reference |

## Extraction Sequence (Wrap & Improve)

A non-transactional inline block in a controller is extracted in **four small commits**, never one big PR:

### Commit 1 — Add the new service (no behavior change)

```js
// app/services/order/orderRefundService.js   NEW FILE
export async function applyReturnRefund(orderId, { actorId, actorType }) {
  // paste the existing inline logic verbatim — DO NOT add session yet
}
```

Old controller is unchanged. The new function is dead code. Safe deploy.

### Commit 2 — Switch controller to call the new service (still no transaction)

```js
// app/controller/orderController.js
import { applyReturnRefund } from '../services/order/orderRefundService.js';

export const applyRefund = async (req, res) => {
  const order = await applyReturnRefund(req.params.orderId, { actorId: req.user.id });
  // ...
};
```

Behavior identical. Rollback = revert this commit.

### Commit 3 — Wrap the service body in a session

Now apply the canonical template above. Every existing `.save()` gets `{ session }`. Every read gets `.session(session)`. Post-commit notifications move outside.

Tests must pass. Add a kill-switch test (see "Validation" below).

### Commit 4 — Lock the contract with a CI rule

Add a lint rule or pre-commit grep that fails if the new service is called outside of an HTTP context that already wraps in a session, or if `creditWallet`/`debitWallet` is called inside `orderController` directly (must go through the new service).

## Service vs Controller Boundary

| Concern | Controller | Service |
|---|---|---|
| Parse `req` | yes | no |
| Authorize | yes | no |
| Manage `session` | no | yes |
| Domain logic | no | yes |
| Build response | yes | no |
| Emit notifications | no — call returned event | yes (returns event payload) |

Controllers never call `mongoose.startSession()`. Services own that lifecycle.

## Validation — Did The Transaction Actually Roll Back?

Inject a fault and confirm zero partial state.

```js
test('refund rolls back fully on mid-flight ledger failure', async () => {
  // Arrange: a delivered order eligible for refund
  const order = await fixtures.deliveredOrder({ amount: 500 });
  jest.spyOn(LedgerEntry, 'create').mockRejectedValueOnce(new Error('boom'));

  // Act
  await expect(applyReturnRefund(order._id, { actorId: 'admin1' }))
    .rejects.toThrow('boom');

  // Assert — DB state untouched
  const after = await Order.findById(order._id);
  expect(after.returnStatus).not.toBe('refund_completed');
  const walletAfter = await Wallet.findOne({ ownerType: 'CUSTOMER', ownerId: order.customer });
  expect(walletAfter?.availableBalance ?? 0).toBe(0);
  expect(await LedgerEntry.countDocuments({ orderId: order._id })).toBe(0);
});
```

Every transactional flow added by this skill must have at least one fault-injection test.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| `await session.startTransaction(); ... session.commitTransaction();` | No auto-retry on transient errors | Use `session.withTransaction(callback)` |
| Calling external HTTP / queue inside the transaction | Side effect cannot be rolled back; can also deadlock | Capture intent inside, emit after commit |
| One write inside session, one outside | Half-rollback on failure | Either all inside or refactor to be eventually consistent |
| `Model.save()` without `{ session }` inside the block | Write is not part of the transaction | Always pass `{ session }` |
| Long-running transaction (> 60 s) | MongoDB aborts; lock contention | Pre-compute outside, write fast inside |
| Reading the same doc twice inside the session and re-saving | Lost updates | `Model.findOneAndUpdate({_id}, {$inc:{x:1}}, {session})` instead of read-modify-save |
| Wrapping idempotent reads in a transaction | Wasted overhead | Transactions are for writes only |
| Catching the abort error and continuing | Silent corruption | Let it propagate; controller catches and 5xx |
| Starting a transaction and forgetting `session.endSession()` | Connection leak | Always `try/finally` |
| Mixing transactional and non-transactional writes to the same doc | Read inconsistency | All writers go through the transactional path |

## Backward Compatibility

- Public response shape unchanged — controller still returns the same JSON.
- HTTP status codes unchanged.
- Existing error messages may shift slightly (Mongo abort errors). Test contract on error JSON.
- Idempotency keys are additive — old clients that don't send them still work.

## Rollback

- Each wrap is its own PR. Revert reverts the wrap; the inline copy still exists in git history but is no longer in the codebase.
- Until verified, **keep the old inline logic on a feature flag** (`USE_TRANSACTIONAL_REFUND=true|false`) for the first 24-48h.
- Once stable for one rollback window, remove the feature flag.

## Sequencing With The Audit Plan

| Audit-plan ticket | Skill section |
|---|---|
| P2-4 (return-refund extraction) | All — canonical example |
| P2-5 (order cancellation) | Extraction sequence applied per branch |
| P2-6 (delivery cash collection / withdrawal) | Extraction sequence |
| P2-7 (atomic coupon increment) | Special case — single-doc atomic via `findOneAndUpdate` aggregation pipeline; transactions not strictly needed |
| P2-8 (stock decrement audit) | Confirm `findOneAndUpdate({stock: {$gte: qty}}, {$inc: {stock: -qty}})` shape (single-doc atomic) |

## Related Skills

- `wallet-ledger-atomicity` — what to do **inside** the session for any wallet movement
- `idempotent-data-migration` — for retrying webhook handlers without double-effect
- `safe-refactor-strategy` — the wrap-then-improve sequencing
- `db-performance-hardening` — index and tracing concerns for transactional paths

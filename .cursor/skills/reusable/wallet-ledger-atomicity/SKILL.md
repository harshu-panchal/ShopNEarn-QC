---
name: wallet-ledger-atomicity
description: Enforce the invariant that every wallet mutation (credit, debit, pending-to-available, cash-in-hand adjustment) produces a matching LedgerEntry inside the same Mongoose session. Wallet movements outside the ledger are forbidden because they corrupt the audit trail and break finance reconciliation. Use when working in walletService, wallet-related controllers, refund/payout/cash-collection flows, when the user mentions "ledger gap", "wallet drift", "audit trail", "reconciliation", or during Phase 2 of the database audit plan.
---

# Wallet Ledger Atomicity

## Purpose

`Wallet` documents track current balance. `LedgerEntry` documents are the immutable audit trail of every movement. The invariant:

> **No wallet balance changes unless a matching `LedgerEntry` is created inside the same transaction.**

When this rule is violated, the ledger is incomplete. Reconciliation, refund disputes, and finance reports become unreliable. Once drift exists, recovery requires a forensic backfill against payment provider records.

This skill makes wallet movements ledger-aware by default and codifies the call-site contract.

## When To Use

- Editing any function in `app/services/finance/walletService.js`
- Adding any code that mutates `wallets` collection directly
- Refund, payout, cash collection, withdrawal flows
- The user mentions "ledger gap", "audit trail incomplete", "wallet drift", "missing ledger entry", "wallet reconciliation"
- During Phase 2 (tickets P2-1, P2-2, P2-3, P2-9) of `database_audit_plan_part3.md`
- Before any new feature that touches wallet balance

## The Three Layers

| Layer | File | Responsibility |
|---|---|---|
| **Balance** | `app/models/wallet.js` (`availableBalance`, `pendingBalance`, `cashInHand`) | Current state — overwritten on every movement |
| **Audit trail** | `app/models/ledgerEntry.js` | Immutable record — append-only, never updated |
| **Legacy ledger** | `app/models/transaction.js` | Deprecated mirror — written alongside until Phase 7 |

The skill's job is to make sure all three move in lockstep — never one without the others.

## The Canonical Wallet API

`walletService` is the **single funnel** for all wallet mutations. Direct `Wallet.findOneAndUpdate` from controllers is forbidden after Phase 2.

```js
// app/services/finance/walletService.js

export async function creditWallet({
  ownerType,                              // OWNER_TYPE.CUSTOMER | SELLER | DELIVERY_PARTNER | ADMIN
  ownerId,                                // ObjectId
  amount,                                 // positive number
  bucket = 'available',                   // 'available' | 'pending' | 'cashInHand'
  session,                                // REQUIRED inside transactional flows

  // Ledger metadata (required for production)
  ledgerType,                             // LEDGER_TRANSACTION_TYPE.*
  ledgerDirection = LEDGER_DIRECTION.CREDIT,
  ledgerReference = '',                   // human-readable reference (e.g. "REFUND-AZ-12345")
  ledgerDescription = '',
  orderId = null,
  payoutId = null,
  paymentMode = null,
  metadata = {},

  // Idempotency
  idempotencyKey = null,                  // unique per logical movement
  correlationId = null,                   // for tracing across services
}) {
  const normalizedAmount = assertPositiveAmount(amount);
  const wallet = await getOrCreateWallet(ownerType, ownerId, { session });
  if (wallet.status !== WALLET_STATUS.ACTIVE) throw new Error('Wallet is not active');

  const before = wallet[`${bucket}Balance`];
  wallet[`${bucket}Balance`] = addMoney(before, normalizedAmount);
  wallet.totalCredited = addMoney(wallet.totalCredited, normalizedAmount);
  await wallet.save({ session });

  if (ledgerType) {
    await createLedgerEntry({
      orderId, payoutId,
      walletId: wallet._id,
      actorType: ownerType, actorId: ownerId,
      type: ledgerType,
      direction: ledgerDirection,
      amount: normalizedAmount,
      status: LEDGER_STATUS.COMPLETED,
      paymentMode,
      balanceBefore: roundCurrency(before),
      balanceAfter:  roundCurrency(wallet[`${bucket}Balance`]),
      metadata: { ...metadata, bucket, idempotencyKey, correlationId },
      description: ledgerDescription,
      reference:   ledgerReference,
      idempotencyKey,
      correlationId,
    }, { session });
  } else if (process.env.NODE_ENV === 'production') {
    logger.warn('walletService.creditWallet called without ledgerType — audit gap', {
      ownerType, ownerId, amount, bucket,
    });
  }

  return { wallet, amount: normalizedAmount, before, after: wallet[`${bucket}Balance`], bucket };
}
```

Same shape for `debitWallet`, `movePendingToAvailable`, `updateCashInHand`. Each gains the ledger payload and writes alongside.

## The Caller Contract

Every call to `creditWallet` / `debitWallet` must pass:

- `ledgerType` — from `LEDGER_TRANSACTION_TYPE` in `constants/finance.js`
- `orderId` or `payoutId` — link to the originating entity
- `ledgerReference` — human-readable reference string for finance/ops
- `ledgerDescription` — one-line operator explanation
- `paymentMode` — when applicable (COD, ONLINE, WALLET)
- `session` — when called inside a transactional flow (it almost always should be)
- `idempotencyKey` — when the caller may retry (webhooks, queue workers)

### Worked Example — Return Refund

```js
await creditWallet({
  ownerType: OWNER_TYPE.CUSTOMER,
  ownerId:   order.customer,
  amount:    refundAmount,
  bucket:    'available',
  session,

  ledgerType:        LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
  ledgerDirection:   LEDGER_DIRECTION.CREDIT,
  ledgerReference:   `REFUND-${order.orderId}`,
  ledgerDescription: `Return refund for order ${order.orderId}`,
  orderId:           order._id,
  paymentMode:       order.paymentMode,
  idempotencyKey:    `REFUND-${order.orderId}-customer`,
  correlationId:     req?.correlationId,
});
```

If a webhook fires the same refund twice, the unique partial index on `LedgerEntry.idempotencyKey` rejects the duplicate at the DB level. Wallet is credited exactly once.

## Idempotency At The Schema Level

`LedgerEntry` schema must declare a **partial unique index** on `idempotencyKey`:

```js
ledgerEntrySchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
    name: 'idx_ledger_idempotency_partial',
  },
);
```

`partialFilterExpression` skips documents without an `idempotencyKey` so we can keep legacy rows. New code always sets one when the operation may retry.

## Call-Site Migration

| File | Lines | Operation | Required `ledgerType` | Phase |
|---|---|---|---|---|
| `orderController.js` | 1020-1077 | Return refund — customer credit, seller debit, rider credit | `WALLET_REFUND`, `REFUND`, `RIDER_PAYOUT_PROCESSED` | P2-2 + P2-4 |
| `orderWorkflowController.js` | 328 | Cash collection | `ORDER_COD_COLLECTED` | P2-2 |
| `orderFinanceService.js` | 349, 655, 766, 798 | Settlement | varies (already correct, audit only) | P2-2 |
| `orderPlacementService.js` | 445-446 | Wallet redemption | `WALLET_REFUND` (debit direction) | P1-2 + P2-2 |
| `deliveryController.js` | 162 | Cash collection | `ORDER_COD_COLLECTED` | P2-2 + P2-6 |
| `deliveryController.js` | 313 | Withdrawal | `WITHDRAWAL` | P2-2 + P2-6 |

## CI Lint — Enforce The Contract

Add a `scripts/check-ledger-coverage.js` script run by pre-commit:

```js
import { execSync } from 'node:child_process';

const hits = execSync('rg "(creditWallet|debitWallet)\\(" --json app/controller app/services').toString();
const callBlocks = parseRgJson(hits);

const violations = callBlocks.filter((block) => {
  const text = block.contextLines.join('\n');
  return !/ledgerType\s*:/.test(text);
});

if (violations.length > 0) {
  console.error('Wallet mutation without ledgerType:');
  violations.forEach((v) => console.error(`  ${v.file}:${v.line}`));
  process.exit(1);
}
```

This is the lock-in that prevents regression once Phase 2 lands.

## The Drift Verifier Cron

Phase 2 ticket P2-9 runs every 6 hours and samples 100 wallets:

```js
import { Wallet, LedgerEntry } from '../models';

export async function verifyWalletLedgerInvariant() {
  const wallets = await Wallet.aggregate([{ $sample: { size: 100 } }]);
  const drifts = [];

  for (const w of wallets) {
    const expected = await LedgerEntry.aggregate([
      {
        $match: {
          actorType: w.ownerType,
          actorId:   w.ownerId,
          status:    'COMPLETED',
        },
      },
      {
        $group: {
          _id:    null,
          credit: { $sum: { $cond: [{ $eq: ['$direction', 'CREDIT'] }, '$amount', 0] } },
          debit:  { $sum: { $cond: [{ $eq: ['$direction', 'DEBIT' ] }, '$amount', 0] } },
        },
      },
    ]);
    const expectedBalance = (expected[0]?.credit ?? 0) - (expected[0]?.debit ?? 0);
    const actual = (w.availableBalance ?? 0) + (w.pendingBalance ?? 0) + (w.cashInHand ?? 0);
    const drift = Math.abs(actual - expectedBalance);
    if (drift > 1) drifts.push({ walletId: w._id, owner: w.ownerType, actual, expectedBalance, drift });
  }

  if (drifts.length > 0) {
    logger.error('wallet.ledger.drift', { count: drifts.length, sample: drifts.slice(0, 5) });
    await emitFinanceAlert('WALLET_LEDGER_DRIFT', drifts);
  }
}
```

Feature-flag it: `FINANCE_VERIFIER_ENABLED=true`. Default off in dev, on in production.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Direct `Wallet.findOneAndUpdate({_id}, {$inc: {availableBalance: x}})` from a controller | No ledger entry; permanent audit gap | Funnel through `walletService` with `ledgerType` |
| Calling `creditWallet` without `ledgerType` | Production warn log + silent audit gap | Always pass `ledgerType` |
| Calling `creditWallet` without `session` inside a transactional flow | Wallet write happens outside the transaction | Always pass `session` when one exists |
| Writing `LedgerEntry` from a controller without going through `walletService` | Wallet state diverges from ledger | Wallet movement and ledger creation must originate together |
| Multiple wallet mutations across functions without a shared `session` | Half-rollback | Top-level orchestrator owns the session |
| Updating `Transaction` (legacy) but not `LedgerEntry` | New canonical ledger is incomplete | Phase 2 routes through `walletService` which writes both |
| Using `idempotencyKey` only sometimes | Inconsistent retry behavior | All retry-eligible callers pass it; webhooks always |
| Logging the credit/debit but not adding to ledger | Logs are not queryable as finance state | Log AND insert ledger |
| Crediting wallet outside any try/catch | Failure leaves wallet credited, downstream missed | Wrap in `withTransaction` (`mongoose-transaction-wrap` skill) |
| Reading `Wallet.availableBalance` and reporting it as the "ground truth balance" | Balance and ledger can diverge | Use ledger-derived balance for reports; treat Wallet as cache |

## Backward Compatibility

- `creditWallet`/`debitWallet` signatures gained optional fields. Old callers continue working with a warn log.
- After all call sites migrate, the warn becomes a hard throw — but only via a CI lint, not at runtime (no behavior change).
- `Transaction` collection (legacy) keeps receiving writes until Phase 4 backfill completes and Phase 7 archives.

## Rollback

| Change | Rollback |
|---|---|
| `walletService` ledger-aware variant | Revert the auto-create block; warn-log-only mode |
| Idempotency unique index on `LedgerEntry` | `db.ledgerentries.dropIndex('idx_ledger_idempotency_partial')` |
| Verifier cron | Set `FINANCE_VERIFIER_ENABLED=false`; no restart needed |
| CI lint | Remove from pre-commit hook |

## Sequencing With The Audit Plan

| Audit-plan ticket | Skill section |
|---|---|
| P2-1 (extend walletService) | Canonical wallet API |
| P2-2 (migrate call sites) | Call-site migration table + CI lint |
| P2-3 (idempotency on LedgerEntry) | Idempotency at schema level |
| P2-9 (verifier cron) | Drift verifier cron |
| P4-5 (backfill `LedgerEntry` from `Transaction`) | Pairs with `idempotent-data-migration` skill |

## Related Skills

- `mongoose-transaction-wrap` — the session wrapper that owns the wallet calls
- `idempotent-data-migration` — for the LedgerEntry backfill script
- `legacy-field-deprecation` — for retiring `User.walletBalance` and `Transaction`
- `db-performance-hardening` — index strategy for `LedgerEntry` reads

---
name: db-audit-execution-playbook
description: Orchestrate execution of the four-part database audit plan (database_audit_plan_part1.md through part4.md) phase-by-phase. Maps each Phase 0 - 7 ticket to the reusable skill that owns its methodology, defines per-phase acceptance gates, freeze windows, and rollback drills. Use when the user says "start phase 1", "execute the audit plan", "ship phase N of the database refactor", or when picking the next refactor ticket. Reads database_audit_plan_part*.md as the source of truth for tickets and acceptance criteria.
---

# Database Audit Execution Playbook

## Purpose

The audit plan in `database_audit_plan_part1.md` ... `part4.md` is the **what**. This skill is the **how to ship it safely**. It binds each phase ticket to the engineering skill that owns its methodology, defines a "definition of ready" and "definition of done" per phase, and codifies the freeze + canary + rollback rhythm.

This skill is the entry point for any session that touches the audit plan. Read this first, then jump to the per-phase block.

## When To Use

- The user says: "start phase X", "execute the database audit plan", "ship phase N", "what's next on the database refactor"
- A PR claims to implement an audit-plan ticket
- Picking the next refactor ticket from a sprint backlog
- Running the pre-flight check (Phase 0) for the first time
- Coordinating a finance freeze window for Phase 2 deploy

## Plan Documents — Source Of Truth

Read in this order. Don't paraphrase from memory; quote the document.

| File | Contents |
|---|---|
| `database_audit_plan_README.md` | Index of the four parts |
| `database_audit_plan_part1.md` | Executive summary, architecture, critical findings (C-1 to C-10), full model inventory |
| `database_audit_plan_part2.md` | Association graph, API ↔ DB mapping, orphan fields, request lifecycles |
| `database_audit_plan_part3.md` | Phased roadmap (Phase 0 → Phase 7), every ticket P0-x / P1-x / … with diffs and acceptance |
| `database_audit_plan_part4.md` | Migration scripts (M3-1, M4-1, M4-2, M5-1, …), testing checklist, rollback procedures, risk matrix |

Always cite the section number when answering. E.g. "Per `database_audit_plan_part3.md` Phase 2 ticket P2-4, …".

## Phase → Reusable Skill Map

Each phase delegates its engineering pattern to one or more reusable skills. The playbook owns sequencing and gates; the skills own the implementation.

| Phase | Effort | Risk | Primary skill | Supporting skills |
|---|---|---|---|---|
| **0 — Pre-flight verification** | 1d | None | (this playbook) | `db-performance-hardening` for the slow-query capture |
| **1 — Correctness fixes** | 2d | Low | `mongoose-ref-integrity` | `validation-middleware-standard` for P1-4 |
| **2 — Transactional & ledger integrity** | 4d | Med | `mongoose-transaction-wrap` + `wallet-ledger-atomicity` | `safe-refactor-strategy` for the extraction sequence |
| **3 — Index hygiene** | 2d | Low | `db-performance-hardening` | `idempotent-data-migration` for the drop-dead-indexes script |
| **4 — Schema canonicalization** | 1w | Med | `legacy-field-deprecation` | `idempotent-data-migration` for the backfills |
| **5 — Naming alignment** | 1w | Med | `polymorphic-discriminator-discipline` | `mongoose-ref-integrity` + `idempotent-data-migration` |
| **6 — Soft-delete & audit fields** | 3d | Low | `soft-delete-cascade-pattern` | `mongoose-transaction-wrap` for cascades |
| **7 — Final cleanup (drops)** | 2d | Med | `legacy-field-deprecation` (Stage E) | `idempotent-data-migration` for the unsets |

If a phase's primary skill conflicts with this map, the audit-plan document wins; update this map.

## Definition Of Ready Per Phase

Before opening the first PR for a phase, all of these must hold:

| Phase | Ready when |
|---|---|
| 0 | Read access to a recent prod replica is granted; finance/ops stakeholder identified |
| 1 | Phase 0 report committed; no surprises that downgrade or invalidate findings |
| 2 | Phase 1 merged + 24h staging soak passed; replica-set confirmed in `rs.status()`; finance freeze window scheduled |
| 3 | Phase 0 captured a slow-query baseline; index drop SOP reviewed |
| 4 | Phase 2 merged + 48h prod soak passed; canonical writers (`walletService` ledger-aware) live |
| 5 | Phase 1 merged (broken refs fixed); migration dry-run produced expected counts |
| 6 | Phase 2 merged (audit-log infra in place); admin endpoints inventory done |
| 7 | Phase 4 + 5 in production for **≥ 30 days** with zero reads on legacy fields; `mongodump` snapshot taken |

If any precondition is missing, the phase is **not ready**. Document why in the PR description and wait.

## Definition Of Done Per Phase

A phase is shippable to `main` only when **every** box is checked. The boxes are the acceptance criteria from `database_audit_plan_part3.md` §X.2 for that phase. Reproduced here per phase for quick reference.

### Phase 0 — Pre-flight Verification

- [ ] `db_preflight_report.md` committed
- [ ] All 15 queries from part3 §0.1 executed and results recorded
- [ ] Drift table reviewed by finance/ops stakeholder
- [ ] Any "elevated" finding (e.g. wallet drift > 1000 INR) escalated before Phase 1 starts

### Phase 1 — Correctness Fixes

- [ ] P1-1 — 3 × `ref:"Customer"` → `ref:"User"`, populate test green per ref
- [ ] P1-2 — `Transaction.type` enum extended, wallet-redemption order placement test green
- [ ] P1-3 — `Order.financeFlags` extended with `sellerPayoutHeld`, `returnPickupCommissionPaid`
- [ ] P1-4 — `cartValidation.js` + ≥ 4 other validation files wired into their routes
- [ ] P1-5 — `assertAllModelsRegistered()` called from boot path; CI fails on missing model
- [ ] Full test suite green; 24h staging soak

### Phase 2 — Transactional & Ledger Integrity

- [ ] P2-1 — `creditWallet`/`debitWallet` accept ledger args and create LedgerEntry when `ledgerType` passed
- [ ] P2-2 — Every call site enumerated in `wallet-ledger-atomicity` skill passes `ledgerType`
- [ ] P2-3 — `LedgerEntry` has `idempotencyKey` partial-unique index + `correlationId` field
- [ ] P2-4 — `applyReturnRefund` extracted to `orderRefundService`, fully transactional, fault-injection test green
- [ ] P2-5 — Order cancellation flow transactional
- [ ] P2-6 — Delivery cash-collection + withdrawal flows transactional
- [ ] P2-7 — Coupon increment atomic (aggregation-pipeline update or unique counter)
- [ ] P2-8 — Stock decrement uses atomic `findOneAndUpdate({stock:{$gte:qty}}, {$inc:{stock:-qty}})` (verified)
- [ ] P2-9 — Wallet ↔ ledger verifier cron deployed behind `FINANCE_VERIFIER_ENABLED=true`
- [ ] CI integration test: kill worker mid-refund — fully rolled back or fully complete, no half states

### Phase 3 — Index Hygiene

- [ ] P3-1 — `drop-dead-indexes.js` run in production during low-traffic window
- [ ] P3-2 — `databaseIndexManager.js` references real fields and real collections only
- [ ] P3-3 — No overlap between schema-declared and manager-declared indexes
- [ ] P3-4 — Missing performance indexes added (per Phase 0 slow-query report)
- [ ] P3-5 — Product search uses text index or anchored regex (no leading `.*`)
- [ ] P3-6 — `databaseIndexManager.verifyIndexes()` reports healthy at boot
- [ ] Slow query count > 100 ms drops by ≥ 50 % from Phase 0 baseline

### Phase 4 — Schema Canonicalization

- [ ] P4-1 — `Order` `pre('findOneAndUpdate')` syncs payment-status mirror
- [ ] P4-2 — `getCustomerBalance(userId)` helper added; legacy `user.walletBalance` read sites migrated
- [ ] P4-3 — Cross-collection sync: every customer wallet credit mirrors `User.walletBalance`
- [ ] P4-4 — `backfill-wallet-from-user-walletbalance.js` run; every customer with positive balance has a `Wallet` row
- [ ] P4-5 — `backfill-ledger-from-transactions.js` run; `LedgerEntry` row count matches expected backfill
- [ ] P4-6 — `walletAdminService` reads from `LedgerEntry`; frontend response shape unchanged
- [ ] P4-7 — `@deprecated` JSDoc on `Order.payment.*`, `Order.pricing.*`
- [ ] P4-8 — Reverse virtuals added; at least one consumer adopts
- [ ] P4-9 — `Order.deliveryPartner` deprecated; writes routed to `deliveryBoy`

### Phase 5 — Naming Alignment

- [ ] P5-1 — `app/constants/refModels.js` exists; exports `USER_MODEL_NAMES` + `ALL_USER_MODEL_NAMES`
- [ ] P5-2 — `notification.recipientModel`, `mediaMetadata.uploadedByModel`, `ticket.userType`, `otp.model.js userType` all import from `refModels.js`
- [ ] P5-3 — `migrate-customer-to-user-discriminator.js` run; `db.notifications.distinct("recipientModel")` returns canonical set only
- [ ] P5-4 — `Payout.beneficiaryModel` added with `refPath`; backfill complete
- [ ] P5-5 — `Payout.createdBy` declares `ref: "Admin"`
- [ ] P5-6 — All OTP login flows funnel through `otpAuthService` → `OtpSession`; inline OTP writes on `User`/`Delivery` ceased (observed for 7 days)
- [ ] P5-7 — `app/models/README.md` documents `xxxId` vs bare-form naming convention

### Phase 6 — Soft-Delete & Audit Fields

- [ ] P6-1 — `deletedAt`/`deletedBy`/`updatedBy` added to `Order`, `Payment`, `Transaction`, `LedgerEntry`, `Payout`, `Wallet`, `FinanceAuditLog`, `Coupon`
- [ ] P6-2 — `pre('find')` soft-delete hook on `User`, `Seller`, `Delivery`, `Product`, `Coupon`; admin opt-in via `__includeDeleted`
- [ ] P6-3 — `userLifecycleService.softDeleteCustomer` cascades cart + wishlist + push tokens; transactional + audit-logged
- [ ] P6-4 — Product moderation cascades cart `$pull`; verified
- [ ] P6-5 — `Product.pre('save')` validates three-level category chain
- [ ] P6-6 — `Setting.pre('save')` enforces singleton
- [ ] P6-7 — `CouponUsage` collection introduced; `perUserLimit` enforced inside order placement transaction
- [ ] P6-8 — Hard-delete grep returns zero hits outside `app/services/lifecycle/` and `app/scripts/`
- [ ] P6-9 — Ticket message archival in place

### Phase 7 — Final Cleanup

- [ ] **Precondition**: phases 4 + 5 in production ≥ 30 days; legacy-field-read counter at 0 for 30 consecutive days
- [ ] **Precondition**: `mongodump` snapshot taken < 24 h before run
- [ ] P7-1 — `Order.payment.*` removed via `$unset` migration + schema removal
- [ ] P7-2 — `Order.pricing.*` removed
- [ ] P7-3 — `Order.deliveryPartner` removed
- [ ] P7-4 — `User.walletBalance` removed
- [ ] P7-5 — `transactions` renamed to `transactions_archive`
- [ ] P7-6 — `otpverifications` archived
- [ ] P7-7 — Inline OTP fields removed from `User` and `Delivery`
- [ ] P7-8 — `OfferSection.categoryId` (singular) removed
- [ ] P7-9 — `Notification.recipient/recipientModel` removed (if `userId`/`role` is fully adopted)
- [ ] No production error spike for 7 days post-deploy

## Cross-Phase Themes (lift from part3 §CROSS-PHASE THEMES)

- **T1 Wrap and improve** — every refactor starts as a wrapper; legacy path stays warm until verified obsolete.
- **T2 Feature flags** — `FINANCE_VERIFIER_ENABLED`, `LEDGER_AUTO_CREATE_ON_WALLET`, `SOFT_DELETE_FILTERS_ENABLED`, `OTP_CONSOLIDATION_ENABLED`. Default the new path **off**.
- **T3 Observability** — every phase adds `correlationId` to structured logs, Prom metrics, Sentry breadcrumbs.
- **T4 Tests are the contract** — every acceptance criterion translates to a CI test. If tests are missing, the phase is not done.

## Per-Phase Freeze Windows

Some phases require coordinated freeze windows to avoid concurrent finance writes.

| Phase | Window | Why |
|---|---|---|
| 2 | 30 min low-traffic, finance-on-call paged | Wallet service change touches the canonical money path |
| 3 | 5 min low-traffic | Index drop is fast but disruptive on running queries |
| 4 (backfills) | 1-2 hour low-traffic, finance-on-call paged | LedgerEntry backfill writes O(N) rows |
| 5 (discriminator migration) | 15 min low-traffic | Discriminator updateMany is fast but holds collection-level intent locks |
| 7 (drops) | 30 min low-traffic, snapshot < 24 h old | Schema field removal is irreversible without snapshot restore |

No freeze for Phases 0, 1, 6 — those are code-only or additive.

## Rollback Drill Per Phase

For each phase, the PR description **must** include a rollback recipe with a stated time budget. Examples:

| Phase | Rollback | Time budget |
|---|---|---|
| 0 | N/A (read-only) | — |
| 1 | `git revert <commit>`; re-deploy | < 5 min |
| 2 | Disable feature flags (`FINANCE_VERIFIER_ENABLED=false`); revert call-site PR | < 5 min |
| 3 | Re-run `databaseIndexManager.createAllIndexes()` with the OLD config to re-create dropped indexes | < 10 min |
| 4 (sync hooks) | `git revert` the hook commits; legacy fields drift but reads still work | < 5 min |
| 4 (backfills) | Delete inserted LedgerEntry rows by `transactionId` filter | < 30 min |
| 5 (data) | Reverse-rename discriminator values (only meaningful before enum tightens) | < 30 min |
| 5 (schema) | `git revert` the enum-tightening PR; data already canonical | < 5 min |
| 6 | `git revert` the hook commits; `SOFT_DELETE_FILTERS_ENABLED=false` | < 5 min |
| 7 (drop) | **Data is gone** — restore from `mongodump`. Re-add field schemas with `default: null`. | 30 min to several hours |

## Sub-Agent Delegation Pattern

For sessions executing a single ticket end-to-end, follow this loop:

```
For each open ticket in the phase:
  1. Read the ticket spec from database_audit_plan_part3.md (the section number).
  2. Read the primary skill from the Phase → Skill map (above).
  3. Read any code paths the ticket modifies (cite line numbers from part1/part2).
  4. Open ONE PR per ticket.
  5. Verify the acceptance criteria for that ticket are all green (CI + manual).
  6. Document the rollback recipe in the PR description.
  7. Move to next ticket only after merge + soak.
```

Never open a PR that bundles two tickets — the rollback scope explodes.

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Skipping Phase 0 and going straight to Phase 1 | Some findings may be moot or more severe than the plan claims | Always run pre-flight on a recent prod replica |
| Reordering phases | Dependencies between phases are real (P5 needs P1, P4 needs P2) | Respect the dependency graph in part3 §DEPENDENCY ORDER SUMMARY |
| One PR per phase | Rollback blast radius is the whole phase | One PR per ticket |
| Tightening the discriminator enum before backfill | Production writes fail validation | Backfill ships first, schema PR second |
| Dropping fields in the same PR that introduced their replacement | No 30-day soak | Phase 7 is a separate sprint, period |
| Running migrations without `--dry-run` first | Untested write on prod | Always dry-run on staging then prod |
| Feature flag that defaults to the new path | Silent regression on deploy | Default new path off; opt-in until proven |
| Treating audit-plan paths as definitive without reading the doc | Line numbers and filenames drift | Always re-grep before quoting a line number |
| Skipping the verifier cron in Phase 2 | Drift goes undetected for weeks | Cron is part of the phase, not optional |

## Communication Template For PR Description

```md
## Phase X — Ticket PX-Y

### What
<one-paragraph summary>

### Audit-plan reference
- database_audit_plan_part3.md §X.Y / ticket PX-Y
- Critical finding(s) addressed: C-?, C-?

### Skill applied
- <skill name> — see .cursor/skills/reusable/<skill>/SKILL.md

### Acceptance criteria status
- [x] criterion 1
- [x] criterion 2
- [ ] criterion 3 — blocked on <reason>

### Rollback
- Command: <exact commands>
- Time budget: <minutes>
- Data impact: <none / reversible / requires snapshot restore>

### Soak window
- Staging: <date range>
- Production canary: <%, hours>
```

Every PR for the audit plan uses this template.

## Lifecycle Of This Skill

This is a **top-level** (non-`reusable/`) skill — it points at one specific multi-PR migration. After Phase 7 ships and soaks 30 days, this skill graduates to `.cursor/skills/archived/db-audit-execution-playbook/` per the conventions in `.cursor/skills/README.md`. Archived skills preserve the institutional memory of why the codebase looks the way it does post-migration.

## Related Skills

- All seven reusable skills referenced in the Phase → Skill map
- `safe-refactor-strategy` — the umbrella discipline
- `progressive-target-scaffolding` — the related scaffolding skill that prepared `app/domains/` for the future extraction work

# Appzeto Quick-Commerce — Production-Grade Database Audit & Implementation Plan

Four-part execution-ready plan to verify every API ↔ DB integration, fix correctness defects, restore single-source-of-truth across the finance layer, and consolidate duplicate models — all while preserving existing API contracts and supporting sub-30-minute rollback per phase.

> **Scope:** `backend/app/**`. Frontend touch-points noted only.
> **Total effort:** ~2 weeks active engineering + 30-day production soak + ~2 days final cleanup.
> **Approach:** wrap-and-improve. No phase removes a public field, route, or contract.

## How to read this plan

| File | What's in it | When to read |
|---|---|---|
| [`database_audit_plan_part1.md`](./database_audit_plan_part1.md) | Executive summary · architecture snapshot · top-10 critical findings · model-by-model inventory (37 schemas) | Read first. Section 0 is the elevator pitch. |
| [`database_audit_plan_part2.md`](./database_audit_plan_part2.md) | Association graph · API ↔ DB mapping per domain · orphan-field write catalog · request-lifecycle traces | Evidence base. Read after Part 1 for the proof. |
| [`database_audit_plan_part3.md`](./database_audit_plan_part3.md) | Phased roadmap (Phase 0–7) with ticket-level instructions, dependencies, acceptance criteria, backward-compat strategy, rollback per phase | Execution playbook. One phase per chapter. |
| [`database_audit_plan_part4.md`](./database_audit_plan_part4.md) | Migration scripts (M0–M7) · test checklist · rollback runbooks · risk matrix · confirmation items requiring product decisions · index of deliverables | Operations reference. Has the scripts and the gates. |

## Top 10 critical findings (one-line each)

1. **C-1** — `cart.js`, `wishlist.js`, `checkoutGroup.js` declare `ref:"Customer"` but the model is registered as `"User"`. Future populate silently returns null.
2. **C-2** — `orderPlacementService.js:451` writes `Transaction.type:"Wallet Payment"`, not in enum. Every wallet-redemption checkout fails.
3. **C-3** — `walletService.creditWallet/debitWallet` mutate balances without creating a `LedgerEntry`. Refund/cash flows have no audit trail.
4. **C-4** — Return-refund flow performs 6+ writes across 4 collections without `mongoose.startSession()`. Partial-state risk.
5. **C-5** — `databaseIndexManager.js` references non-existent collection (`withdrawals`) and non-existent fields (`transactions.userId`, `notifications.read`, `ledgerentries.ownerType`).
6. **C-6** — Triple bookkeeping: order finance state mirrored across `Order.payment.*`, `Order.paymentStatus`, `Payment`, `Transaction`, `LedgerEntry`, `Wallet`. Drift accumulates.
7. **C-7** — `User.walletBalance` AND `Wallet({ownerType:"CUSTOMER"})` both track the same money. Two writers, no invariant.
8. **C-8** — Five separate OTP storage locations (OtpVerification, OtpSession, OrderOtp, inline on User, inline on Delivery) for two distinct concepts.
9. **C-9** — Polymorphic `refPath` enums variously accept `"Customer"` / `"User"` / `"Rider"` — none consistent with the actual `"User"` / `"Delivery"` model names.
10. **C-10** — `Order.payment.status` and `Order.paymentStatus` drift on every update because the sync hook only fires at insert/legacy fallback.

## Phase summary

| Phase | Goal | Effort | Risk |
|---|---|---|---|
| 0 | Read-only verification of all findings against live DB | 1d | None |
| 1 | Correctness fixes (broken refs, broken enums, orphan fields, missing validators) | 2d | Low |
| 2 | Transactional + ledger integrity (wraps refund flows, makes walletService ledger-aware) | 4d | Medium |
| 3 | Index hygiene (drop dead, dedupe schema↔manager, fix field-name typos) | 2d | Low |
| 4 | Schema canonicalization (deprecate Order.payment.*, User.walletBalance, Transaction collection) | 1w | Medium |
| 5 | Naming alignment + OTP consolidation + polymorphic enum cleanup | 1w | Medium |
| 6 | Soft-delete + audit-field standardization + cascade behavior | 3d | Low |
| 7 | Final cleanup (drop deprecated fields after 30-day soak) | 2d | Medium |

## Hand-off

The plan is written for a single mid-senior backend engineer OR for AI agents executing phase-by-phase. Each ticket (`P1-1`, `P2-3`, etc.) has:
- File path + line numbers
- Concrete diff or migration script
- Tests to add
- Rollback procedure
- Acceptance criteria

Start with Phase 0 → `M0-1` script → review report → resolve `Q1–Q10` in Part 4 §18 with product/ops → execute phases in dependency order.

## Existing context this plan integrates with

This plan reads alongside the previously-written:
- `refactor_plan_part1.md` — architecture + cohesion (already in repo)
- `refactor_plan_part2.md` — code-organization phases (P1–P5)
- `refactor_plan_part3.md` — refactor priorities + decoupling strategy

The four `database_audit_plan_part*.md` files in this set are **data-layer focused** and complement (not replace) the existing refactor plans. The `app/domains/` shim scaffolding from `refactor_plan_part3` is preserved; data-layer work and code-organization work are independent tracks that can run in parallel.

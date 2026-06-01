---
name: coupling-cohesion-audit
description: Audit a codebase for tight coupling, weak cohesion, god objects, infrastructure leakage, duplicated business logic, and provider lock-in. Produces a prioritized technical-debt report with risk levels and safe decoupling strategies. Use when the user asks for an architecture review, code-smell analysis, technical-debt assessment, fan-out analysis, or wants to know "what should I refactor first".
---

# Coupling & Cohesion Audit

## Purpose

Systematically scan a codebase to identify high-risk coupling, weak cohesion, and structural debt. Produce a prioritized report that ranks issues by **ROI**, **risk**, and **effort** so the team knows exactly what to refactor next.

This skill always runs **before** any refactor work. Refactoring without this audit is guessing.

## When To Use

- User asks for architecture review, code review at the system level, or tech-debt assessment
- User mentions god objects, monolithic files, provider lock-in, or "where should I start?"
- Onboarding a new engineer who needs a map of the danger zones
- Before kicking off any modernization, decoupling, or service-extraction effort

## Audit Workflow

Copy this checklist and track progress:

```
Audit Progress:
- [ ] Step 1: Inventory tech stack and process roles
- [ ] Step 2: Measure file sizes and identify monoliths
- [ ] Step 3: Map fan-out of top-N largest files
- [ ] Step 4: Scan for duplicated business logic
- [ ] Step 5: Detect infrastructure leakage in domain code
- [ ] Step 6: Detect provider lock-in
- [ ] Step 7: Audit validation coverage
- [ ] Step 8: Audit logging consistency
- [ ] Step 9: Audit route mounting and naming
- [ ] Step 10: Produce prioritized findings report
```

### Step 1 — Inventory Tech Stack & Process Roles

Document every external system the codebase touches: DB, cache, queue, real-time, payments, push, media, maps, SMS, auth. Record the SDK version and how it is imported.

Identify process roles (HTTP server, worker, scheduler) and whether they share or separate startup paths.

### Step 2 — Measure File Sizes

Flag any file as a candidate monolith when it exceeds these thresholds:

| File Type | Threshold |
|---|---|
| Controller / Route handler | 500 lines or 20 KB |
| Service / Business logic | 600 lines or 25 KB |
| Frontend page component | 300 lines or 15 KB |
| Single React component | 200 lines |
| Single API client file | 500 lines |

Use `rg --files -g '*.js' | xargs wc -l | sort -n` or equivalent.

### Step 3 — Map Fan-Out

For each monolithic file, count its imports. Any file importing **15+ other modules** is a god object. Document the dependencies explicitly.

Example finding format:

```
TC-01: orderController ↔ 20+ Dependencies
File: app/controller/orderController.js
Imports: Order, Cart, Product, Transaction, StockHistory, Seller, Delivery,
         Setting, Customer + 11 services + 3 utils
Risk: Any change anywhere can require touching this controller.
       Impossible to unit test without mocking half the application.
```

### Step 4 — Scan For Duplicated Business Logic

Grep for sibling functions with different names but identical intent. Common patterns:

- `computeXForY()` and `computeXDates()` in two different files
- `parsePositiveInt()` redefined as an inline helper in multiple files
- `validateWithJoi()` as an inline helper instead of shared middleware
- Constants like `RETURN_WINDOW_DAYS` hardcoded in multiple places

Document each duplicate as a weak-cohesion finding with the exact line ranges.

### Step 5 — Detect Infrastructure Leakage

Search for these red-flag imports inside `controller/` or domain `service/` files:

- Redis: `getRedisClient`, `ioredis`, `redis.`
- Queue: `Bull`, `bullmq`, `Queue(`, `*.add(`
- HTTP client (in non-API layers): `axios`, `fetch(`
- Cloud SDKs: `aws-sdk`, `@google-cloud/`, `firebase-admin`

Each match is a coupling finding. The fix is always a port + adapter (see `provider-adapter-pattern`).

### Step 6 — Detect Provider Lock-In

For each external provider (payments, SMS, push, maps, media), check whether the SDK is imported **directly** by domain code or wrapped in an adapter.

```js
// Red flag — SDK in domain layer:
import { StandardCheckoutClient } from '@phonepe-pg/pg-sdk-node';

// Good — SDK isolated in adapter:
import { PaymentProviderPort } from './ports/paymentProviderPort.js';
```

### Step 7 — Audit Validation Coverage

Count controllers and validation schemas. If the ratio is worse than 1 schema per 1 controller, flag it. List the controllers with no schema, prioritized by risk (payment, order, financial actions = highest).

### Step 8 — Audit Logging Consistency

Grep for `console.log`, `console.warn`, `console.error` across the codebase. Each occurrence inside production code (not scripts) is a finding. Cross-reference with the existence of a structured logger to confirm migration is possible.

### Step 9 — Audit Route Mounting

Read the top-level route registration file. Flag:

- Same router mounted at multiple paths with no documentation
- Routes mounted at `/` root that pollute the namespace
- Auth-public routes mixed with auth-required routes under the same prefix

### Step 10 — Produce The Findings Report

Group findings into:

**Tight Coupling (TC)** — items that block independent change

```
TC-NN: <Component A> ↔ <Component B>
File: <path>
Coupling: <what is imported / called directly>
Why risky: <impact in one sentence>
Safe decoupling strategy: <recipe>
```

**Weak Cohesion (WC)** — items where related logic is scattered

```
WC-NN: <Concept> scattered across <N> files
Files: <list>
Fix: <single source of truth target>
```

**Technical Debt Summary Table** — final scorecard:

```
| Area                         | Debt Level | Risk                              |
|---|---|---|
| <largest controller>          | 🔴 Critical | Change blast radius covers domain |
| <provider lock-in>            | 🔴 Critical | Cannot add alternative provider   |
| <duplicated business logic>   | 🟠 High     | Drift causes calculation bugs     |
| <infra-in-domain>             | 🟠 High     | Untestable, unswappable           |
| <flat folder structure>       | 🟡 Medium   | Discoverability pain at scale     |
| <inconsistent logging>        | 🟡 Medium   | Observability gaps                |
```

## Implementation Rules

1. **Always quantify.** Findings must have file paths, line counts, and import counts. No vague "this feels coupled" entries.
2. **Always propose a fix.** Every finding includes a "safe decoupling strategy" pointing to the relevant pattern skill.
3. **Always classify by debt level.** Critical / High / Medium / Low — never leave a finding unranked.
4. **Always separate domain from infrastructure findings.** They have different fix patterns.
5. **Never recommend a rewrite.** Findings recommend extraction, wrapping, or re-export migration only.
6. **Limit to the top 20 findings.** A 100-item report is unactionable. Cluster sub-issues under parent findings.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| "Refactor everything" recommendation | Unactionable, no sequencing, no risk model |
| Findings without file paths | Cannot be acted on by another engineer |
| Counting LOC without measuring fan-out | Misses true coupling — a small file with 20 imports is worse than a 600-line cohesive file |
| Ranking by personal taste instead of risk × frequency | Teams refactor low-impact files while critical paths rot |
| Treating "old code" as a finding by itself | Age is not a problem; coupling and incorrectness are |

## Example Output Skeleton

```markdown
# Architecture Assessment — <Project Name>

## 1. Tech Stack
| Layer | Technology |
|---|---|
| Backend | Node 18 / Express 5 / ESM |
| DB | MongoDB + Mongoose 8 |
| Cache | Redis (ioredis) |
| Queue | Bull |
...

## 2. Current Strengths
- <Strength 1 with file evidence>
- <Strength 2 with file evidence>

## 3. Current Weaknesses
### Backend — Critical Issues
**B1. <Name>** — <file> = <N> lines / <KB>
<one-paragraph evidence>

## 4. Tight Coupling Findings
### TC-01: <name>
**File:** <path>
**Fan-out:** <list>
**Why risky:** <reason>
**Safe decoupling strategy:** <recipe>

## 5. Weak Cohesion Findings
### WC-01: <name>
<evidence + fix>

## 6. Technical Debt Summary
<final scoring table>

## 7. Recommended Refactor Order
<priority matrix sorted by ROI × Risk⁻¹>
```

## Related Skills

- `safe-refactor-strategy` — apply findings using safe patterns
- `domain-service-extraction` — fix god controllers
- `provider-adapter-pattern` — fix provider lock-in
- `infrastructure-domain-separation` — fix infra leakage

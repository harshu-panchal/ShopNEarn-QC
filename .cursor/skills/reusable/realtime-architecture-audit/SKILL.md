---
name: realtime-architecture-audit
description: Audit a codebase's realtime stack — Socket.IO, Firebase RTDB, Redis/Bull queues, push notifications, delivery tracking, OTP workflows, polling fallbacks, and horizontal-scaling primitives — to produce a prioritized findings report with root cause, impact, exact fix, phased rollout, and production-grade refactor guidance. Use when the user asks for a realtime architecture review, mentions "realtime", "socket scale", "firebase tracking", "push not delivering", "queue not processing", "polling fallback", "OTP workflow drift", "multi-node socket fanout", or before any work that touches notifications, delivery telemetry, or live-tracking flows.
---

# Realtime Architecture Audit

## Purpose

Audit the realtime surface of a Node/Express + React + MongoDB + Redis + Firebase + Bull stack and produce a findings report that engineering can action **without further discovery**. The report is grouped by severity (Critical / High / Medium / Low) and every entry carries five mandatory fields:

1. **Root cause** — the structural reason the bug exists (not a symptom)
2. **Impact** — user-visible failure mode + scaling/correctness blast radius
3. **Exact fix** — file + line-range edit description (no hand-waving)
4. **Phased implementation plan** — which phase ships the fix, with gates
5. **Production-grade refactor guidance** — the durable pattern the fix should converge on

Every finding obeys four architectural rules: **low coupling**, **high cohesion**, **event-driven flow**, **worker-only async processing**, and **single source of truth**.

## When To Use

- The user asks for a "realtime audit", "websocket review", "push reliability review", "firebase audit", or "production readiness score"
- Push notifications are reported as late, duplicated, or missing
- Live-tracking maps go stale, show wrong rider, or never load on grouped/alias orders
- Riders go idle and never receive new jobs after socket reconnect
- The user mentions horizontal scaling, multi-node websockets, Socket.IO Redis adapter, RTDB cleanup, OTP duplication, or polling fallback regressions
- Before any change that touches `notification.service.js`, `firebaseService.js`, `socketManager.js`, `deliveryController.js`, the OTP workflow, or queue processors
- After the user attaches a file (e.g. `firebase_README.md`) describing realtime symptoms and asks for a structured plan

## The Eight Audit Surfaces

Every realtime audit covers exactly these eight surfaces, in this order:

| # | Surface | Owns | Primary failure mode |
|---|---|---|---|
| 1 | **Sockets** | Low-latency workflow events (order status, accept/reject, OTP, chat) | Singleton teardown, unauthenticated parallel clients, no Redis adapter |
| 2 | **Firebase RTDB** | High-frequency ephemeral telemetry (rider GPS, route polyline, presence) | Writes without cleanup, untrusted paths, stale fleet markers |
| 3 | **Redis / Bull queues** | Cross-instance coordination, async work | Producers without registered processors, sync delivery bypassing the queue |
| 4 | **Notifications** | Durable + push fanout (FCM, in-app badges) | Sync push inside HTTP handlers, polled UIs, missing dead-letter |
| 5 | **Delivery tracking** | Rider location + assignment lifecycle | Stale GPS while idle, no broadcast timeouts, no cleanup on completion |
| 6 | **OTP workflows** | Pickup / delivery / login OTP | Duplicate endpoints, two state machines, divergent metrics |
| 7 | **Polling fallbacks** | Safety net when sockets are missed | One-shot fetches gated by refs, no backoff, no visibility checks |
| 8 | **Realtime scaling** | Multi-node correctness | Missing Socket.IO adapter, no idempotency keys, no event versioning |

A finding that does not fit one of these surfaces is out of scope for this skill.

## What Each Technology Should Own (Source of Truth)

This mapping is the **single source of truth** for every "where should this live?" decision in a realtime finding. Cite it in every fix.

| Technology | Owns | Forbidden |
|---|---|---|
| **WebSockets** | order status changes, seller accept/reject prompts, delivery broadcasts/withdrawals, OTP events, support chat | rider GPS streams, durable business state, cross-process coordination |
| **Firebase RTDB** | rider GPS, active route polyline cache, short-lived trail/presence | workflow events, durable order state, authorization checks |
| **Redis** | Socket.IO adapter, Bull queues, idempotency keys, throttles, distributed locks, cache invalidation / pub-sub | source-of-truth for any business entity |
| **MongoDB** | orders, assignments, notifications history, ticket messages, finance/audit records | high-frequency telemetry, ephemeral presence |

Any finding where a piece of state lives in the wrong technology is a **High** severity finding by default.

## Architecture Principles (apply to every fix)

| Principle | Concrete rule for realtime |
|---|---|
| **Low coupling** | Controllers must not call FCM SDK, Redis client, or `rtdb.ref()` directly — go through `notificationService`, `cacheService`, `firebaseService` |
| **High cohesion** | One module owns one surface (e.g. one `socketManager.js` per process, not two parallel clients) |
| **Event-driven** | Producers emit events; subscribers fan out. No `await fcm.send()` inline in a request handler |
| **Worker-only async** | API nodes write durable state and enqueue jobs; workers do FCM / SMS / heavy fanout. Push delivery is never on the request path |
| **Single source of truth** | One canonical order id (DB `_id` or `orderId`, pick one) flows through socket rooms, RTDB paths, push payloads, and queue jobs |

## Audit Workflow

Copy this checklist and track progress:

```
Realtime Audit Progress:
- [ ] Step 1: Inventory realtime stack and process roles
- [ ] Step 2: Audit sockets — singletons, auth, Redis adapter
- [ ] Step 3: Audit Firebase RTDB — write paths, auth, cleanup
- [ ] Step 4: Audit Redis/Bull — producers vs processors
- [ ] Step 5: Audit notifications — sync vs queue, dead-letter, in-app delivery
- [ ] Step 6: Audit delivery tracking — assignment, broadcast, GPS freshness
- [ ] Step 7: Audit OTP workflows — duplicate endpoints, state-machine drift
- [ ] Step 8: Audit polling fallbacks — gated refs, visibility, backoff
- [ ] Step 9: Audit scaling primitives — adapter, idempotency, sequence numbers
- [ ] Step 10: Produce prioritized findings report + phased plan
- [ ] Step 11: Score production readiness (X/10) with reasoning
```

### Step 1 — Inventory

Document the realtime stack with one citation per technology. Identify process roles:

- HTTP server entrypoint (`server.js`, `app.js`)
- Worker entrypoint (separate file? Same process?)
- Scheduler (Bull-repeatable, node-cron, distributed scheduler)
- Socket.IO instance file and its mount point
- Firebase admin init file
- Redis client factory

If the worker shares the HTTP process, that itself is a **Critical** finding (worker work blocks the event loop).

### Step 2 — Socket Audit

Grep for `io.on(`, `socket.emit(`, `io(`, `socketManager`, `disconnect(`. For each socket entrypoint check:

- **Singleton?** Exactly one connected client per browser session. Two parallel client abstractions = finding.
- **Authenticated?** Every connection runs through an `auth` handshake middleware.
- **Redis adapter?** `@socket.io/redis-adapter` mounted in multi-node deployments. Absent = scaling finding.
- **Room discipline?** Joins use the canonical id, not URL params or aliases.
- **Teardown safety?** No view-scoped code can call `disconnect()` on the global socket — only `off()` its own listeners.

### Step 3 — Firebase RTDB Audit

Grep for `rtdb.ref(`, `database().ref(`, `.set(`, `.update(`, `.push(`. For each write:

- **Authorization?** The server resolved the canonical entity (e.g. order) and verified the actor owns the path before writing.
- **Cleanup?** A deletion path exists for completion, cancellation, logout, and TTL expiry.
- **Path normalization?** Writes use the canonical order id, not the URL param or alias.
- **Bounded growth?** A worker prunes `/fleet/active`, `/deliveryLocations`, `/orders/.../trail` on terminal states.

### Step 4 — Redis / Bull Audit

For every Bull `Queue(`:

- Find the matching `queue.process(` registration. **Producer without processor = Critical** (jobs accumulate, never run).
- Confirm the producer is the only call site that touches the work; no parallel inline path.
- Confirm retries, backoff, dead-letter, and concurrency are configured.
- Confirm worker startup loads the processor registration before `app.listen` accepts traffic.

### Step 5 — Notification Audit

For each `notify(`, `sendPush(`, `emitToUser(`:

- **Sync or queued?** If the function awaits FCM inside an HTTP handler, that's a **Critical** finding ("push pipeline is synchronous despite having a queue").
- **In-app channel?** Topbar / badge updates ride sockets, not 20-second polls.
- **Templating cohesion?** Notification text + payload built in one builder module, not inline strings across controllers.
- **Idempotency?** Repeated triggers (webhook retries, double clicks) produce one notification, not N.

### Step 6 — Delivery Tracking Audit

- **GPS freshness while idle:** Riders running `getCurrentPosition` once at login but only `watchPosition` during active orders = stale matching radius. Run a throttled heartbeat watch while online.
- **Assignment broadcast lifecycle:** Every broadcast has timeout + radius-expansion + rebroadcast policy. Returns must use the same state machine as deliveries.
- **Customer live tracking:** RTDB subscriptions resolve the canonical order id once loaded, never pin to the URL param.
- **Cleanup on terminal state:** `delivered`, `cancelled`, `returned`, `rider_offline` all trigger RTDB node removal.

### Step 7 — OTP Workflow Audit

- One state machine, one set of routes. Two routers (`/delivery/orders/:id/generate-otp` and a workflow route) is a **Medium** finding — pick the workflow path and delete the legacy.
- Same applies to login OTP, pickup OTP, return OTP — each is one canonical workflow.
- Metrics and events share the canonical workflow emitter.

### Step 8 — Polling Fallback Audit

Polling exists as a **safety net** for missed sockets, never as the primary path. For every polling site check:

- Is it actually polling, or a one-shot fetch gated by a ref like `didInitialAvailableFetchRef`? One-shot = finding.
- Is interval throttled by visibility (`document.visibilityState`) and online status?
- Is there exponential backoff on failure?
- Are the polled endpoints idempotent and cheap?

Rule: **socket first, poll as a safety net every 10–30s while online and visible**.

### Step 9 — Scaling Primitive Audit

For multi-node readiness, confirm:

- Socket.IO Redis adapter mounted
- Distributed lock primitive available (`SET NX EX` or Redlock) for assignment broadcasts
- Idempotency keys on webhook handlers and OTP submits
- Event sequence numbers / versions on emitted payloads so out-of-order clients can drop stale events
- Observability: a counter per emitted event type, a histogram per queue job, a dashboard per RTDB write path

### Step 10 — Produce The Findings Report

Use this template **verbatim** for every finding:

```markdown
### <SEVERITY> — <one-line title>: <file>:<line>, <file>:<line>

- **Root cause:** <structural reason — not the symptom>
- **Impact:** <user-visible failure> + <scaling/correctness blast radius>
- **Exact fix:** <file edit description; cite line ranges>
- **Phase:** <phase number from the plan below>
- **Refactor guidance:** <which durable pattern this converges on; cite the principle from the table above>
```

Severity ladder:

- **CRITICAL** — production correctness break or push pipeline broken; ship in Phase 1
- **HIGH** — silent data drift, broken live UX, or unbounded resource growth; ship in Phase 2
- **MEDIUM** — duplicate sources of truth, divergent flows, late updates; ship in Phase 3
- **LOW** — risk of future divergence, code-smell only; ship in Phase 4 or with adjacent work

Cap the report at **15 findings**. Cluster sub-issues under a parent finding.

### Step 11 — Production Readiness Score

End the report with:

```
Score: <N>/10
Reliability today:   <one sentence on single-node behavior>
Scalability today:   <one sentence on horizontal scaling>
Missing components:  <comma-separated list: Socket.IO Redis adapter, RTDB cleanup worker, ...>
```

Scoring rubric (subtract from 10):

| Deduction | Trigger |
|---|---|
| −2 | Notification push is synchronous on the request path |
| −1 | No Socket.IO Redis adapter mounted (multi-node fanout broken) |
| −1 | RTDB writes have no cleanup worker (unbounded growth) |
| −1 | Polling fallback is one-shot or absent (riders idle on missed events) |
| −1 | Two parallel socket abstractions or two OTP workflows (drift risk) |
| −1 | Authorization not enforced on RTDB writes (tampering risk) |
| −1 | Rider GPS not refreshed while online-but-idle |
| −1 | No idempotency keys / sequence numbers / dead-letter for queued work |

## Phased Implementation Plan

Every finding ships in exactly one phase. The phases are designed so each phase can deploy independently and is rollback-safe.

### Phase 1 — Stop The Bleed (CRITICAL findings)

Goal: no realtime work blocks the HTTP request path; no untrusted writes hit RTDB.

- Move notification delivery from inline `notify()` to enqueue + worker `process()`
- Register every Bull processor at worker boot (`app/core/startup.js`)
- Reject mismatched `orderId` on RTDB writes (403/409) — resolve canonical order synchronously before fanout
- Gate: notification queue depth + worker lag dashboards green for 24h before Phase 2

### Phase 2 — Live Tracking Correctness (HIGH findings)

Goal: customers see the right rider, riders never go idle on missed events, RTDB stops growing unbounded.

- Normalize order identifier in one hook (`useCanonicalOrderId`) shared by socket join + RTDB subscribe
- Restore interval polling with backoff while online + visible (riders dashboard)
- Run rider GPS heartbeat while online (throttled), independent of active-order tracking
- Add RTDB cleanup on delivery completion, cancellation, logout, offline, return completion
- Add a cleanup worker plus per-node TTL metadata for `/deliveryLocations`, `/fleet/active`, `/orders/.../trail`
- Unify return-pickup broadcast with normal delivery assignment (timeout + rebroadcast + radius expansion)
- Gate: live-tracking smoke tests pass on grouped/alias orders; RTDB read cost stable for 7d

### Phase 3 — Single Source Of Truth (MEDIUM findings)

Goal: collapse duplicate flows; in-app updates become event-driven.

- Delete legacy OTP routes; route delivery completion through the workflow state machine only
- Replace topbar 20s poll with socket-driven unread-count deltas (poll only as degraded fallback)
- Replace any view-scoped `disconnectOrderSocket()` calls with ref-counted listener teardown
- Gate: two-source-of-truth audit passes (`rg "generate-otp"` returns one path, etc.)

### Phase 4 — Scale-Out & Hygiene (LOW findings + structural primitives)

Goal: multi-node ready, observable, drift-resistant.

- Mount Socket.IO Redis adapter
- Fold any parallel socket client abstraction into the main `socketManager`
- Add event versioning / sequence numbers on emitted payloads
- Add per-event-type counters and per-queue-job histograms
- Add idempotency keys on webhook handlers and OTP submits
- Gate: synthetic two-node test — events emitted from node A reach a client connected to node B

## Production-Grade Refactor Guidance

For each surface, the durable target pattern:

| Surface | Target pattern |
|---|---|
| Sockets | **One** authenticated `socketManager` singleton per browser session; rooms keyed by canonical id; Redis adapter on server; ref-counted listener subscriptions |
| Firebase RTDB | Server-resolved canonical path + auth check before any write; per-node TTL metadata; cleanup worker on terminal states; client subscriptions keyed by resolved id |
| Redis / Bull | Producer is the **only** way to schedule work; processors registered at worker boot; retries + backoff + dead-letter + concurrency configured; metrics on every queue |
| Notifications | API enqueues, worker delivers FCM; in-app updates ride sockets; one builder module owns templates; idempotency key per logical event |
| Delivery tracking | Continuous rider heartbeat while online (throttled); assignment state machine with timeout + rebroadcast; RTDB cleanup on every terminal state |
| OTP workflows | One canonical workflow route; legacy routes deleted; metrics + events emitted from the workflow emitter only |
| Polling fallbacks | Visibility-aware + online-aware interval with exponential backoff; socket-first, poll as safety net every 10–30s |
| Realtime scaling | Socket.IO Redis adapter; event versioning; idempotency keys; observability counters; horizontal-scale smoke test in CI |

## Anti-Patterns

| Anti-Pattern | Why It Fails | Fix |
|---|---|---|
| Calling `fcm.send()` (or equivalent) inside an HTTP handler | Blocks the request, bypasses retries/dead-letter, dies on process crash mid-flight | Enqueue from API, deliver from worker |
| Writing to RTDB with a client-supplied id | Lets attackers pollute live-tracking state | Resolve canonical entity on server, check actor ownership, then write |
| Subscribing RTDB to a URL param while the socket joins the canonical id | Grouped/alias orders receive status but never telemetry | One `useCanonicalOrderId` hook feeds both |
| One-shot polling gated by a ref like `didInitialFetchRef` | After the first miss, no recovery — riders sit idle | Restore an interval with visibility + online gating |
| View-scoped code calling `disconnect()` on a shared socket singleton | Silently kills listeners on other features | Ref-counted listener subscriptions; only `off()` own listeners |
| Two OTP routers or two notification builders | Permanent drift between codepaths | Pick canonical, delete the other, mirror via shim only during the soak window |
| Bull producer without a matching processor | Jobs accumulate; nothing happens; nobody alerts | Register processors at worker boot; assert producer/processor parity at startup |
| Topbar polling every 20s for unread count | Late badges and N× refresh load | Socket-driven deltas, poll only as degraded fallback |
| Single `getCurrentPosition` at login for riders | Matching radius degrades as soon as the rider moves | Throttled `watchPosition` heartbeat while online |
| Adding new realtime code in a controller next to business logic | Couples infra to domain; untestable | Use `notificationService` / `firebaseService` / `socketManager`; never import the SDK directly into controllers |

## Rollback

| Change | Rollback strategy |
|---|---|
| Notification sync → queued | Feature-flag the enqueue path; flip back to inline `notify()` if worker stalls |
| RTDB cleanup worker | Stop the worker; existing data persists; no data loss |
| Restored polling fallback | Remove the interval; behavior reverts to one-shot fetch |
| Socket.IO Redis adapter mount | Unmount and revert to in-memory adapter — only safe to roll back on single-node deployments |
| OTP legacy route deletion | Re-introduce the route from git history; both paths coexist again (drift returns) |
| Topbar socket-driven badges | Re-enable the 20s poll alongside; drop socket subscription |

## Related Skills

- `coupling-cohesion-audit` — system-wide companion audit; run before this skill for full architecture context
- `infrastructure-domain-separation` — fix infra-leakage findings (Redis/Bull/Firebase imported into controllers)
- `provider-adapter-pattern` — wrap FCM, Firebase admin, Socket.IO behind ports to keep domain code testable
- `mongoose-transaction-wrap` — wrap multi-doc writes triggered by realtime events
- `safe-refactor-strategy` — umbrella pattern for shipping each phase without breakage

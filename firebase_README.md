Critical

CRITICAL — Push pipeline is synchronous despite having a queue: backend/app/modules/notifications/notification.service.js:176, backend/app/modules/notifications/notification.service.js:183, backend/app/modules/notifications/notification.worker.js:202; root cause: notify() creates DB rows then calls deliverNotificationById() inline, while queue processors are never registered; impact: HTTP/event handlers block on FCM, retries/dead-letter/concurrency controls are effectively bypassed; exact fix: enqueue notification jobs from notify() and register queue processors in worker startup; recommendation: keep API nodes write-only and push delivery worker-only.  ---completed

HIGH — Delivery location can be written to arbitrary Firebase order paths before assignment is verified: backend/app/controller/deliveryController.js:375, backend/app/controller/deliveryController.js:378, backend/app/controller/deliveryController.js:401; root cause: orderId is trusted for RTDB fanout and assignment check is async/non-blocking; impact: polluted live-tracking state, wrong rider shown on customer map, harder incident recovery; exact fix: resolve canonical order synchronously and only write RTDB when deliveryBoy === deliveryId; recommendation: reject mismatched orderId with 403/409. ---completed

HIGH — Customer live tracking breaks when route param is not the canonical order id: frontend/src/modules/customer/pages/OrderDetailPage.jsx:246, frontend/src/modules/customer/pages/OrderDetailPage.jsx:362; root cause: socket joins both URL id and canonical order.orderId, but Firebase subscriptions stay pinned to the URL param only; impact: checkout-group / alias orders can receive status sockets but never receive GPS/trail/route updates; exact fix: subscribe RTDB using resolved canonical id once loaded; recommendation: centralize “order identifier normalization” in one hook. ---completed

HIGH — Delivery offer fallback is not actually polling: frontend/src/modules/delivery/layout/DeliveryLayout.jsx:362, frontend/src/modules/delivery/layout/DeliveryLayout.jsx:365, frontend/src/modules/delivery/layout/DeliveryLayout.jsx:411, frontend/src/modules/delivery/layout/DeliveryLayout.jsx:462; root cause: didInitialAvailableFetchRef and didInitialNotificationsPollRef gate both flows to one-shot fetches; impact: if socket delivery is missed after mount, riders can sit online and never see new jobs; exact fix: restore interval/backoff polling while online and app-visible; recommendation: socket first, poll as safety net every 10–30s. ---completed (4)


HIGH — Rider location becomes stale while waiting for jobs: frontend/src/modules/delivery/layout/DeliveryLayout.jsx:390, frontend/src/modules/delivery/layout/DeliveryLayout.jsx:392, frontend/src/modules/delivery/components/DeliveryTrackingMap.jsx:137; root cause: dashboard sends only one getCurrentPosition when going online, and continuous watchPosition starts only inside active-order tracking; impact: nearby-order matching and seller-radius broadcast degrade as soon as rider moves; exact fix: run a lightweight background heartbeat/watch while online, not only during active delivery; recommendation: throttle server-side, but always maintain fresh rider coordinates. ---completed (5)


HIGH — Firebase tracking data is never cleaned except route cache expiry: backend/app/services/firebaseService.js:44, backend/app/services/firebaseService.js:45, backend/app/services/firebaseService.js:89, backend/app/services/firebaseService.js:135; root cause: writes exist for /deliveryLocations, /orders/.../rider, /orders/.../trail, /fleet/active, but cleanup only removes expired route polylines; impact: stale fleet markers, wrong “live” riders, unbounded RTDB growth and higher read costs; exact fix: remove/expire RTDB nodes on delivery completion, cancellation, logout/offline, and return completion; recommendation: add a cleanup worker plus per-node TTL metadata. ---completed (6)


HIGH — Return-pickup broadcast has no real timeout/retry state machine: backend/app/controller/orderController.js:767, backend/app/controller/orderController.js:787, backend/app/controller/orderController.js:808, backend/app/services/orderQueryService.js:340; root cause: UI payload carries a 60s expiry, but backend persists return_pickup_assigned without scheduler/backoff/radius expansion; impact: stale return tasks can linger indefinitely and remain queryable; exact fix: give returns the same assignment workflow as normal deliveries with timeout jobs and rebroadcast policy; recommendation: unify delivery and return assignment orchestration. ---completed (7)

Important

MEDIUM — Admin support unread logic can tear down the shared socket globally: frontend/src/core/context/SupportUnreadContext.jsx:119, frontend/src/core/context/SupportUnreadContext.jsx:120; root cause: entering /admin/settings calls disconnectOrderSocket() on the singleton used by other listeners; impact: chat/order listeners silently die until remounted; exact fix: stop only ticket listeners for that view, not the global socket; recommendation: use ref-counted subscriptions on one socket manager. ---completed (8)

MEDIUM — Standard delivery OTP flow is duplicated and diverging: frontend/src/modules/delivery/components/OtpInput.jsx:116, frontend/src/modules/delivery/components/OtpInput.jsx:157, backend/app/routes/orderRoutes.js:212, backend/app/routes/deliveryAuth.js:55; root cause: frontend uses legacy /delivery/orders/:id/generate-otp|validate-otp while workflow routes also exist; impact: two sources of truth for delivery completion, harder bug fixes, inconsistent events/metrics; exact fix: keep one canonical OTP workflow and delete the other path; recommendation: route all delivery completion through the workflow state machine only. ---completed (9)


MEDIUM — Notification UI for admin/seller is poll-based, not event-driven: frontend/src/shared/layout/Topbar.jsx:63, frontend/src/shared/layout/Topbar.jsx:65; root cause: topbar refreshes every 20s and never subscribes to socket/push events for in-app sync; impact: late badge updates and duplicate refresh load; exact fix: push unread-count deltas via socket or shared notification store; recommendation: use polling only as a degraded fallback. ---completed(10)


LOW — A second socket client abstraction exists and risks divergence: frontend/src/core/services/socket.js:6, frontend/src/core/services/socket.js:12, frontend/src/core/services/socket.js:54; root cause: parallel socket stack beside orderSocket; impact: future features can accidentally use an unauthenticated/isolated client; exact fix: remove or fold it into the main socket manager; recommendation: one authenticated socket singleton per browser session. ---completed(11)


What each technology should own

WebSockets — low-latency workflow events: order status changes, seller accept/reject prompts, delivery broadcasts/withdrawals, OTP events, support chat.

Firebase RTDB — high-frequency ephemeral telemetry only: rider GPS, active route polyline cache, short-lived trail/presence.

Redis — cross-instance coordination: Socket.IO adapter, Bull queues, idempotency keys, throttles, distributed locks, cache invalidation/pub-sub.

MongoDB — durable business state: orders, assignments, notifications history, ticket messages, finance/audit records.
Architecture review

Good: the repo already separates durable order state (Mongo) from live telemetry (Firebase) and has workflow-centric emitters.

Weak: realtime responsibilities are split across duplicate flows, scale-out primitives are incomplete, and several “fallback” paths are one-shot instead of resilient loops.

missing components: Socket.IO Redis adapter, real notification worker wiring, RTDB cleanup jobs, rider online heartbeat, return-pickup scheduler, event versioning/sequence numbers, socket observability.

Production readiness

Score: 4/10
Reliability today: workable on a single node with light traffic; risky under horizontal scaling, mobile backgrounding, and intermittent connectivity.

Scalability today: Mongo/Redis primitives exist, but websocket fanout, push delivery, and live-location freshness are not production-grade yet.
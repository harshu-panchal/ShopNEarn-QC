---
name: provider-adapter-pattern
description: Eliminate third-party provider lock-in by wrapping SDKs behind a port (interface) and one or more adapter implementations, selected at runtime via a feature flag. Use when payment, SMS, push, maps, media, search, auth, or analytics SDKs are imported directly in domain code, or when the user wants to add a second provider, swap providers, or test domain logic without hitting the real SDK.
---

# Provider Adapter Pattern

## Purpose

Make external providers (payments, SMS, push, maps, media, analytics) **replaceable** without touching domain logic. Achieved by defining a **port** (interface) and one or more **adapters** (implementations), with a **registry** that picks the active adapter from an environment variable.

## When To Use

- An SDK is imported at the top of a domain service or controller
- The team wants to add a second provider (PhonePe + Razorpay, Twilio + IndiaHub)
- Tests cannot run without network access because the SDK is hardwired
- A provider's rate limit or outage takes down the whole flow
- The user asks to "swap", "abstract", or "make provider-agnostic"

## Target Structure

```
app/services/<domain>/
  <domain>.service.js          ← orchestrator (provider-agnostic)
  ports/
    <domain>ProviderPort.js    ← interface contract
  providers/
    <providerA>.adapter.js     ← wraps SDK A
    <providerB>.adapter.js     ← wraps SDK B (future)
  providerRegistry.js          ← selects active adapter from env
```

## The Port Contract

A port is a class (or set of exported functions) that declares method signatures with no implementation. Adapters must implement every method.

```js
// app/services/payment/ports/paymentProviderPort.js
export class PaymentProviderPort {
  async initiatePayment({ merchantOrderId, amountPaise, redirectUrl, metadata }) {
    throw new Error('not implemented');
  }
  async getPaymentStatus({ merchantOrderId }) {
    throw new Error('not implemented');
  }
  async validateWebhook({ rawBody, headers }) {
    throw new Error('not implemented');
  }
  async decodeWebhookPayload({ rawBody }) {
    throw new Error('not implemented');
  }
}
```

**Port design rules:**

1. Methods take **plain objects** with primitives — never SDK-native types.
2. Methods return **plain objects** — never SDK-native types.
3. Errors thrown by adapters use a shared error class (e.g., `PaymentProviderError`) so the orchestrator can catch uniformly.
4. The port never references the SDK or any provider-specific concept (no "PhonePe order id" in field names — use `merchantOrderId`).
5. The port lives in `ports/`, never in `providers/`.

## The Adapter

```js
// app/services/payment/providers/phonepe.adapter.js
import {
  StandardCheckoutClient,
  Env,
  StandardCheckoutPayRequest,
} from '@phonepe-pg/pg-sdk-node';
import { PaymentProviderPort } from '../ports/paymentProviderPort.js';

export class PhonePeAdapter extends PaymentProviderPort {
  constructor() {
    super();
    this._client = StandardCheckoutClient.getInstance(/* ... */);
  }

  async initiatePayment({ merchantOrderId, amountPaise, redirectUrl }) {
    const req = StandardCheckoutPayRequest.builder()
      .merchantOrderId(merchantOrderId)
      .amount(amountPaise)
      .redirectUrl(redirectUrl)
      .build();
    const resp = await this._client.pay(req);
    return { redirectUrl: resp.redirectUrl, providerOrderId: resp.orderId };
  }
  // ... other methods ...
}
```

**Adapter design rules:**

1. The adapter is the **only** file that imports the SDK.
2. The adapter translates between **port shape** ⇄ **SDK shape**.
3. The adapter maps SDK errors into a shared error class with `statusCode`.
4. The adapter holds its own SDK client as a private singleton.
5. Adapters never import each other or the orchestrator.

## The Registry

```js
// app/services/payment/providerRegistry.js
import { PhonePeAdapter } from './providers/phonepe.adapter.js';
// import { RazorpayAdapter } from './providers/razorpay.adapter.js';

let _instance = null;

export function getActivePaymentProvider() {
  if (_instance) return _instance;
  const name = process.env.PAYMENT_PROVIDER || 'phonepe';
  switch (name) {
    case 'phonepe':  _instance = new PhonePeAdapter();  break;
    // case 'razorpay': _instance = new RazorpayAdapter(); break;
    default: throw new Error(`Unknown payment provider: ${name}`);
  }
  return _instance;
}

export function resetActivePaymentProvider() { _instance = null; } // for tests
```

**Registry rules:**

1. Selection is driven by **one** environment variable per provider domain.
2. Default is the **current** provider (zero-config compatibility).
3. The registry is the single import point for orchestrators.
4. Provide a `reset()` for tests; never expose internal `_instance`.

## The Orchestrator

The previously hardwired service becomes provider-agnostic:

```js
// app/services/payment/paymentService.js
import { getActivePaymentProvider } from './providerRegistry.js';

export async function createPaymentOrderForOrderRef({ orderRef, amountPaise, redirectUrl }) {
  const provider = getActivePaymentProvider();
  const { redirectUrl: providerUrl, providerOrderId } = await provider.initiatePayment({
    merchantOrderId: orderRef,
    amountPaise,
    redirectUrl,
  });
  // ... persist providerOrderId, return DTO ...
}
```

The orchestrator:
- Never imports an SDK
- Never references a provider name in code (no `if (provider === 'phonepe')`)
- Owns the cross-provider workflow (idempotency, DB writes, queue dispatch)

## Implementation Rules

1. **Only the adapter imports the SDK.** Grep for the SDK package name — exactly one file should match.
2. **The orchestrator never has `if (providerName === ...)` branches.** Behavior differences belong inside adapters.
3. **Port methods are stable.** Adding a new method requires updating every adapter. Prefer adding optional fields to payloads.
4. **Adapters declare a stable response shape per method.** Document each return DTO in the port file's docstring.
5. **Webhook validation lives in the adapter.** The orchestrator receives `{ valid, payload }` from the port.
6. **Provider-native IDs are stored as opaque strings.** Domain models reference them via a single `providerOrderId` field; never assume format.
7. **Feature-flag the swap.** Default `PAYMENT_PROVIDER` to the existing provider; rollback = flip the env var.
8. **Test the orchestrator by mocking the port.** Test each adapter against the provider's sandbox.

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|---|---|
| Orchestrator imports the SDK "just for one helper" | Breaks the abstraction; adding a second provider re-introduces lock-in |
| Port methods that take SDK objects (`StandardCheckoutPayRequest`) | Other adapters cannot satisfy the contract |
| Adapter exposes SDK error types | Orchestrator must know about provider-specific errors |
| Single adapter file containing multiple providers via `if` branches | Just relocates the lock-in; defeats the pattern |
| Registry that reads the env var on every call | Loses adapter singleton; recreates SDK clients hot |
| Storing provider-specific IDs in domain field names (`phonepeOrderId`) | Forces a schema change when adding a new provider |
| Implementing the port as a bare `interface` with no runtime check | Adapters silently miss methods until production |

## Provider Inventory Checklist

When auditing, ensure each external provider has its own port + adapter:

| Provider Domain | Port File | Adapter Files |
|---|---|---|
| Payments | `payment/ports/paymentProviderPort.js` | `phonepe.adapter.js`, `razorpay.adapter.js` |
| SMS | `sms/ports/smsProviderPort.js` | `indiahub.adapter.js`, `twilio.adapter.js` |
| Push | `push/ports/pushProviderPort.js` | `firebase.adapter.js`, `onesignal.adapter.js` |
| Maps | `maps/ports/mapsProviderPort.js` | `googleMaps.adapter.js`, `mapbox.adapter.js` |
| Media | `media/ports/mediaProviderPort.js` | `cloudinary.adapter.js`, `s3.adapter.js` |
| Search | `search/ports/searchProviderPort.js` | `meilisearch.adapter.js`, `algolia.adapter.js` |
| Email | `email/ports/emailProviderPort.js` | `ses.adapter.js`, `sendgrid.adapter.js` |
| Job queue | `jobScheduler/jobSchedulerPort.js` | `bull.adapter.js`, `agenda.adapter.js` |

Some adapters may be the only implementation today. That is fine — the port still earns its keep by enabling tests and isolating the SDK.

## Worked Example: Adding A Second Payment Provider

Goal: support Razorpay alongside PhonePe.

1. **No domain changes.** `paymentService.js` is already provider-agnostic.
2. **Add adapter:** create `providers/razorpay.adapter.js`, implement all port methods.
3. **Register:** add the `case 'razorpay'` branch in `providerRegistry.js`.
4. **Deploy with flag off:** `PAYMENT_PROVIDER=phonepe` in production. Razorpay code is dormant.
5. **Test in staging:** `PAYMENT_PROVIDER=razorpay`. Run end-to-end payment flow.
6. **Canary:** route 5% of production traffic by switching the env var on one instance.
7. **Roll out:** flip the variable cluster-wide. PhonePe stays in code for instant rollback.

Rollback at any point = set `PAYMENT_PROVIDER=phonepe`. No code change. No deploy.

## When NOT To Use This Pattern

- Only one provider exists **and** the SDK is already isolated in a single file (no leakage). Wrapping further adds ceremony without payoff.
- Internal services calling other internal services — use direct imports.
- Pure utilities (logger, money math, date helpers) — no provider exists to swap.

## Related Skills

- `safe-refactor-strategy` — feature-flag rollout pattern used by the registry
- `infrastructure-domain-separation` — where adapters live in the target architecture
- `domain-service-extraction` — extract domain logic out before introducing the port

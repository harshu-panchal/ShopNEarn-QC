# `modules/customer/components/checkout/`

Per-page subcomponent home for `pages/CheckoutPage.jsx` (43 KB today).
Scaffolded as part of refactor P4.4 / P4.5 (Part 3) — the decomposition is
incremental, single-PR-per-step. See `frontend-page-decomposition` skill.

## Target layout

```
modules/customer/components/checkout/
├── AddressStep.jsx          # address picker + add-new-address flow
├── PaymentStep.jsx          # ONLINE / COD / WALLET selector
├── OrderSummary.jsx         # cart + pricing breakdown + tip
├── CouponInput.jsx          # coupon code apply/remove
├── DeliverySlotPicker.jsx   # express vs. scheduled slot
└── index.js                 # barrel re-exports
```

## Decomposition rules (per `frontend-page-decomposition` skill)

1. Extract sub-components into this directory **first**. Do NOT promote
   them to `@shared/components/ui` until a second page actually needs them.
2. After each extraction the `CheckoutPage.jsx` shell should:
   - call `useCheckout()` from `modules/customer/hooks`
   - call `useCart()` from `modules/customer/context/CartContext`
   - render the extracted sub-components, passing state in via props and
     callbacks out via `on...` handlers.
3. The end state is a **shell < 300 lines** that does no inline UI markup
   for steps — every step is a sub-component here.
4. Sub-components are pure presentational where possible (props in,
   callbacks out). They MUST NOT import `axios` or `customerApi` directly.

## Migration status

| Step                 | Status     | Extracted |
| -------------------- | ---------- | --------- |
| Scaffolding          | complete   | (this README + barrel) |
| AddressStep.jsx      | pending    |           |
| PaymentStep.jsx      | pending    |           |
| OrderSummary.jsx     | pending    |           |
| CouponInput.jsx      | pending    |           |
| DeliverySlotPicker   | pending    |           |

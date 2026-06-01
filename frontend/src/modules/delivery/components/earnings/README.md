# `modules/delivery/components/earnings/`

Per-page subcomponent home for the delivery partner earnings pages.
Scaffolded as part of refactor P4.6 / P4.7 (Part 3).

## Consolidation note (WC-05)

The delivery module currently has **two near-duplicate pages**:

- `pages/Earnings.jsx`     — 13 KB, older, slightly fewer fields
- `pages/EarningsPage.jsx` — 10 KB, newer, includes `tipsReceived`

Both consume `deliveryApi.getEarnings()` and the *server* response shape
returned by `DeliveryEarningsService.getDeliveryEarnings()` (refactor P2.4)
already contains every field both pages need. Consolidation path:

1. Decide the canonical route. Today both files are imported from
   `routes/index.jsx` — pick the one wired to `/delivery/earnings` and
   keep that filename.
2. Move the union of fields and the tips display into the canonical file.
3. Replace the deprecated file with a one-line re-export shim:
   `export { default } from "./Earnings";` (or vice versa).
4. After one release the shim file can be deleted.

This work is **deferred to its own PR** so the consolidation can be
reviewed in isolation. The scaffold for the eventual extracted components
lives here so the refactor doesn't have to invent the directory.

## Target layout

```
modules/delivery/components/earnings/
├── EarningsSummary.jsx     # today / week / month stat cards
├── EarningsChart.jsx       # 7-day bar chart
├── TipsBreakdown.jsx       # tips received (per-order detail)
├── TransactionList.jsx     # recent 20 transactions
└── index.js
```

## Migration status

| Component                       | Status   |
| ------------------------------- | -------- |
| Scaffolding                     | complete |
| Earnings.jsx + EarningsPage.jsx | duplicate (consolidate in next PR) |
| EarningsSummary.jsx             | pending  |
| EarningsChart.jsx               | pending  |
| TipsBreakdown.jsx               | pending  |
| TransactionList.jsx             | pending  |

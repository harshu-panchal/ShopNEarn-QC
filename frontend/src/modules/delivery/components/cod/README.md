# `modules/delivery/components/cod/`

Per-page subcomponent home for `pages/CodCash.jsx`. Scaffolded as part of
refactor P4.7 (Part 3).

The backend already has a cache-fronted `getDeliveryCodCashSummary` service
(extracted in P2.4 → `services/delivery/deliveryEarningsService.js`). The
frontend pieces below are pure presentational and consume that payload.

## Target layout

```
modules/delivery/components/cod/
├── CodCashSummary.jsx       # system float / cash-in-hand stat cards
├── ToRemitList.jsx          # orders marked-collected awaiting handover
├── ToCollectList.jsx        # orders still owed by customers
├── CodSubmissionForm.jsx    # daily cash submission
└── index.js
```

## Migration status

| Component             | Status   |
| --------------------- | -------- |
| Scaffolding           | complete |
| CodCashSummary.jsx    | pending  |
| ToRemitList.jsx       | pending  |
| ToCollectList.jsx     | pending  |
| CodSubmissionForm.jsx | pending  |

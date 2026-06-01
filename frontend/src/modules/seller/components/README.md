# `modules/seller/components/`

Home for **per-page sub-components** extracted from monolithic page files in
`modules/seller/pages/`. This directory was scaffolded as part of refactor
P4.7.

## Layout

```
modules/seller/components/
├── orders/             # extracted from pages/Orders.jsx
├── products/           # extracted from pages/ProductManagement.jsx
├── returns/            # extracted from pages/Returns.jsx
├── earnings/           # extracted from pages/Earnings.jsx
└── shared/             # only after a second consumer exists inside seller/
```

## Extraction rules (per `frontend-page-decomposition` skill)

1. Extract sub-components **into the per-page subfolder first**
   (`components/orders/...`). Do NOT promote to `shared/components/ui/` until
   a second page actually needs the component.
2. The parent page file must end up as a **shell of < 300 lines** that does
   only:
   - data fetching (via `useApiState`)
   - composition of sub-components
   - high-level state coordination
3. Sub-components are **pure presentational** when possible (props in,
   callbacks out). Hooks for shared data fetching live alongside the parent
   page or under `modules/seller/hooks/`.
4. One extraction per PR — see the `safe-refactor-strategy` skill.

## Migration status

| Page                   | Status        | Extracted components |
| ---------------------- | ------------- | -------------------- |
| Orders.jsx             | In progress   | `orders/orderStatusUtils` (P4.6) |
| ProductManagement.jsx  | Scaffolded    | `products/` README + barrel (P4.4 Part 3) |
| Returns.jsx            | Scaffolded    | `returns/` README + barrel (P4.7 Part 3) |
| Earnings.jsx           | Scaffolded    | `earnings/` README + barrel (P4.7 Part 3) |

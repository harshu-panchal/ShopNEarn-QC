# `modules/seller/components/products/`

Per-page subcomponent home for `pages/ProductManagement.jsx` (65 KB).
Scaffolded as part of refactor P4.4 (Part 3).

## Target layout

```
modules/seller/components/products/
├── ProductListTable.jsx     # grid/table with thumbnail + stock + status
├── ProductFilters.jsx       # search, category, status pickers
├── ProductFormModal.jsx     # create / edit form
├── ProductImageUpload.jsx   # multi-image dropzone + cloudinary upload
├── ProductVariantEditor.jsx # variant rows (price / stock / unit)
├── ProductBulkActions.jsx   # bulk approve/reject/archive
└── index.js                 # barrel
```

## Decomposition rules

See the parent `modules/seller/components/README.md` and the
`frontend-page-decomposition` skill. Same rules as `orders/`.

## Migration status

| Component               | Status   |
| ----------------------- | -------- |
| Scaffolding             | complete |
| ProductListTable.jsx    | pending  |
| ProductFilters.jsx      | pending  |
| ProductFormModal.jsx    | pending  |
| ProductImageUpload.jsx  | pending  |
| ProductVariantEditor.jsx| pending  |
| ProductBulkActions.jsx  | pending  |

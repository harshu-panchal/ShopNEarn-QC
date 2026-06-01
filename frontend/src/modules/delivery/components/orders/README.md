# `modules/delivery/components/orders/`

Per-page subcomponent home for the delivery partner order pages —
primarily `pages/OrderDetails.jsx` (47 KB) and `pages/Dashboard.jsx`.
Scaffolded as part of refactor P4.6 / P4.7 (Part 3).

## Target layout

```
modules/delivery/components/orders/
├── DeliveryOrderCard.jsx    # nearby-order broadcast card with accept
├── OrderStatusTimeline.jsx  # accepted → picked → out → delivered timeline
├── OtpVerifyModal.jsx       # 4-digit OTP entry for delivery completion
├── PickupCustomerInfo.jsx   # seller/customer contact + nav
├── DeliveryProofUpload.jsx  # photo proof (already exists as
│                            #   ReturnPickupProofUpload — promote here)
└── index.js
```

## Migration status

| Component                | Status   |
| ------------------------ | -------- |
| Scaffolding              | complete |
| DeliveryOrderCard.jsx    | pending  |
| OrderStatusTimeline.jsx  | pending  |
| OtpVerifyModal.jsx       | pending  |
| PickupCustomerInfo.jsx   | pending  |
| DeliveryProofUpload.jsx  | pending  |

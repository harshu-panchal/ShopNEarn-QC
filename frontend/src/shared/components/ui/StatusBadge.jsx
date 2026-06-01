import React from 'react';
import Badge from './Badge';

/**
 * StatusBadge
 *
 * Single, shared mapping from domain status strings (order status, return
 * status, payment status, payout status) to badge colors. Eliminates the
 * scattered `getStatusColor()` helpers re-implemented in every page.
 *
 *   <StatusBadge status={order.status} />
 *   <StatusBadge status={payment.paymentStatus} kind="payment" />
 *
 * `kind` lets the same status string map to different colors when it has
 * different meaning across domains. If `kind` is unknown, falls through to
 * the default mapping. Unknown statuses render as `gray`.
 */

const ORDER_STATUS_VARIANT = {
    pending: 'yellow',
    confirmed: 'blue',
    packed: 'blue',
    out_for_delivery: 'blue',
    delivered: 'green',
    cancelled: 'red',
    returned: 'red',
    return_requested: 'yellow',
    return_approved: 'blue',
    return_rejected: 'red',
    return_pickup_assigned: 'blue',
    return_completed: 'green',
};

const PAYMENT_STATUS_VARIANT = {
    PAID: 'green',
    CAPTURED: 'green',
    PENDING: 'yellow',
    CREATED: 'gray',
    FAILED: 'red',
    REFUNDED: 'gray',
};

const PAYOUT_STATUS_VARIANT = {
    pending: 'yellow',
    on_hold: 'yellow',
    released: 'green',
    failed: 'red',
};

function pickVariant(status, kind) {
    if (!status) return 'gray';
    const key = String(status);
    switch (kind) {
        case 'payment':
            return PAYMENT_STATUS_VARIANT[key.toUpperCase()] || 'gray';
        case 'payout':
            return PAYOUT_STATUS_VARIANT[key.toLowerCase()] || 'gray';
        case 'order':
        default:
            return ORDER_STATUS_VARIANT[key.toLowerCase()] || 'gray';
    }
}

function formatLabel(status) {
    if (!status) return '';
    return String(status)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

const StatusBadge = ({ status, kind = 'order', className }) => {
    const variant = pickVariant(status, kind);
    return (
        <Badge variant={variant} className={className}>
            {formatLabel(status)}
        </Badge>
    );
};

export default StatusBadge;

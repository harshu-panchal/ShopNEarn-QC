import React from 'react';
import { RotateCcw } from 'lucide-react';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer Refund & Cancellation Policy. Content is managed by
 * Admin → Legal Pages (app: customer, slug: refund-policy). The
 * static body below is a fallback only, shown until an admin
 * publishes the real copy.
 */
const RefundPage = () => {
    const fallback = (
        <>
            <p>
                Please review how refunds and cancellations are handled below.
                If your situation isn&apos;t covered here, reach out to our
                support team for assistance.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Cancellation
            </h3>
            <p>
                Orders can be cancelled before they are dispatched. Once
                shipped, please follow the return flow from your order
                details page.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Refunds
            </h3>
            <p>
                Refunds are processed to the original payment method within
                5–7 business days. Wallet credits are reversed immediately.
            </p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="refund-policy"
            fallbackTitle="Refund & Cancellation Policy"
            fallbackContent={fallback}
            headerIcon={<RotateCcw size={24} />}
        />
    );
};

export default RefundPage;

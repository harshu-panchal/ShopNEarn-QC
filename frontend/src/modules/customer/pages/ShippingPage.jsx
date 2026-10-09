import React from 'react';
import { Truck } from 'lucide-react';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer Shipping & Delivery Policy. Content is managed by
 * Admin → Legal Pages (app: customer, slug: shipping-policy). The
 * static body below is a fallback only, shown until an admin
 * publishes the real copy.
 */
const ShippingPage = () => {
    const fallback = (
        <>
            <p>
                Here&apos;s how delivery works, including zones, timelines,
                and charges.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Delivery Zones
            </h3>
            <p>
                We currently deliver to selected cities. Enter your pin code
                at checkout to confirm availability in your area.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Timelines
            </h3>
            <p>
                Express delivery (within 30 minutes) is available for select
                categories, with standard same-day delivery for orders placed
                before 6 PM.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Charges
            </h3>
            <p>
                Delivery fees are calculated based on distance and order
                value. The exact amount is shown at checkout.
            </p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="shipping-policy"
            fallbackTitle="Shipping & Delivery Policy"
            fallbackContent={fallback}
            headerIcon={<Truck size={24} />}
        />
    );
};

export default ShippingPage;

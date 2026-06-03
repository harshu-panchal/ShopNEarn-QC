import React from 'react';
import { useParams } from 'react-router-dom';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Delivery-app renderer for any admin-published legal page. Mounted on
 * `/delivery/legal/:slug` (and aliased by `/delivery/privacy`,
 * `/delivery/terms`, `/delivery/about`). Slugs are configured under
 * Admin → Legal Pages → Delivery App.
 */
const DeliveryLegalPage = ({ slug: slugProp }) => {
    const { slug: slugParam } = useParams();
    const slug = slugProp || slugParam;

    return (
        <LegalPageView
            app="delivery"
            slug={slug}
            fallbackTitle="Information"
            fallbackContent={
                <p className="text-slate-500 italic">
                    This page hasn&apos;t been published yet. Please check back soon.
                </p>
            }
        />
    );
};

export default DeliveryLegalPage;

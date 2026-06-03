import React from 'react';
import { useParams } from 'react-router-dom';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Seller-app renderer for any admin-published legal page. Mounted on
 * `/seller/legal/:slug` (and aliased by `/seller/privacy`,
 * `/seller/terms`, `/seller/about`). The slug is the same one admins
 * choose under Admin → Legal Pages → Seller App.
 */
const SellerLegalPage = ({ slug: slugProp }) => {
    const { slug: slugParam } = useParams();
    const slug = slugProp || slugParam;

    return (
        <LegalPageView
            app="seller"
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

export default SellerLegalPage;

import React from 'react';
import { ScrollText } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer Terms & Conditions. Admin-editable via Admin → Legal Pages
 * (app: customer, slug: terms-of-service). Static fallback rendered
 * only if no published page exists.
 */
const TermsPage = () => {
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';
    const companyName = settings?.companyName || appName;

    const fallback = (
        <>
            <p>
                Welcome to {appName}. By accessing or using our mobile application
                and services, you agree to be bound by these Terms and Conditions.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                1. Acceptance of Terms
            </h3>
            <p>
                By creating an account or using our services, you agree to comply
                with these terms. If you do not agree, you may not use our services.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                2. Use of Service
            </h3>
            <p>
                You must be at least 18 years old to use our services. You agree to
                provide accurate information during registration and to keep your
                account secure.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                3. Orders and Payments
            </h3>
            <p>
                All orders are subject to availability. Prices are subject to
                change without notice. We reserve the right to cancel orders at our
                discretion.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                4. Intellectual Property
            </h3>
            <p>
                All content, trademarks, and data on this app are the property of{' '}
                {companyName} and are protected by law.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                5. Termination
            </h3>
            <p>
                We reserve the right to end or suspend your account at any time for
                violation of these terms.
            </p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="terms-of-service"
            fallbackTitle="Terms & Conditions"
            fallbackContent={fallback}
            headerIcon={<ScrollText size={24} />}
        />
    );
};

export default TermsPage;

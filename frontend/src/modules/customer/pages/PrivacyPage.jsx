import React from 'react';
import { Shield } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer Privacy Policy. Content is managed by Admin → Legal Pages
 * (app: customer, slug: privacy-policy). The static body below is
 * rendered as a graceful fallback only when no published page exists,
 * so legacy installs keep showing something usable until an admin
 * publishes the new copy.
 */
const PrivacyPage = () => {
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';

    const fallback = (
        <>
            <p>
                At {appName}, we take your privacy seriously. This Privacy Policy
                explains how we collect, use, and protect your personal information.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                1. Information We Collect
            </h3>
            <p>
                We collect information you provide directly, such as your name,
                address, phone number, and payment details. We also collect usage
                data automatically.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                2. How We Use Information
            </h3>
            <p>
                We use your data to process orders, improve our services, and
                communicate with you about promotions and updates.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                3. Data Security
            </h3>
            <p>
                We implement industry-standard security measures to protect your
                data. However, no method of transmission is 100% secure.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                4. Sharing of Information
            </h3>
            <p>
                We do not sell your personal data. We may share data with service
                providers (e.g., delivery partners) as necessary to fulfill your
                orders.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                5. Your Rights
            </h3>
            <p>
                You have the right to access, correct, or delete your personal
                data. Contact our support team for assistance.
            </p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="privacy-policy"
            fallbackTitle="Privacy Policy"
            fallbackContent={fallback}
            headerIcon={<Shield size={24} />}
        />
    );
};

export default PrivacyPage;

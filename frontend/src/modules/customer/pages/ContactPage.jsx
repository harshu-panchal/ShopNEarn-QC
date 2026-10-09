import React from 'react';
import { Mail } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer "Contact Us" info page. Content is managed by
 * Admin → Legal Pages (app: customer, slug: contact-us). The
 * static body below is a fallback only, shown until an admin
 * publishes the real copy.
 */
const ContactPage = () => {
    const { settings } = useSettings();

    const fallback = (
        <>
            <p>We&apos;re here to help. Reach out to us through any of the channels below.</p>
            <ul className="list-disc pl-5 space-y-1">
                {settings?.supportEmail && <li><strong>Email:</strong> {settings.supportEmail}</li>}
                {settings?.supportPhone && <li><strong>Phone:</strong> {settings.supportPhone}</li>}
                {settings?.address && <li><strong>Address:</strong> {settings.address}</li>}
            </ul>
            <p>Our customer support team is available Monday–Saturday, 9 AM to 9 PM.</p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="contact-us"
            fallbackTitle="Contact Us"
            fallbackContent={fallback}
            headerIcon={<Mail size={24} />}
        />
    );
};

export default ContactPage;

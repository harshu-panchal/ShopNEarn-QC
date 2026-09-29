import React from 'react';
import { useParams } from 'react-router-dom';
import { Shield, FileText, Info } from 'lucide-react';
import LegalPageView from '@core/components/LegalPageView';
import { useSettings } from '@core/context/SettingsContext';

const PrivacyFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            At <strong>{appName}</strong>, we are committed to protecting the privacy and security of our seller
            partners. This Privacy Policy explains what data we collect, how we use it, and the choices you have.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">1. Information We Collect</h3>
        <p className="text-slate-600 leading-relaxed">When you register and operate as a seller on {appName}, we collect:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Business Information:</strong> Store name, business address, GSTIN, PAN, and business category.</li>
            <li><strong>Personal Details:</strong> Owner name, email address, and mobile number.</li>
            <li><strong>Bank & Payment Details:</strong> Account holder name, account number, IFSC code, and UPI ID used for settlement.</li>
            <li><strong>Identity Documents:</strong> Aadhaar, PAN card, and any other KYC documents uploaded during verification.</li>
            <li><strong>Product & Inventory Data:</strong> Product listings, pricing, stock levels, and images you upload.</li>
            <li><strong>Transaction Records:</strong> Order history, earnings, withdrawal requests, and payment settlements.</li>
            <li><strong>Location Data:</strong> Your store's geographic location and service radius for order assignment.</li>
            <li><strong>Device & Usage Data:</strong> Browser/device info, IP address, and platform activity logs.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">2. How We Use Your Information</h3>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li>Verify your identity and approve your seller account.</li>
            <li>Process orders, calculate earnings, and settle payments to your bank account.</li>
            <li>Display your store and products to customers in your service area.</li>
            <li>Send order alerts, payout confirmations, and platform updates via SMS, email, or push notifications.</li>
            <li>Detect fraud, resolve disputes, and enforce our Seller Terms of Service.</li>
            <li>Analyse platform performance and improve our services.</li>
            <li>Comply with applicable laws, tax regulations, and government requests.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">3. Information Sharing</h3>
        <p className="text-slate-600 leading-relaxed">
            We do <strong>not</strong> sell your personal data. We share your information only in these circumstances:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Customers:</strong> Your store name, store location, and product details are visible to customers placing orders.</li>
            <li><strong>Delivery Partners:</strong> Your store address and order details are shared with the assigned delivery partner to fulfil orders.</li>
            <li><strong>Payment Processors:</strong> Bank account details are shared with our payment gateway solely for settlement.</li>
            <li><strong>Legal Authorities:</strong> When required by law, court order, or to protect platform integrity.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">4. Document & Data Security</h3>
        <p className="text-slate-600 leading-relaxed">
            All KYC documents (Aadhaar, PAN, etc.) are stored in encrypted form on secure cloud servers with restricted access.
            Bank account details are encrypted at rest and in transit. Only authorised {appName} personnel can access
            sensitive records, and only for verification or dispute resolution purposes.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">5. Data Retention</h3>
        <p className="text-slate-600 leading-relaxed">
            We retain your account data for as long as your seller account is active. After account deletion, we may retain
            transaction records and KYC documents for up to 7 years as required by tax and financial regulations.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">6. Your Rights</h3>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
            <li><strong>Correction:</strong> Update incorrect information via your seller profile settings.</li>
            <li><strong>Deletion:</strong> Request account deletion — subject to retention obligations above.</li>
            <li><strong>Portability:</strong> Request an export of your transaction and product data.</li>
        </ul>
        <p className="text-slate-600 mt-2 leading-relaxed">
            To exercise any right, contact our Seller Support team via the Help &amp; Support page.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">7. Changes to This Policy</h3>
        <p className="text-slate-600 leading-relaxed">
            We may update this Privacy Policy from time to time. Significant changes will be communicated via email or an
            in-app notice. Continued use of the platform after the effective date constitutes acceptance of the revised policy.
        </p>
    </>
);

const TermsFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            These Terms of Service govern your use of the <strong>{appName}</strong> Seller Platform. By registering as a
            seller you agree to these terms in full.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">1. Seller Eligibility</h3>
        <p className="text-slate-600 leading-relaxed">
            You must be at least 18 years old, hold a valid GST registration (where applicable), and provide accurate KYC
            documents during onboarding. False information will result in immediate account suspension.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">2. Product Listings</h3>
        <p className="text-slate-600 leading-relaxed">
            You are solely responsible for the accuracy of your product titles, descriptions, images, and pricing. Prohibited
            items (counterfeit goods, restricted substances, items banned under Indian law) are strictly disallowed and will
            result in listing removal and possible legal action.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">3. Order Fulfilment</h3>
        <p className="text-slate-600 leading-relaxed">
            Once an order is placed, you must confirm it promptly and keep the item ready for pickup. Repeated order
            cancellations or delays will negatively affect your seller rating and may lead to account suspension.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">4. Payments & Settlements</h3>
        <p className="text-slate-600 leading-relaxed">
            Earnings are calculated after deducting the applicable platform commission and any applicable taxes. Settlements
            are processed within the timeline stated in your seller dashboard. Withdrawal requests are subject to minimum
            balance requirements.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">5. Platform Commission</h3>
        <p className="text-slate-600 leading-relaxed">
            {appName} charges a commission on each completed order as disclosed during onboarding. Commission rates may be
            revised with 15 days&apos; prior notice.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">6. Account Suspension & Termination</h3>
        <p className="text-slate-600 leading-relaxed">
            We reserve the right to suspend or terminate your account for policy violations, fraudulent activity, chargebacks,
            or negative customer feedback patterns. You may appeal a suspension by contacting Seller Support.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">7. Governing Law</h3>
        <p className="text-slate-600 leading-relaxed">
            These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of
            courts in the city where {appName} is registered.
        </p>
    </>
);

const AboutFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            <strong>{appName}</strong> is a hyperlocal commerce platform connecting customers with local sellers and
            delivery partners for fast, reliable last-mile delivery.
        </p>
        <h3 className="text-slate-800 font-bold text-base mt-6">Our Mission for Sellers</h3>
        <p className="text-slate-600 leading-relaxed">
            We believe every local business deserves the technology and reach of a large e-commerce platform. {appName}
            provides sellers with a zero-setup digital storefront, real-time order management, and direct bank settlements
            — so you can focus on what you do best: running your business.
        </p>
        <h3 className="text-slate-800 font-bold text-base mt-6">Contact Us</h3>
        <p className="text-slate-600 leading-relaxed">
            For seller-specific queries, visit our Help &amp; Support page or reach out to the Seller Success team.
        </p>
    </>
);

const SLUG_CONFIG = {
    'privacy-policy': {
        title: 'Privacy Policy',
        icon: <Shield size={24} />,
        Fallback: PrivacyFallback,
    },
    'terms-of-service': {
        title: 'Terms of Service',
        icon: <FileText size={24} />,
        Fallback: TermsFallback,
    },
    'about': {
        title: 'About Us',
        icon: <Info size={24} />,
        Fallback: AboutFallback,
    },
};

const SellerLegalPage = ({ slug: slugProp }) => {
    const { slug: slugParam } = useParams();
    const slug = slugProp || slugParam;
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';

    const config = SLUG_CONFIG[slug];
    const Fallback = config?.Fallback;

    return (
        <LegalPageView
            app="seller"
            slug={slug}
            fallbackTitle={config?.title || 'Information'}
            headerIcon={config?.icon || <FileText size={24} />}
            fallbackContent={
                Fallback
                    ? <Fallback appName={appName} />
                    : <p className="text-slate-500 italic">This page hasn&apos;t been published yet. Please check back soon.</p>
            }
        />
    );
};

export default SellerLegalPage;

import React from 'react';
import { useParams } from 'react-router-dom';
import { Shield, FileText, Info } from 'lucide-react';
import LegalPageView from '@core/components/LegalPageView';
import { useSettings } from '@core/context/SettingsContext';

const PrivacyFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            At <strong>{appName}</strong>, we value the trust our delivery partners place in us. This Privacy Policy
            explains what personal data we collect from delivery partners, how we use it, and the rights you have over it.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">1. Information We Collect</h3>
        <p className="text-slate-600 leading-relaxed">As a delivery partner, we collect the following data:</p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Personal Details:</strong> Full name, mobile number, email address, and date of birth.</li>
            <li><strong>Identity Documents:</strong> Aadhaar card, PAN card, and driving licence for KYC verification.</li>
            <li><strong>Vehicle Information:</strong> Vehicle type, registration number, driving licence number, and insurance details.</li>
            <li><strong>Bank Details:</strong> Account holder name, account number, IFSC code, and UPI ID for earnings settlement.</li>
            <li><strong>Real-Time Location:</strong> GPS coordinates while you are on an active delivery. Location tracking stops when you go offline.</li>
            <li><strong>Earnings & Trip Data:</strong> Order history, delivery timestamps, distances covered, earnings, and withdrawal records.</li>
            <li><strong>Device & App Data:</strong> Device model, OS version, app version, and crash/error logs for technical support.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">2. Location Tracking</h3>
        <p className="text-slate-600 leading-relaxed">
            Location tracking is active <strong>only while you are online and assigned to an order</strong>. Your live location
            is shared with the seller (for pickup) and the customer (for delivery tracking) during an active trip. Once you
            mark yourself offline or complete a delivery, location data is no longer collected in real time. Historical route
            data may be retained for dispute resolution.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">3. How We Use Your Information</h3>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li>Verify your identity and onboard you as a delivery partner.</li>
            <li>Assign orders based on your proximity and availability.</li>
            <li>Calculate earnings, incentives, and process bank settlements.</li>
            <li>Share your name and vehicle details with customers for the duration of their delivery.</li>
            <li>Send trip alerts, payout notifications, and platform updates.</li>
            <li>Investigate accidents, disputes, or complaints related to a delivery.</li>
            <li>Comply with traffic, insurance, and tax regulations.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">4. Information Sharing</h3>
        <p className="text-slate-600 leading-relaxed">
            We do <strong>not</strong> sell your data. We share it only as described below:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Customers:</strong> Your first name and vehicle type are shared during an active delivery so the customer can identify you.</li>
            <li><strong>Sellers:</strong> Your name and ETA are shared so sellers can prepare the order for pickup.</li>
            <li><strong>Payment Partners:</strong> Bank account details shared with our payment gateway for settlement only.</li>
            <li><strong>Legal Authorities:</strong> When required by law or to protect platform safety.</li>
        </ul>

        <h3 className="text-slate-800 font-bold text-base mt-6">5. Document & Data Security</h3>
        <p className="text-slate-600 leading-relaxed">
            KYC documents are stored encrypted on secure servers with access limited to authorised verification personnel.
            All data transmissions use HTTPS/TLS encryption. Bank details are masked in the app and stored encrypted at rest.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">6. Data Retention</h3>
        <p className="text-slate-600 leading-relaxed">
            Your account data is retained as long as your account is active. Upon account deletion, transaction records and
            KYC documents may be retained for up to 7 years to meet legal and tax obligations.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">7. Your Rights</h3>
        <ul className="list-disc pl-5 space-y-1 text-slate-600 mt-2">
            <li><strong>Access:</strong> Request the personal data we hold about you.</li>
            <li><strong>Correction:</strong> Update your profile details via the app.</li>
            <li><strong>Deletion:</strong> Request account deletion from the Profile → Settings page.</li>
            <li><strong>Opt-out of Marketing:</strong> Disable promotional notifications from the app Settings.</li>
        </ul>
        <p className="text-slate-600 mt-2">
            To exercise any of these rights, contact our Delivery Support team via the Help &amp; Support page.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">8. Changes to This Policy</h3>
        <p className="text-slate-600 leading-relaxed">
            We may revise this policy periodically. We will notify you via the app or SMS before significant changes take
            effect. Continued use of the {appName} Delivery Partner app constitutes acceptance of the updated policy.
        </p>
    </>
);

const TermsFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            These Terms of Service govern your engagement as a delivery partner on the <strong>{appName}</strong> platform.
            By registering you agree to these terms.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">1. Eligibility</h3>
        <p className="text-slate-600 leading-relaxed">
            You must be at least 18 years old, hold a valid driving licence for your vehicle type, and provide accurate
            KYC documents. You are an independent contractor, not an employee of {appName}.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">2. Deliveries & Conduct</h3>
        <p className="text-slate-600 leading-relaxed">
            You must handle all packages with care, follow traffic rules at all times, and treat customers and sellers
            with respect. Any misconduct may result in immediate account suspension.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">3. Earnings & Payments</h3>
        <p className="text-slate-600 leading-relaxed">
            Earnings are calculated per completed delivery based on the rate card applicable at the time. COD amounts
            collected must be deposited as per platform guidelines. Settlement is processed after reconciliation.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">4. Safety & Insurance</h3>
        <p className="text-slate-600 leading-relaxed">
            You are responsible for maintaining valid vehicle insurance. {appName} provides supplemental safety features
            (SOS, emergency contacts) but is not liable for accidents or injuries during deliveries.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">5. Termination</h3>
        <p className="text-slate-600 leading-relaxed">
            Either party may terminate this agreement at any time. {appName} reserves the right to deactivate accounts for
            policy violations, fraud, or sustained low ratings without prior notice.
        </p>

        <h3 className="text-slate-800 font-bold text-base mt-6">6. Governing Law</h3>
        <p className="text-slate-600 leading-relaxed">
            These terms are governed by the laws of India. Disputes shall be subject to the jurisdiction of courts in the
            city where {appName} is registered.
        </p>
    </>
);

const AboutFallback = ({ appName }) => (
    <>
        <p className="text-slate-600 leading-relaxed">
            <strong>{appName}</strong> is a hyperlocal commerce and delivery platform that connects local sellers with
            customers for fast, reliable last-mile delivery.
        </p>
        <h3 className="text-slate-800 font-bold text-base mt-6">Our Delivery Partner Programme</h3>
        <p className="text-slate-600 leading-relaxed">
            Our delivery partners are the backbone of our service. We provide flexible earning opportunities, real-time
            order management, and transparent settlements so you can grow your income on your own schedule.
        </p>
        <h3 className="text-slate-800 font-bold text-base mt-6">Contact Us</h3>
        <p className="text-slate-600 leading-relaxed">
            For delivery partner queries, visit the Help &amp; Support page or contact our Rider Support team.
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

const DeliveryLegalPage = ({ slug: slugProp }) => {
    const { slug: slugParam } = useParams();
    const slug = slugProp || slugParam;
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';

    const config = SLUG_CONFIG[slug];
    const Fallback = config?.Fallback;

    return (
        <LegalPageView
            app="delivery"
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

export default DeliveryLegalPage;

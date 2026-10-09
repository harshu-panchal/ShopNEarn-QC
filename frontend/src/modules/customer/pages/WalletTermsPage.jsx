import React from 'react';
import { WalletCards } from 'lucide-react';
import LegalPageView from '@core/components/LegalPageView';

/**
 * Customer Wallet Terms. Content is managed by Admin → Legal Pages
 * (app: customer, slug: wallet-terms). The static body below is a
 * fallback only, shown until an admin publishes the real copy.
 */
const WalletTermsPage = () => {
    const fallback = (
        <>
            <p>
                These terms govern the use of your in-app wallet, including
                how credits are earned, used, and withdrawn.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Earning Wallet Credits
            </h3>
            <p>
                Wallet credits may be earned from cashback, referral rewards,
                and order refunds, as described within the app.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Using Wallet Credits
            </h3>
            <p>
                Wallet balance is automatically applied at checkout, subject
                to any limits shown at the time of payment.
            </p>
            <h3 className="text-slate-800 font-bold text-base mt-6">
                Validity & Withdrawals
            </h3>
            <p>
                Wallet credits are non-transferable unless explicitly stated.
                Withdrawal eligibility and timelines may vary by credit type.
            </p>
        </>
    );

    return (
        <LegalPageView
            app="customer"
            slug="wallet-terms"
            fallbackTitle="Wallet Terms"
            fallbackContent={fallback}
            headerIcon={<WalletCards size={24} />}
        />
    );
};

export default WalletTermsPage;

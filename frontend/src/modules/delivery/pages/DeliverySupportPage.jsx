import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Mail, FileText, ChevronLeft, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import axiosInstance from '@core/api/axios';

const STATIC_FAQS = [
    {
        _id: 'd1',
        question: 'How do I accept and start a delivery?',
        answer: 'When a new order is assigned, you will receive an alert on your dashboard. Tap the order to view pickup and drop details, then tap Accept. Navigate to the seller\'s location to pick up the package, and use the in-app map to reach the customer.',
    },
    {
        _id: 'd2',
        question: 'How are my earnings calculated?',
        answer: 'Your earnings are based on a per-delivery rate that considers the order value and distance. Additional incentives may apply during peak hours or high-demand periods. You can view a full breakdown in the Earnings tab.',
    },
    {
        _id: 'd3',
        question: 'When and how will I receive my payment?',
        answer: 'Completed delivery earnings are credited to your in-app wallet. You can request a withdrawal at any time from Profile → Money Request. Bank transfers are processed within 2–5 business days.',
    },
    {
        _id: 'd4',
        question: 'What if I cannot find the customer\'s location?',
        answer: 'Use the in-app navigation for turn-by-turn directions. If you\'re still unable to locate the address, call the customer directly using the Call button on the active order screen. If the customer is unreachable, contact Delivery Support.',
    },
    {
        _id: 'd5',
        question: 'How do I handle a Cash on Delivery (COD) order?',
        answer: 'For COD orders, collect the exact order amount from the customer at delivery. The collected amount will show as a COD balance in your app. You are required to deposit this amount to the platform as per the schedule shown in the COD Cash section.',
    },
    {
        _id: 'd6',
        question: 'What should I do if a package is damaged or lost?',
        answer: 'Immediately report any damage or loss through the app by tapping Report Issue on the active order. Take photographs of the package and its condition. Do not attempt to resolve damage disputes with the customer directly — our support team will handle it.',
    },
    {
        _id: 'd7',
        question: 'How do I update my vehicle or bank account details?',
        answer: 'Go to Profile → Vehicle Information to update your vehicle details. For bank account changes, go to Profile → Bank Account and submit a change request with a cancelled cheque or passbook copy for verification.',
    },
];

const DeliverySupportPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const supportEmail = settings?.supportEmail || '';
    const supportPhone = settings?.supportPhone || '';
    const [faqs, setFaqs] = useState([]);

    useEffect(() => {
        axiosInstance
            .get('/public/faqs', { params: { category: 'Delivery', status: 'published' } })
            .then((res) => {
                const data = res.data?.result ?? res.data;
                const list = Array.isArray(data?.items)
                    ? data.items
                    : Array.isArray(data?.results)
                      ? data.results
                      : [];
                setFaqs(list);
            })
            .catch(() => {});
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 pb-24 font-sans">
            <div className="bg-white shadow-sm sticky top-0 z-10">
                <div className="flex items-center p-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="p-2 rounded-full hover:bg-gray-100 transition-colors mr-2"
                    >
                        <ChevronLeft size={20} className="text-gray-600" />
                    </button>
                    <h1 className="text-lg font-semibold text-gray-900">Delivery Help & Support</h1>
                </div>
            </div>

            <div className="p-4 max-w-lg mx-auto space-y-6">
                {/* Contact Channels */}
                <section className="grid grid-cols-2 gap-4">
                    {supportPhone && (
                        <ContactCard icon={Phone} label="Call Support" sub={supportPhone} />
                    )}
                    {supportEmail && (
                        <ContactCard
                            icon={Mail}
                            label="Email Support"
                            sub={supportEmail.length > 18 ? supportEmail.slice(0, 18) + '…' : supportEmail}
                        />
                    )}
                    <ContactCard
                        icon={MessageCircle}
                        label="Chat Support"
                        sub="Sign in to chat"
                        to="/delivery/auth"
                    />
                </section>

                {/* Sign-in prompt */}
                <div className="bg-white rounded-xl p-4 border border-gray-200 text-center">
                    <p className="text-sm text-gray-500 mb-2">Need to raise a support ticket?</p>
                    <Link
                        to="/delivery/auth"
                        className="inline-block text-sm font-semibold text-primary hover:underline"
                    >
                        Sign in to your Delivery account →
                    </Link>
                </div>

                {/* FAQ Section */}
                <section>
                    <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <HelpCircle size={20} className="text-primary" />
                        Frequently Asked Questions
                    </h2>
                    <div className="space-y-3">
                        {(faqs.length > 0 ? faqs : STATIC_FAQS).map((faq) => (
                            <FAQItem key={faq._id} question={faq.question} answer={faq.answer} />
                        ))}
                    </div>
                </section>

                {/* Legal Links */}
                <div className="bg-white rounded-xl p-4 border border-gray-200">
                    <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-3">
                        Legal
                    </h3>
                    <div className="space-y-3">
                        <Link
                            to="/delivery/privacy"
                            className="flex items-center gap-2.5 text-gray-700 hover:text-gray-900 font-medium text-sm"
                        >
                            <FileText size={18} /> Privacy Policy
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ContactCard = ({ icon: Icon, label, sub, to }) => {
    const content = (
        <div className="bg-white p-4 rounded-xl border border-gray-200 flex flex-col items-center justify-center text-center cursor-pointer hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center text-brand-600 mb-3">
                <Icon size={24} />
            </div>
            <h4 className="font-bold text-gray-800 text-sm">{label}</h4>
            <p className="text-xs text-gray-500 mt-1">{sub}</p>
        </div>
    );
    return to ? <Link to={to} className="block">{content}</Link> : content;
};

const FAQItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div
            className="bg-white rounded-xl border border-gray-200 overflow-hidden cursor-pointer"
            onClick={() => setIsOpen(!isOpen)}
        >
            <div className="p-4 flex justify-between items-center">
                <h4 className="font-medium text-gray-800 text-sm pr-4">{question}</h4>
                {isOpen ? (
                    <ChevronUp size={18} className="text-gray-400 shrink-0" />
                ) : (
                    <ChevronDown size={18} className="text-gray-400 shrink-0" />
                )}
            </div>
            {isOpen && (
                <div className="px-4 pb-4 text-sm text-gray-600 border-t border-gray-100 leading-relaxed bg-gray-50 pt-3">
                    {answer}
                </div>
            )}
        </div>
    );
};

export default DeliverySupportPage;

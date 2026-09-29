import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Mail, FileText, ChevronLeft, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import axiosInstance from '@core/api/axios';

const STATIC_FAQS = [
    {
        _id: 's1',
        question: 'How do I add a new product to my store?',
        answer: 'Go to Products → Add Product from your seller dashboard. Fill in the product name, category, price, and stock quantity. Upload at least one clear image and click Save. Your product will be live immediately after approval.',
    },
    {
        _id: 's2',
        question: 'How do I manage incoming orders?',
        answer: 'All new orders appear under the Orders tab with a notification alert. You must confirm or reject an order within the stipulated time. Once confirmed, keep the item ready for pickup by the delivery partner.',
    },
    {
        _id: 's3',
        question: 'When will I receive my earnings?',
        answer: 'Earnings from completed orders are credited to your seller wallet after the delivery is marked complete. You can request a withdrawal from the Money Request section once your wallet balance meets the minimum threshold.',
    },
    {
        _id: 's4',
        question: 'How do I request a withdrawal?',
        answer: 'Navigate to Money Request in your seller dashboard. Enter the amount you wish to withdraw (within your available balance) and confirm. Settlements are transferred to your registered bank account within 2–5 business days.',
    },
    {
        _id: 's5',
        question: 'Why is my account pending approval?',
        answer: 'New seller accounts go through a verification process where we review your submitted KYC documents (Aadhaar, PAN, GST, etc.). This typically takes 1–3 business days. You will be notified via SMS and email once approved.',
    },
    {
        _id: 's6',
        question: 'How do I update my store location or service area?',
        answer: 'Go to Profile → Edit Profile and use the Map Picker to update your store location and service radius. Orders are assigned to you based on this radius, so keep it accurate for the best results.',
    },
    {
        _id: 's7',
        question: 'What should I do if an order has a problem?',
        answer: 'If you experience an issue with an order (wrong item, customer dispute, delivery failure), sign in and raise a support ticket from the Help & Support section. Our team will investigate and resolve it within 24 hours.',
    },
];

const SellerSupportPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const supportEmail = settings?.supportEmail || '';
    const supportPhone = settings?.supportPhone || '';
    const [faqs, setFaqs] = useState([]);

    useEffect(() => {
        axiosInstance
            .get('/public/faqs', { params: { category: 'Seller', status: 'published' } })
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
        <div className="min-h-screen bg-slate-50 pb-24 font-sans">
            <div className="sticky top-0 z-30 bg-white px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2 shadow-sm">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-100 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">
                    Seller Help & Support
                </h1>
            </div>

            <div className="max-w-2xl mx-auto px-4 pt-1 space-y-5">
                {/* Contact Channels */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {supportPhone && (
                        <ContactCard icon={Phone} label="Call Us" sub={supportPhone} />
                    )}
                    {supportEmail && (
                        <ContactCard icon={Mail} label="Email Us" sub={supportEmail.length > 18 ? supportEmail.slice(0, 18) + '…' : supportEmail} />
                    )}
                    <ContactCard
                        icon={MessageCircle}
                        label="Sign In to Chat"
                        sub="Instant Support"
                        to="/seller/auth"
                    />
                </div>

                {/* Sign-in prompt */}
                <div className="bg-white rounded-xl p-4 border border-slate-200 text-center">
                    <p className="text-sm text-slate-500 mb-2">Need to raise a support ticket?</p>
                    <Link
                        to="/seller/auth"
                        className="inline-block text-sm font-semibold text-primary hover:underline"
                    >
                        Sign in to your Seller account →
                    </Link>
                </div>

                {/* FAQ Section */}
                <div>
                    <h2 className="text-base font-semibold text-slate-800 mb-3 px-1 flex items-center gap-2">
                        <HelpCircle size={18} className="text-primary" />
                        Frequently Asked Questions
                    </h2>
                    <div className="space-y-3">
                        {(faqs.length > 0 ? faqs : STATIC_FAQS).map((faq) => (
                            <FAQItem key={faq._id} question={faq.question} answer={faq.answer} />
                        ))}
                    </div>
                </div>

                {/* Legal Links */}
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <h3 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-3">
                        Legal
                    </h3>
                    <div className="space-y-3">
                        <Link
                            to="/seller/privacy"
                            className="flex items-center gap-2.5 text-slate-700 hover:text-slate-900 font-medium text-sm"
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
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center gap-2 hover:bg-slate-50 transition-colors cursor-pointer group h-full">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 group-hover:text-slate-800 transition-colors">
                <Icon size={20} />
            </div>
            <div>
                <h3 className="font-semibold text-slate-800 text-sm whitespace-nowrap">{label}</h3>
                <p className="text-[10px] text-slate-500 font-medium">{sub}</p>
            </div>
        </div>
    );
    return to ? <Link to={to} className="block h-full">{content}</Link> : content;
};

const FAQItem = ({ question, answer }) => {
    const [isOpen, setIsOpen] = useState(false);
    return (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
            >
                <span className="font-semibold text-slate-800 text-sm">{question}</span>
                {isOpen ? (
                    <ChevronUp size={18} className="text-slate-700 shrink-0" />
                ) : (
                    <ChevronDown size={18} className="text-slate-400 shrink-0" />
                )}
            </button>
            {isOpen && (
                <div className="px-5 pb-4 text-sm text-slate-500 font-medium leading-relaxed bg-slate-50/50">
                    {answer}
                </div>
            )}
        </div>
    );
};

export default SellerSupportPage;

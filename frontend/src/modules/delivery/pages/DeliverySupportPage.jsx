import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, Phone, Mail, FileText, ChevronLeft, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { useSettings } from '@core/context/SettingsContext';
import axiosInstance from '@core/api/axios';

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
                        {faqs.length > 0 ? (
                            faqs.map((faq) => (
                                <FAQItem key={faq._id} question={faq.question} answer={faq.answer} />
                            ))
                        ) : (
                            <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 text-sm text-gray-400 text-center">
                                No FAQs available right now.
                            </div>
                        )}
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

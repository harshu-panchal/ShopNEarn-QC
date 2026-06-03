import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';
import {
    ChevronLeft,
    Truck,
    Heart,
    ShoppingBag,
    Mail,
    Phone,
    MapPin,
    Facebook,
    Twitter,
    Instagram,
    Linkedin,
    Youtube,
    ExternalLink,
    BookOpen,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';
import { useLegalPage } from '@core/hooks/useLegalPage';

/**
 * About page — pulls company / contact / social info from
 * the public-settings endpoint (Setting.* model). Every field
 * is rendered defensively so missing admin values just hide
 * the row instead of leaving "—" placeholders behind.
 */
const AboutPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const { page: aboutContent } = useLegalPage({
        app: 'customer',
        slug: 'about',
    });

    const sanitisedAboutHtml = useMemo(() => {
        if (!aboutContent?.content) return '';
        return DOMPurify.sanitize(aboutContent.content, {
            ADD_ATTR: ['target', 'rel'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
        });
    }, [aboutContent?.content]);

    const appName = settings?.appName || 'App';
    const companyName = settings?.companyName || appName;
    const supportEmail = String(settings?.supportEmail || '').trim();
    const supportPhone = String(settings?.supportPhone || '').trim();
    const supportPhoneHref = supportPhone
        ? `tel:${supportPhone.replace(/(?!^\+)[^\d]/g, '')}`
        : '';
    const address = String(settings?.address || '').trim();
    const taxId = String(settings?.taxId || '').trim();
    const logoUrl = settings?.logoUrl || '';

    const socials = [
        { key: 'facebook', url: settings?.facebook, label: 'Facebook', Icon: Facebook },
        { key: 'instagram', url: settings?.instagram, label: 'Instagram', Icon: Instagram },
        { key: 'twitter', url: settings?.twitter, label: 'Twitter', Icon: Twitter },
        { key: 'linkedin', url: settings?.linkedin, label: 'LinkedIn', Icon: Linkedin },
        { key: 'youtube', url: settings?.youtube, label: 'YouTube', Icon: Youtube },
    ].filter((s) => typeof s.url === 'string' && s.url.trim().length > 0);

    const hasContact = supportEmail || supportPhone || address;

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-24">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">About Us</h1>
            </div>

            <div className="px-4 pt-1 max-w-3xl mx-auto space-y-4">

                {/* Hero Section */}
                <div className="rounded-xl p-5 text-center bg-white border border-slate-200">
                    <div className="flex flex-col items-center">
                        {logoUrl ? (
                            <img
                                src={logoUrl}
                                alt={appName}
                                className="h-14 w-14 rounded-lg object-contain mb-3 bg-slate-100 p-2"
                            />
                        ) : (
                            <div className="bg-slate-100 p-3 rounded-lg mb-3">
                                <ShoppingBag size={24} className="text-slate-700" />
                            </div>
                        )}
                        <h2 className="text-xl font-semibold mb-1 tracking-tight text-slate-900">{appName}</h2>
                        <p className="text-slate-600 text-sm max-w-sm mx-auto">
                            Delivering happiness to your doorstep in minutes.
                        </p>
                        {companyName && companyName !== appName && (
                            <p className="text-[11px] text-slate-400 mt-2">A product of {companyName}</p>
                        )}
                    </div>
                </div>

                {/* Admin-edited About narrative (only shown when admin has
                    published a "/about" page). Falls back silently to the
                    static Mission + Values cards below when nothing is
                    published, so the page never looks empty. */}
                {sanitisedAboutHtml && (
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                                <BookOpen size={18} />
                            </div>
                            <h3 className="text-base font-semibold text-slate-800">
                                {aboutContent?.title || 'About Us'}
                            </h3>
                        </div>
                        <article
                            className="legal-content"
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: sanitisedAboutHtml }}
                        />
                    </div>
                )}

                {/* Mission Card (default fallback / supplementary when admin
                    hasn't replaced the narrative above) */}
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                            <Truck size={18} />
                        </div>
                        <h3 className="text-base font-semibold text-slate-800">Our Mission</h3>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-sm">
                        To revolutionize quick commerce by providing the fastest, most reliable delivery of daily essentials, ensuring quality and convenience for every household.
                    </p>
                </div>

                {/* Values Card */}
                <div className="bg-white rounded-xl p-4 border border-slate-200">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                            <Heart size={18} />
                        </div>
                        <h3 className="text-base font-semibold text-slate-800">Our Values</h3>
                    </div>
                    <ul className="space-y-3 text-sm text-slate-600">
                        <li className="flex gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                            <span><strong>Customer First:</strong> Your satisfaction is our top priority.</span>
                        </li>
                        <li className="flex gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                            <span><strong>Quality Assurance:</strong> We deliver only the freshest and best products.</span>
                        </li>
                        <li className="flex gap-2">
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300 mt-2 flex-shrink-0" />
                            <span><strong>Speed with Safety:</strong> Fast delivery without compromising on safety standards.</span>
                        </li>
                    </ul>
                </div>

                {/* Get in Touch */}
                {hasContact && (
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                                <Mail size={18} />
                            </div>
                            <h3 className="text-base font-semibold text-slate-800">Get in Touch</h3>
                        </div>
                        <div className="space-y-3">
                            {supportEmail && (
                                <a
                                    href={`mailto:${supportEmail}`}
                                    className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors group"
                                >
                                    <Mail size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Email</p>
                                        <p className="text-sm font-medium text-slate-800 break-all group-hover:text-slate-900">
                                            {supportEmail}
                                        </p>
                                    </div>
                                </a>
                            )}
                            {supportPhone && (
                                <a
                                    href={supportPhoneHref}
                                    className="flex items-start gap-3 p-3 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors group"
                                >
                                    <Phone size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Phone</p>
                                        <p className="text-sm font-medium text-slate-800 group-hover:text-slate-900">
                                            {supportPhone}
                                        </p>
                                    </div>
                                </a>
                            )}
                            {address && (
                                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-50">
                                    <MapPin size={16} className="text-slate-500 mt-0.5 shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Address</p>
                                        <p className="text-sm font-medium text-slate-800 leading-relaxed whitespace-pre-line">
                                            {address}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Social Links */}
                {socials.length > 0 && (
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="h-9 w-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700">
                                <ExternalLink size={18} />
                            </div>
                            <h3 className="text-base font-semibold text-slate-800">Follow Us</h3>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {socials.map(({ key, url, label, Icon }) => (
                                <a
                                    key={key}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 hover:text-slate-900 text-xs font-semibold transition-colors"
                                    aria-label={`${label} page`}
                                >
                                    <Icon size={14} />
                                    {label}
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                {/* Legal Footer */}
                <div className="text-center pt-2 space-y-1">
                    <p className="text-xs text-slate-500 font-medium">{companyName}</p>
                    {taxId && <p className="text-[11px] text-slate-400">GSTIN / Tax ID: {taxId}</p>}
                    <p className="text-xs text-slate-400">© {new Date().getFullYear()} {companyName}. All rights reserved.</p>
                </div>

            </div>
        </div>
    );
};

export default AboutPage;

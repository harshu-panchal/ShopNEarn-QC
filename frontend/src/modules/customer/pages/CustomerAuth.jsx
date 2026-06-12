import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@core/context/AuthContext';
import { useSettings } from '@core/context/SettingsContext';
import {
    Phone,
    ShieldCheck,
    User,
    ShoppingBag,
    ChevronRight,
    Zap,
    Utensils,
    Smartphone,
    ShoppingBasket,
    Star,
    ChevronLeft,
    Mail,
    Lock,
    Eye,
    EyeOff,
    ArrowLeftRight,
    ArrowLeft,
    ArrowRight,
    BadgeCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { customerApi } from '../services/customerApi';
import BgImage from '@/assets/image.png';

const CATEGORIES = [
    {
        title: "Grocery",
        icon: <ShoppingBasket size={28} />,
        color: "#ecfeff",
        ring: "var(--primary)",
        text: "var(--brand-500)",
        theme: "var(--primary)",
        shadow: "rgba(97, 218, 251, 0.3)",
        img: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=600"
    },
    {
        title: "Store",
        icon: <Smartphone size={28} />,
        color: "#f0f9ff",
        ring: "var(--brand-400)",
        text: "#0369a1",
        theme: "var(--brand-500)",
        shadow: "rgba(14, 165, 233, 0.3)",
        img: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&q=80&w=600"
    },
    {
        title: "Food",
        icon: <Utensils size={28} />,
        color: "#f0fdfa",
        ring: "#22d3ee",
        text: "#0e7490",
        theme: "var(--brand-500)",
        shadow: "rgba(14, 165, 233, 0.3)",
        img: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=600"
    },
    {
        title: "Health",
        icon: <ShieldCheck size={28} />,
        color: "#eff6ff",
        ring: "#60a5fa",
        text: "#1d4ed8",
        theme: "#3b82f6",
        shadow: "rgba(59, 130, 246, 0.3)",
        img: "https://images.unsplash.com/photo-1512678080530-7760d81faba6?q=80&w=1200&auto=format&fit=crop"
    },
];

// NOTE: the inline password strength meter (`evaluatePasswordStrength`)
// and its surrounding UI were removed by PO request — signup now
// accepts any non-empty password without complexity feedback. Restore
// from git history if a strength meter ever comes back.

const CustomerAuth = () => {
    // Top-level view state:
    //   'signup'        → new signup form (Customer-MLM-rebuild full payload)
    //   'login'         → login screen (Password sub-tab default, OTP sub-tab opt-in)
    //   'otp-verify'    → OTP code-entry step (for both signup-complete and login-via-OTP)
    const [authMode, setAuthMode] = useState('login');
    const [loginMethod, setLoginMethod] = useState('password'); // 'password' | 'otp'
    const [otpFlowOrigin, setOtpFlowOrigin] = useState(null); // 'signup' | 'login'
    const [isLoading, setIsLoading] = useState(false);
    const [timer, setTimer] = useState(0);
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    const [showLoginPassword, setShowLoginPassword] = useState(false);

    const { login } = useAuth();
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';
    const logoUrl = settings?.logoUrl || '';
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();

    // Post-login redirect target.
    //
    // Customers land on the MLM dashboard (`/mlm`) by default — it's
    // the home of every revenue surface (genealogy, payouts,
    // referrals), so dropping new sessions there beats sending them
    // to the public storefront and forcing a second click.
    //
    // We still honour `ProtectedRoute`'s `location.state.from` round-
    // trip so a user who clicked a deep link (e.g. `/mlm/payouts/123`)
    // and got bounced to /login lands back at the page they wanted
    // instead of being kicked over to /mlm.
    const POST_LOGIN_DEFAULT = '/mlm';
    const resolvePostLoginTarget = () =>
        location.state?.from?.pathname || POST_LOGIN_DEFAULT;

    const [formData, setFormData] = useState({
        // Signup fields (Customer-MLM-rebuild Phase 7 — all required)
        name: '',
        email: '',
        phone: '',
        password: '',
        referralCode: '',
        leg: '', // "L" or "R"
        // OTP fields
        otp: '',
        // Login fields (password sub-tab)
        loginIdentifier: '',
        loginPassword: '',
        // Login fields (OTP sub-tab)
        loginPhone: '',
    });

    const [isLegLocked, setIsLegLocked] = useState(false);

    // Live sponsor-name preview for the signup referral code.
    //
    // The lookup fires after the user has typed at least 4 chars and
    // then paused for 400ms; the debouncer cancels in-flight lookups
    // if the input changes again. We only ever display the sponsor's
    // public NAME (no phone/email/network info) and "Continue" is
    // gated on `status === 'valid'` so the signup payload never
    // reaches the backend with an unknown sponsor.
    //
    // Status flow:
    //   idle      — input too short or empty; no UI hint
    //   loading   — request in flight
    //   valid     — sponsor exists; show "Sponsor: <name>"
    //   invalid   — sponsor missing/ineligible; show inline error
    const [referralLookup, setReferralLookup] = useState({
        code: '',
        status: 'idle',
        sponsorName: null,
        reason: null,
    });

    // Pre-fill referral code STRICTLY from the URL `?ref=…` param.
    // If a referral code is present, flip the screen to the signup
    // tab so the user lands directly on a form pre-populated with
    // the inviter's code. Listens to `searchParams` so client-side
    // navigation that changes the query string is also picked up.
    useEffect(() => {
        try {
            window.localStorage.removeItem('mlm_pending_referral_code');
            window.sessionStorage.removeItem('mlm_pending_referral_code');
        } catch { /* ignore */ }

        try {
            const refRaw =
                searchParams.get('ref') ||
                searchParams.get('referral') ||
                searchParams.get('referralCode') ||
                '';
            const normalized = refRaw
                .trim()
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, '')
                .slice(0, 16);

            const legRaw = (searchParams.get('leg') || '').toUpperCase();
            const normalizedLeg = legRaw === 'L' || legRaw === 'LEFT' ? 'L' : legRaw === 'R' || legRaw === 'RIGHT' ? 'R' : '';

            if (normalized) {
                setFormData((prev) => ({ 
                    ...prev, 
                    referralCode: normalized, 
                    ...(normalizedLeg && { leg: normalizedLeg }) 
                }));
                if (normalizedLeg) {
                    setIsLegLocked(true);
                }
                setAuthMode('signup');
            }
        } catch { /* ignore */ }
    }, [searchParams]);

    const activeCategory = CATEGORIES[carouselIndex];

    useEffect(() => {
        const interval = setInterval(() => {
            setCarouselIndex((prev) => (prev + 1) % CATEGORIES.length);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        let interval;
        if (timer > 0) {
            interval = setInterval(() => setTimer((t) => t - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [timer]);

    // Debounced sponsor-name lookup. We attach the result to the
    // *normalised* code we queried (uppercase, trimmed); the render
    // path ignores stale results whose code no longer matches what's
    // in the field, so a fast typer never sees the wrong name flash.
    useEffect(() => {
        const raw = (formData.referralCode || '').trim().toUpperCase();
        if (authMode !== 'signup') {
            return undefined;
        }
        if (!raw || raw.length < 4) {
            setReferralLookup({ code: raw, status: 'idle', sponsorName: null, reason: null });
            return undefined;
        }
        // Indicate the lookup is queued so the UI can show a subtle
        // spinner even before the network request fires.
        setReferralLookup((prev) =>
            prev.code === raw && prev.status === 'valid'
                ? prev
                : { code: raw, status: 'loading', sponsorName: null, reason: null },
        );
        let cancelled = false;
        const timeoutId = setTimeout(async () => {
            try {
                const res = await customerApi.lookupReferralCode(raw);
                if (cancelled) return;
                const payload = res?.data?.result ?? res?.data?.data ?? res?.data ?? {};
                if (payload.valid) {
                    setReferralLookup({
                        code: raw,
                        status: 'valid',
                        sponsorName: payload.sponsorName || 'Sponsor',
                        reason: null,
                    });
                } else {
                    setReferralLookup({
                        code: raw,
                        status: 'invalid',
                        sponsorName: null,
                        reason: payload.reason || 'NOT_FOUND',
                    });
                }
            } catch (err) {
                if (cancelled) return;
                setReferralLookup({
                    code: raw,
                    status: 'invalid',
                    sponsorName: null,
                    reason: 'NETWORK_ERROR',
                });
            }
        }, 400);
        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, [formData.referralCode, authMode]);

    const updateField = (key, value) => {
        setFormData((prev) => ({ ...prev, [key]: value }));
    };

    /* ============================================================
       SIGNUP — sends OTP after validating the full Customer-MLM-rebuild
       payload (name, email, phone, password, referralCode, leg).
       ============================================================ */
    const handleSignupSendOtp = async (e) => {
        e?.preventDefault();
        const name = (formData.name || '').trim();
        const email = (formData.email || '').trim().toLowerCase();
        const phone = (formData.phone || '').trim();
        const password = formData.password || '';
        const referralCode = (formData.referralCode || '').trim().toUpperCase();
        const leg = (formData.leg || '').trim().toUpperCase();

        if (name.length < 2) {
            toast.error('Please enter your full name.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            toast.error('Please enter a valid email address.');
            return;
        }
        if (phone.length !== 10) {
            toast.error('Enter a valid 10-digit mobile number.');
            return;
        }
        // Password complexity + confirm-match checks intentionally
        // removed (PO-request). The only requirement is non-empty —
        // the backend Joi schema enforces the same minimal rule.
        if (!password) {
            toast.error('Please enter a password.');
            return;
        }
        if (!referralCode || referralCode.length < 4) {
            toast.error('A valid referral code is required.');
            return;
        }
        // Reject the submission BEFORE the OTP roundtrip if the
        // sponsor preview did not resolve. This mirrors what the
        // backend would respond with (REFERRAL_CODE_INVALID) and
        // keeps the user from spending an SMS just to discover the
        // typo.
        if (
            referralLookup.code !== referralCode ||
            referralLookup.status !== 'valid'
        ) {
            toast.error(
                referralLookup.status === 'loading'
                    ? 'Verifying referral code — please wait a moment.'
                    : 'Enter a valid referral code (we could not find that sponsor).',
            );
            return;
        }
        if (!['L', 'R'].includes(leg)) {
            toast.error('Please choose a leg position (Left or Right).');
            return;
        }

        setIsLoading(true);
        try {
            await customerApi.sendSignupOtp({
                name,
                email,
                phone,
                password,
                referralCode,
                leg,
            });
            setOtpFlowOrigin('signup');
            setAuthMode('otp-verify');
            setTimer(30);
            updateField('otp', '');
            toast.success('OTP sent! Check your phone to finish signup.');
        } catch (error) {
            const apiMessage = error?.response?.data?.message;
            const apiCode = error?.response?.data?.result?.code;
            if (apiCode === 'EMAIL_ALREADY_USED') {
                toast.error('This email is already linked to another account. Try logging in.');
            } else if (
                apiCode === 'REFERRAL_CODE_REQUIRED' ||
                apiCode === 'REFERRAL_CODE_INVALID'
            ) {
                toast.error(apiMessage || 'A valid referral code is required.');
            } else if (apiCode === 'LEG_POSITION_REQUIRED') {
                toast.error('Please choose a leg position (Left or Right).');
            } else if (apiCode === 'PHONE_ALREADY_REGISTERED') {
                toast.error(apiMessage || 'This phone number is already registered. Please log in instead.');
                // Move the user toward the login screen with the phone
                // pre-filled so they don't have to re-type it.
                setFormData((prev) => ({
                    ...prev,
                    loginIdentifier: prev.phone || prev.loginIdentifier || '',
                }));
                setAuthMode('login');
            } else {
                toast.error(apiMessage || 'Failed to send OTP');
            }
        } finally {
            setIsLoading(false);
        }
    };

    /* ============================================================
       LOGIN — Password sub-tab
       ============================================================ */
    const handleLoginWithPassword = async (e) => {
        e?.preventDefault();
        const identifier = (formData.loginIdentifier || '').trim();
        const password = formData.loginPassword || '';
        if (!identifier) {
            toast.error('Enter your User ID or phone number.');
            return;
        }
        // Email-shaped identifiers are no longer accepted by the
        // backend — short-circuit with a clear, local error instead
        // of round-tripping for the EMAIL_LOGIN_DISABLED response.
        if (identifier.includes('@')) {
            toast.error('Email sign-in is no longer supported. Use your User ID or phone number.');
            return;
        }
        if (!password) {
            toast.error('Enter your password.');
            return;
        }
        setIsLoading(true);
        try {
            const response = await customerApi.loginWithPassword({
                identifier,
                password,
            });
            const { token, customer } = response.data.result;
            login({ ...customer, token, role: 'customer' });
            toast.success('Welcome back!');
            navigate(resolvePostLoginTarget(), { replace: true });
        } catch (error) {
            const apiMessage = error?.response?.data?.message;
            toast.error(apiMessage || 'Invalid credentials');
        } finally {
            setIsLoading(false);
        }
    };

    /* ============================================================
       LOGIN — OTP sub-tab (phone + OTP)
       ============================================================ */
    const handleLoginSendOtp = async (e) => {
        e?.preventDefault();
        const phone = (formData.loginPhone || '').trim();
        if (phone.length !== 10) {
            toast.error('Enter a valid 10-digit number.');
            return;
        }
        setIsLoading(true);
        try {
            await customerApi.sendLoginOtp({ phone });
            setOtpFlowOrigin('login');
            setAuthMode('otp-verify');
            setTimer(30);
            updateField('otp', '');
            toast.success('OTP sent!');
        } catch (error) {
            const apiMessage = error?.response?.data?.message;
            const apiCode = error?.response?.data?.result?.code;
            if (
                apiCode === 'ACCOUNT_NOT_FOUND' ||
                apiCode === 'ACCOUNT_NOT_VERIFIED'
            ) {
                setAuthMode('signup');
                toast.error(
                    apiMessage ||
                        'No account found with this number. Please sign up first.',
                );
                return;
            }
            toast.error(apiMessage || 'Failed to send OTP');
        } finally {
            setIsLoading(false);
        }
    };

    /* ============================================================
       OTP verify — handles both signup-completion and login-via-OTP.
       The right phone number is chosen based on `otpFlowOrigin`.
       ============================================================ */
    const handleVerifyOtp = async (e) => {
        e?.preventDefault();
        if ((formData.otp || '').length !== 4) {
            toast.error('Enter the 4-digit code.');
            return;
        }
        const wasSignup = otpFlowOrigin === 'signup';
        const phoneForVerify = wasSignup
            ? (formData.phone || '').trim()
            : (formData.loginPhone || '').trim();
        if (!phoneForVerify) {
            toast.error('Phone number lost. Go back and resend OTP.');
            return;
        }

        setIsLoading(true);
        try {
            const response = await customerApi.verifyOtp({
                phone: phoneForVerify,
                otp: formData.otp,
            });
            const { token, customer } = response.data.result;
            login({ ...customer, token, role: 'customer' });

            if (wasSignup) {
                toast.success("Welcome aboard! Your referral code is ready.");
                navigate('/mlm', { replace: true });
                return;
            }

            toast.success('Successfully Logged In!');
            navigate(resolvePostLoginTarget(), { replace: true });
        } catch (error) {
            const apiMessage = error?.response?.data?.message;
            toast.error(apiMessage || 'Invalid OTP');
        } finally {
            setIsLoading(false);
        }
    };

    /* ============================================================
       Render
       ============================================================ */
    return (
        <div className="min-h-screen w-full relative flex items-center justify-center font-['Outfit',_sans-serif] overflow-x-hidden py-6">

            {/* Dynamic Atmospheric Background */}
            <div
                className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat transition-all duration-1000"
                style={{ backgroundImage: `url(${BgImage})` }}
            >
                <motion.div
                    animate={{ backgroundColor: activeCategory.color }}
                    transition={{ duration: 1.5 }}
                    className="absolute inset-0 opacity-80 backdrop-blur-sm"
                />
            </div>

            {/* Animated Blurred Blobs */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <motion.div
                    animate={{
                        backgroundColor: activeCategory.theme,
                        x: [0, 50, 0],
                        y: [0, 30, 0],
                        scale: [1, 1.2, 1],
                    }}
                    transition={{
                        backgroundColor: { duration: 1.5 },
                        x: { duration: 8, repeat: Infinity, ease: 'easeInOut' },
                        y: { duration: 10, repeat: Infinity, ease: 'easeInOut' },
                        scale: { duration: 12, repeat: Infinity, ease: 'easeInOut' },
                    }}
                    className="absolute -top-24 -left-24 w-96 h-96 rounded-full blur-[100px] opacity-20"
                />
                <motion.div
                    animate={{
                        backgroundColor: activeCategory.theme,
                        x: [0, -40, 0],
                        y: [0, -60, 0],
                        scale: [1, 1.1, 1],
                    }}
                    transition={{
                        backgroundColor: { duration: 1.5 },
                        x: { duration: 9, repeat: Infinity, ease: 'easeInOut' },
                        y: { duration: 7, repeat: Infinity, ease: 'easeInOut' },
                        scale: { duration: 15, repeat: Infinity, ease: 'easeInOut' },
                    }}
                    className="absolute -bottom-24 -right-24 w-[500px] h-[500px] rounded-full blur-[120px] opacity-30"
                />
            </div>

            <div className="w-[92%] max-w-[440px] max-h-[92vh] bg-white relative z-10 overflow-hidden rounded-[40px] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] border border-white/40 flex flex-col transition-colors duration-1000">
                {/* The scroll viewport MUST set both `flex-1` and
                    `min-h-0` so it actually constrains itself to the
                    parent card's `max-h-[92vh]`. Without `min-h-0`,
                    flex children default to `min-height: auto` and
                    the inner div grows to its intrinsic content
                    height — making everything below the fold visually
                    clipped by the parent's `overflow-hidden` but
                    NOT scrollable.

                    `data-lenis-prevent` is REQUIRED on desktop: the
                    global `LenisScroll` component (mounted in App.jsx)
                    hijacks wheel/touchpad events for smooth scrolling
                    the whole page, and would otherwise eat every
                    scroll attempt inside this nested viewport.

                    `touch-pan-y` + `overscroll-contain` + the
                    WebKit momentum hint round out the gesture
                    handling for touch screens and Apple touchpads. */}
                <div
                    data-lenis-prevent
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar touch-pan-y"
                    style={{ WebkitOverflowScrolling: "touch" }}
                >

                    {/* Banner */}
                    <motion.div
                        animate={{ backgroundColor: activeCategory.theme }}
                        transition={{ duration: 1 }}
                        className="relative h-44 w-full overflow-hidden flex-shrink-0"
                    >
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={carouselIndex}
                                initial={{ opacity: 0, scale: 1.1 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 1.05 }}
                                transition={{ duration: 0.8 }}
                                className="absolute inset-0"
                            >
                                <img
                                    src={activeCategory.img}
                                    className="w-full h-full object-cover"
                                    loading="lazy"
                                    alt="banner"
                                />
                                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/10 to-transparent opacity-60" style={{ backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.1), ${activeCategory.theme})` }} />
                            </motion.div>
                        </AnimatePresence>

                        <div className="absolute top-6 left-0 w-full px-6 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-10 h-10 bg-white/20 backdrop-blur-xl rounded-xl flex items-center justify-center border border-white/30">
                                    <ShoppingBag size={20} className="text-white" />
                                </div>
                                <span className="text-white font-black tracking-tighter text-xl">{appName.toUpperCase()}</span>
                            </div>
                        </div>

                        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-8 text-white pt-6">
                            <motion.h2
                                key={carouselIndex}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="text-xl font-black tracking-tight leading-none mb-2"
                            >
                                {activeCategory.title.toUpperCase()} INSIDE
                            </motion.h2>
                            <p className="text-[10px] font-bold uppercase tracking-[4px] opacity-70">Earn rewards as you shop</p>
                        </div>

                        <div className="absolute -bottom-1 left-0 w-full leading-[0]">
                            <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="w-full h-20">
                                <path
                                    fill="#ffffff"
                                    d="M0,224L40,213.3C80,203,160,181,240,186.7C320,192,400,224,480,240C560,256,640,256,720,234.7C800,213,880,171,960,165.3C1040,160,1120,192,1200,208C1280,224,1360,224,1400,224L1440,224L1440,320L1400,320C1360,320,1280,320,1200,320C1120,320,1040,320,960,320C880,320,800,320,720,320C640,320,560,320,480,320C400,320,320,320,240,320C160,320,80,320,40,320L0,320Z"
                                />
                            </svg>
                        </div>
                    </motion.div>

                    {/* Logo Bubble */}
                    <div className="relative -mt-10 flex justify-center z-20">
                        <div className="w-20 h-20 rounded-full bg-white border-4 border-white shadow-[0_15px_40px_rgba(97,218,251,0.2)] flex items-center justify-center overflow-hidden transition-shadow duration-1000" style={{ boxShadow: `0 15px 40px ${activeCategory.shadow}` }}>
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={carouselIndex}
                                    initial={{ opacity: 0, scale: 0.5, rotate: -20 }}
                                    animate={{ opacity: 1, scale: 1, rotate: 0 }}
                                    exit={{ opacity: 0, scale: 1.5, rotate: 20 }}
                                    className="w-full h-full"
                                    style={{ color: activeCategory.text }}
                                >
                                    {logoUrl ? (
                                        <img src={logoUrl} alt={`${appName} logo`} loading="lazy" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: activeCategory.color }}>
                                            {activeCategory.icon}
                                        </div>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Form container */}
                    <div className="px-6 pt-4 pb-8">
                        <AnimatePresence mode="wait">
                            {authMode !== 'otp-verify' ? (
                                <motion.div
                                    key="main-form"
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, x: -20 }}
                                    className="space-y-4"
                                >
                                    {/* Top tab switcher: Login vs Sign Up */}
                                    <div className="flex bg-gray-50 rounded-2xl p-1.5 border border-gray-100">
                                        <button
                                            type="button"
                                            onClick={() => setAuthMode('login')}
                                            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${authMode === 'login' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                                            style={{ color: authMode === 'login' ? activeCategory.theme : undefined }}
                                        >
                                            Login
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setAuthMode('signup')}
                                            className={`flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all ${authMode === 'signup' ? 'bg-white shadow-sm' : 'text-gray-400'}`}
                                            style={{ color: authMode === 'signup' ? activeCategory.theme : undefined }}
                                        >
                                            Sign Up
                                        </button>
                                    </div>

                                    {authMode === 'login' ? (
                                        <LoginPane
                                            loginMethod={loginMethod}
                                            setLoginMethod={setLoginMethod}
                                            formData={formData}
                                            updateField={updateField}
                                            showLoginPassword={showLoginPassword}
                                            setShowLoginPassword={setShowLoginPassword}
                                            isLoading={isLoading}
                                            theme={activeCategory.theme}
                                            shadow={activeCategory.shadow}
                                            onSubmitPassword={handleLoginWithPassword}
                                            onSubmitOtp={handleLoginSendOtp}
                                        />
                                    ) : (
                                        <SignupPane
                                            formData={formData}
                                            updateField={updateField}
                                            showPassword={showPassword}
                                            setShowPassword={setShowPassword}
                                            isLoading={isLoading}
                                            theme={activeCategory.theme}
                                            shadow={activeCategory.shadow}
                                            onSubmit={handleSignupSendOtp}
                                            referralLookup={referralLookup}
                                            isLegLocked={isLegLocked}
                                        />
                                    )}

                                    <div className="pt-2 flex flex-col items-center gap-1">
                                        <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest text-center">
                                            By continuing, you agree to our
                                        </p>
                                        <div className="flex items-center gap-1.5 underline decoration-gray-200 underline-offset-4">
                                            <button
                                                type="button"
                                                onClick={() => navigate('/terms')}
                                                className="text-[10px] font-black uppercase tracking-widest hover:text-gray-900 transition-colors"
                                                style={{ color: activeCategory.theme }}
                                            >
                                                Terms & Condition
                                            </button>
                                            <span className="text-[8px] text-gray-300">•</span>
                                            <button
                                                type="button"
                                                onClick={() => navigate('/privacy-policy')}
                                                className="text-[10px] font-black uppercase tracking-widest hover:text-gray-900 transition-colors"
                                                style={{ color: activeCategory.theme }}
                                            >
                                                Privacy Policy
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="otp-view"
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="space-y-8"
                                >
                                    <div className="flex items-center gap-4">
                                        <button
                                            type="button"
                                            onClick={() => setAuthMode(otpFlowOrigin === 'signup' ? 'signup' : 'login')}
                                            className="w-10 h-10 bg-gray-50 border border-gray-100 rounded-full flex items-center justify-center text-gray-400"
                                        >
                                            <ChevronLeft size={20} />
                                        </button>
                                        <div>
                                            <h3 className="text-xl font-black text-gray-900 tracking-tight">Verify Device</h3>
                                            <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase">
                                                +91 {otpFlowOrigin === 'signup' ? formData.phone : formData.loginPhone}
                                            </p>
                                        </div>
                                    </div>

                                    <form onSubmit={handleVerifyOtp} className="space-y-8">
                                        <div className="flex justify-between gap-3 px-1">
                                            {[...Array(4)].map((_, i) => (
                                                <input
                                                    key={i}
                                                    type="tel"
                                                    maxLength={1}
                                                    className="w-14 h-16 bg-white border-2 border-gray-200 rounded-3xl text-center text-2xl font-black outline-none shadow-[0_18px_45px_rgba(15,23,42,0.35)] focus:bg-white focus:border-[var(--theme-color)] focus:shadow-[0_24px_65px_rgba(15,23,42,0.55)] transition-all"
                                                    style={{ color: activeCategory.theme }}
                                                    value={formData.otp[i] || ''}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Backspace' && !e.target.value && i > 0) {
                                                            e.target.previousElementSibling.focus();
                                                        }
                                                    }}
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val && i < 3) e.target.nextElementSibling.focus();
                                                        const otpArr = (formData.otp || '').split('');
                                                        otpArr[i] = val;
                                                        updateField('otp', otpArr.join(''));
                                                    }}
                                                    onFocus={(e) => (e.target.style.borderColor = activeCategory.theme)}
                                                    onBlur={(e) => (e.target.style.borderColor = '')}
                                                />
                                            ))}
                                        </div>

                                        <div className="space-y-4">
                                            <button
                                                type="submit"
                                                disabled={isLoading}
                                                className="w-full bg-gray-900 text-white py-5 rounded-[24px] text-xs font-black tracking-[4px] shadow-2xl flex items-center justify-center gap-3 uppercase active:scale-95 transition-all"
                                            >
                                                {isLoading ? 'Authenticating...' : `Enter ${appName}`}
                                            </button>
                                            <div className="flex justify-center">
                                                <button
                                                    type="button"
                                                    disabled={timer > 0}
                                                    onClick={otpFlowOrigin === 'signup' ? handleSignupSendOtp : handleLoginSendOtp}
                                                    className={`text-[10px] font-black uppercase tracking-widest ${timer > 0 ? 'text-gray-300' : 'underline'}`}
                                                    style={{ color: timer > 0 ? undefined : activeCategory.theme }}
                                                >
                                                    {timer > 0 ? `Resend Code in ${timer}s` : 'Resend Now'}
                                                </button>
                                            </div>
                                        </div>
                                    </form>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
};

/* =========================================================
   LoginPane — password + OTP sub-tabs.
   ========================================================= */
function LoginPane({
    loginMethod,
    setLoginMethod,
    formData,
    updateField,
    showLoginPassword,
    setShowLoginPassword,
    isLoading,
    theme,
    shadow,
    onSubmitPassword,
    onSubmitOtp,
}) {
    return (
        <div className="space-y-4">
            <div className="space-y-1 text-center">
                <h3 className="text-xl font-black text-gray-900 tracking-tight">Welcome Back!</h3>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                    {loginMethod === 'password' ? 'Sign in with User ID or Phone' : 'Sign in with one-time password'}
                </p>
            </div>

            {/* Sub-tabs: Password / OTP */}
            <div className="flex bg-white rounded-2xl p-1 border border-gray-100">
                <button
                    type="button"
                    onClick={() => setLoginMethod('password')}
                    className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${loginMethod === 'password' ? 'shadow-sm bg-gray-50' : 'text-gray-400'}`}
                    style={{ color: loginMethod === 'password' ? theme : undefined }}
                >
                    Password
                </button>
                <button
                    type="button"
                    onClick={() => setLoginMethod('otp')}
                    className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all ${loginMethod === 'otp' ? 'shadow-sm bg-gray-50' : 'text-gray-400'}`}
                    style={{ color: loginMethod === 'otp' ? theme : undefined }}
                >
                    OTP
                </button>
            </div>

            {loginMethod === 'password' ? (
                <form onSubmit={onSubmitPassword} className="space-y-4">
                    <FieldWithIcon
                        icon={<BadgeCheck size={18} />}
                        theme={theme}
                        placeholder="User ID or Phone Number"
                        value={formData.loginIdentifier}
                        onChange={(v) => updateField('loginIdentifier', v)}
                        autoComplete="username"
                    />
                    <FieldWithIcon
                        icon={<Lock size={18} />}
                        theme={theme}
                        type={showLoginPassword ? 'text' : 'password'}
                        placeholder="Password"
                        value={formData.loginPassword}
                        onChange={(v) => updateField('loginPassword', v)}
                        autoComplete="current-password"
                        rightAdornment={
                            <button
                                type="button"
                                onClick={() => setShowLoginPassword((v) => !v)}
                                className="text-gray-400 hover:text-gray-600"
                                aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                            >
                                {showLoginPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        }
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full text-white py-5 rounded-[24px] text-xs font-black tracking-[4px] flex items-center justify-center gap-3 active:scale-95 transition-all uppercase"
                        style={{ backgroundColor: theme, boxShadow: `0 20px 40px ${shadow}` }}
                    >
                        {isLoading ? 'Signing in...' : 'Sign In'}
                        <ChevronRight size={18} />
                    </button>
                </form>
            ) : (
                <form onSubmit={onSubmitOtp} className="space-y-4">
                    <PhoneField
                        theme={theme}
                        value={formData.loginPhone}
                        onChange={(v) => updateField('loginPhone', v)}
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full text-white py-5 rounded-[24px] text-xs font-black tracking-[4px] flex items-center justify-center gap-3 active:scale-95 transition-all uppercase"
                        style={{ backgroundColor: theme, boxShadow: `0 20px 40px ${shadow}` }}
                    >
                        {isLoading ? 'Sending OTP...' : 'Send OTP'}
                        <ChevronRight size={18} />
                    </button>
                </form>
            )}
        </div>
    );
}

/* =========================================================
   SignupPane — full Customer-MLM-rebuild signup form.
   ========================================================= */
function SignupPane({
    formData,
    updateField,
    showPassword,
    setShowPassword,
    isLoading,
    theme,
    shadow,
    onSubmit,
    referralLookup,
    isLegLocked,
}) {
    const setLeg = (leg) => {
        if (!isLegLocked) {
            updateField('leg', leg);
        }
    };
    // Only treat the lookup result as "live" when it matches the
    // CURRENT text in the field — otherwise a stale lookup from the
    // previous code keystroke would briefly render the wrong hint.
    const normalisedCode = (formData.referralCode || '').trim().toUpperCase();
    const lookupMatches =
        referralLookup && referralLookup.code === normalisedCode;
    const lookupStatus = lookupMatches ? referralLookup.status : 'idle';
    const sponsorName = lookupMatches ? referralLookup.sponsorName : null;
    const lookupReason = lookupMatches ? referralLookup.reason : null;
    const submitDisabled = isLoading || lookupStatus !== 'valid';

    const invalidMessage = (() => {
        if (lookupStatus !== 'invalid') return null;
        switch (lookupReason) {
            case 'INELIGIBLE_STATUS':
                return 'This sponsor cannot accept referrals right now.';
            case 'NETWORK_ERROR':
                return 'Could not verify the code. Check your connection and try again.';
            case 'MALFORMED':
                return 'Referral codes are 4–16 letters or numbers.';
            case 'NOT_FOUND':
            default:
                return 'No member found with this code.';
        }
    })();
    return (
        <div className="space-y-4">
            <div className="space-y-1 text-center">
                <h3 className="text-xl font-black text-gray-900 tracking-tight">Create Account</h3>
                <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest leading-none">
                    Join the rewards program — free to sign up
                </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-3.5">
                <FieldWithIcon
                    icon={<User size={18} />}
                    theme={theme}
                    placeholder="Full Name"
                    value={formData.name}
                    onChange={(v) => updateField('name', v)}
                />
                <FieldWithIcon
                    icon={<Mail size={18} />}
                    theme={theme}
                    type="email"
                    placeholder="Email Address"
                    value={formData.email}
                    onChange={(v) => updateField('email', v.toLowerCase())}
                    autoComplete="email"
                />
                <PhoneField
                    theme={theme}
                    value={formData.phone}
                    onChange={(v) => updateField('phone', v)}
                />
                {/* Password field — strength meter + Confirm Password
                    input were removed by PO request. The backend Joi
                    schema also enforces only a non-empty rule, so any
                    string the user types is accepted as-is. */}
                <FieldWithIcon
                    icon={<Lock size={18} />}
                    theme={theme}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Create Password"
                    value={formData.password}
                    onChange={(v) => updateField('password', v)}
                    autoComplete="new-password"
                    rightAdornment={
                        <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="text-gray-400 hover:text-gray-600"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    }
                />
                <div>
                    <div className="relative group">
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300">
                            <Star size={18} />
                        </div>
                        <input
                            required
                            placeholder="Referral Code"
                            value={formData.referralCode}
                            maxLength={16}
                            minLength={4}
                            className={`w-full bg-gray-50 border rounded-2xl pl-12 pr-12 py-4 text-sm font-bold text-gray-800 outline-none focus:bg-white transition-all uppercase tracking-widest ${
                                lookupStatus === 'valid'
                                    ? 'border-green-300'
                                    : lookupStatus === 'invalid'
                                    ? 'border-red-300'
                                    : 'border-gray-100'
                            }`}
                            onChange={(e) => updateField('referralCode', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                            onFocus={(e) => {
                                if (lookupStatus === 'idle' || lookupStatus === 'loading') {
                                    e.target.style.borderColor = theme;
                                }
                            }}
                            onBlur={(e) => {
                                if (lookupStatus === 'idle' || lookupStatus === 'loading') {
                                    e.target.style.borderColor = '#F3F4F6';
                                }
                            }}
                        />
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center">
                            {lookupStatus === 'loading' && (
                                <span
                                    className="block w-4 h-4 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin"
                                    aria-hidden="true"
                                />
                            )}
                            {lookupStatus === 'valid' && (
                                <BadgeCheck size={18} className="text-green-500" aria-hidden="true" />
                            )}
                            {lookupStatus === 'invalid' && (
                                <span
                                    className="block w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold leading-4 text-center"
                                    aria-hidden="true"
                                >
                                    !
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="mt-1.5 pl-1 min-h-[14px]" aria-live="polite">
                        {lookupStatus === 'valid' && sponsorName && (
                            <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">
                                Sponsor: <span className="normal-case tracking-normal">{sponsorName}</span>
                            </p>
                        )}
                        {lookupStatus === 'invalid' && (
                            <p className="text-[10px] font-bold uppercase tracking-wider text-red-500">
                                {invalidMessage}
                            </p>
                        )}
                        {lookupStatus === 'loading' && (
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                                Verifying code…
                            </p>
                        )}
                    </div>
                </div>

                {/* Leg position selector — two large cards */}
                <div>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 pl-1">
                        Choose Leg Position
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <LegCard
                            active={formData.leg === 'L'}
                            theme={theme}
                            onClick={() => setLeg('L')}
                            icon={<ArrowLeft size={22} />}
                            label="Left Leg"
                            disabled={isLegLocked}
                        />
                        <LegCard
                            active={formData.leg === 'R'}
                            theme={theme}
                            onClick={() => setLeg('R')}
                            icon={<ArrowRight size={22} />}
                            label="Right Leg"
                            disabled={isLegLocked}
                        />
                    </div>
                    <p className="mt-1.5 pl-1 text-[10px] font-semibold text-gray-400">
                        Your sponsor places you under their left or right team.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={submitDisabled}
                    className="w-full text-white py-5 rounded-[24px] text-xs font-black tracking-[4px] flex items-center justify-center gap-3 active:scale-95 transition-all uppercase disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ backgroundColor: theme, boxShadow: `0 20px 40px ${shadow}` }}
                >
                    {isLoading ? 'Sending OTP...' : 'Continue'}
                    <ChevronRight size={18} />
                </button>
            </form>
        </div>
    );
}

/* =========================================================
   Reusable building blocks
   ========================================================= */
function FieldWithIcon({
    icon,
    theme,
    type = 'text',
    placeholder,
    value,
    onChange,
    rightAdornment = null,
    autoComplete,
}) {
    return (
        <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300">{icon}</div>
            <input
                required
                type={type}
                value={value || ''}
                placeholder={placeholder}
                autoComplete={autoComplete}
                className={`w-full bg-gray-50 border border-gray-100 rounded-2xl pl-12 ${rightAdornment ? 'pr-12' : 'pr-4'} py-4 text-sm font-bold text-gray-800 outline-none focus:bg-white transition-all`}
                onChange={(e) => onChange(e.target.value)}
                onFocus={(e) => (e.target.style.borderColor = theme)}
                onBlur={(e) => (e.target.style.borderColor = '#F3F4F6')}
            />
            {rightAdornment && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    {rightAdornment}
                </div>
            )}
        </div>
    );
}

function PhoneField({ theme, value, onChange }) {
    return (
        <div className="relative group">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300">
                <Phone size={18} />
            </div>
            <div className="absolute left-11 top-1/2 -translate-y-1/2 font-black text-sm text-gray-400 border-r border-gray-200 pr-2">
                +91
            </div>
            <input
                required
                type="tel"
                maxLength={10}
                value={value || ''}
                placeholder="Mobile Number"
                autoComplete="tel"
                className="w-full bg-gray-50 border border-gray-100 rounded-2xl pl-20 pr-4 py-4 text-sm font-bold text-gray-800 outline-none focus:bg-white transition-all"
                onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
                onFocus={(e) => (e.target.style.borderColor = theme)}
                onBlur={(e) => (e.target.style.borderColor = '#F3F4F6')}
            />
        </div>
    );
}

function LegCard({ active, theme, onClick, icon, label, disabled }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`relative flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl border-2 transition-all ${
                active
                    ? 'bg-white shadow-md scale-[1.02]'
                    : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-white'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={{
                borderColor: active ? theme : '#F3F4F6',
                color: active ? theme : undefined,
            }}
        >
            {icon}
            <span className="text-[11px] font-black uppercase tracking-wider">{label}</span>
            {active && (
                <span
                    className="absolute top-2 right-2 w-2 h-2 rounded-full"
                    style={{ backgroundColor: theme }}
                />
            )}
        </button>
    );
}

export default CustomerAuth;

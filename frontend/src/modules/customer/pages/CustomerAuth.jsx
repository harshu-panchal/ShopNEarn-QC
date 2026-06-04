import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
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

// Lightweight inline password strength meter — no extra dependency.
// Score 0..4 based on length + character classes; matches the server
// rule "min 8 chars + at least one letter + at least one digit".
function evaluatePasswordStrength(pw) {
    if (!pw) return { score: 0, label: '', valid: false };
    let score = 0;
    if (pw.length >= 8) score += 1;
    if (pw.length >= 12) score += 1;
    if (/[A-Za-z]/.test(pw) && /\d/.test(pw)) score += 1;
    if (/[^A-Za-z0-9]/.test(pw)) score += 1;
    const labels = ['Too weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
    const valid = pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
    return { score, label: labels[score] || '', valid };
}

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
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showLoginPassword, setShowLoginPassword] = useState(false);

    const { login } = useAuth();
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';
    const logoUrl = settings?.logoUrl || '';
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    const [formData, setFormData] = useState({
        // Signup fields (Customer-MLM-rebuild Phase 7 — all required)
        name: '',
        email: '',
        phone: '',
        password: '',
        confirmPassword: '',
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

            if (normalized) {
                setFormData((prev) => ({ ...prev, referralCode: normalized }));
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

    const pwStrength = useMemo(
        () => evaluatePasswordStrength(formData.password),
        [formData.password],
    );

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
        const confirm = formData.confirmPassword || '';
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
        if (!pwStrength.valid) {
            toast.error('Password must be 8+ chars and include a letter and a number.');
            return;
        }
        if (password !== confirm) {
            toast.error('Passwords do not match.');
            return;
        }
        if (!referralCode || referralCode.length < 4) {
            toast.error('A valid referral code is required.');
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
            toast.error('Enter your email or phone number.');
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
            navigate('/');
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
            navigate('/');
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
                                            showConfirmPassword={showConfirmPassword}
                                            setShowConfirmPassword={setShowConfirmPassword}
                                            pwStrength={pwStrength}
                                            isLoading={isLoading}
                                            theme={activeCategory.theme}
                                            shadow={activeCategory.shadow}
                                            onSubmit={handleSignupSendOtp}
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
                    {loginMethod === 'password' ? 'Sign in with email or phone' : 'Sign in with one-time password'}
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
                        icon={<Mail size={18} />}
                        theme={theme}
                        placeholder="Email or Phone Number"
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
    showConfirmPassword,
    setShowConfirmPassword,
    pwStrength,
    isLoading,
    theme,
    shadow,
    onSubmit,
}) {
    const setLeg = (leg) => updateField('leg', leg);
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
                {formData.password && (
                    <div className="px-2">
                        <div className="flex gap-1 items-center">
                            {[0, 1, 2, 3].map((i) => (
                                <div
                                    key={i}
                                    className="h-1.5 flex-1 rounded-full transition-colors"
                                    style={{
                                        backgroundColor:
                                            i < pwStrength.score
                                                ? pwStrength.valid
                                                    ? theme
                                                    : '#f59e0b'
                                                : '#e5e7eb',
                                    }}
                                />
                            ))}
                        </div>
                        <p
                            className="mt-1 text-[10px] font-semibold uppercase tracking-widest"
                            style={{
                                color: pwStrength.valid ? theme : '#f59e0b',
                            }}
                        >
                            {pwStrength.label}
                            {!pwStrength.valid && ' • need 8+ chars with letter & number'}
                        </p>
                    </div>
                )}
                <FieldWithIcon
                    icon={<Lock size={18} />}
                    theme={theme}
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm Password"
                    value={formData.confirmPassword}
                    onChange={(v) => updateField('confirmPassword', v)}
                    autoComplete="new-password"
                    rightAdornment={
                        <button
                            type="button"
                            onClick={() => setShowConfirmPassword((v) => !v)}
                            className="text-gray-400 hover:text-gray-600"
                            aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        >
                            {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    }
                />
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
                        className="w-full bg-gray-50 border border-gray-100 rounded-2xl pl-12 pr-4 py-4 text-sm font-bold text-gray-800 outline-none focus:bg-white transition-all uppercase tracking-widest"
                        onChange={(e) => updateField('referralCode', e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}
                        onFocus={(e) => (e.target.style.borderColor = theme)}
                        onBlur={(e) => (e.target.style.borderColor = '#F3F4F6')}
                    />
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
                        />
                        <LegCard
                            active={formData.leg === 'R'}
                            theme={theme}
                            onClick={() => setLeg('R')}
                            icon={<ArrowRight size={22} />}
                            label="Right Leg"
                        />
                    </div>
                    <p className="mt-1.5 pl-1 text-[10px] font-semibold text-gray-400">
                        Your sponsor places you under their left or right team.
                    </p>
                </div>

                <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full text-white py-5 rounded-[24px] text-xs font-black tracking-[4px] flex items-center justify-center gap-3 active:scale-95 transition-all uppercase"
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

function LegCard({ active, theme, onClick, icon, label }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`relative flex flex-col items-center justify-center gap-1.5 py-4 rounded-2xl border-2 transition-all ${
                active
                    ? 'bg-white shadow-md scale-[1.02]'
                    : 'bg-gray-50 border-gray-100 text-gray-400 hover:bg-white'
            }`}
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

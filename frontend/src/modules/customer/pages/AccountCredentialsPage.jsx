import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeft,
    Mail,
    Phone,
    KeyRound,
    Eye,
    EyeOff,
    Copy,
    Loader2,
    ShieldAlert,
    Pencil,
    X,
    BadgeCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { customerApi } from '../services/customerApi';

/**
 * Customer-MLM-rebuild Phase 7 (PO-request) — Account Credentials.
 *
 * Read-only screen that surfaces the customer's login credentials:
 * email, phone, and plaintext password. Plaintext is hidden behind
 * an eye toggle so the page isn't immediately shoulder-surf-able.
 *
 * The password value is empty for customers who signed up BEFORE
 * the plaintext copy became permanent — the backend signals that
 * via `hasStoredPassword: false`, and we render an inline note
 * instead of the field.
 *
 * The "echo your password on demand" pattern is widely considered
 * a security anti-pattern; this screen exists only because the
 * product owner explicitly requested it. See the SECURITY NOTE on
 * the backend `Customer._signupPasswordPlaintext` field for the
 * full trade-off discussion.
 */
const AccountCredentialsPage = () => {
    const [loading, setLoading] = useState(true);
    const [creds, setCreds] = useState(null);
    const [showPassword, setShowPassword] = useState(false);
    const [changeOpen, setChangeOpen] = useState(false);

    const fetchCreds = async () => {
        try {
            const res = await customerApi.getCredentials();
            setCreds(res.data?.result ?? res.data?.data ?? res.data);
        } catch (err) {
            toast.error(
                err?.response?.data?.message ||
                    'Failed to load your account details.',
            );
        }
    };

    useEffect(() => {
        let mounted = true;
        (async () => {
            await fetchCreds();
            if (mounted) setLoading(false);
        })();
        return () => {
            mounted = false;
        };
    }, []);

    const copy = (label, value) => {
        if (!value) return;
        navigator.clipboard
            ?.writeText(value)
            .then(() => toast.success(`${label} copied to clipboard`))
            .catch(() => toast.error(`Could not copy ${label.toLowerCase()}`));
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-24">
            {/* Sticky header */}
            <div className="bg-white sticky top-0 z-30 px-4 py-3 flex items-center gap-3 shadow-sm">
                <Link
                    to="/profile"
                    className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                    aria-label="Back to profile"
                >
                    <ArrowLeft size={24} className="text-slate-600" />
                </Link>
                <h1 className="text-lg font-black text-slate-800">
                    Account Credentials
                </h1>
            </div>

            <div className="max-w-xl mx-auto px-4 pt-4 space-y-4">
                {loading ? (
                    <div className="bg-white rounded-2xl border border-slate-200 p-10 flex justify-center">
                        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                    </div>
                ) : (
                    <>
                        {/* Privacy banner — keep the user honest about
                            the security trade-off the moment they
                            land on this screen. */}
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
                            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                                <ShieldAlert size={18} />
                            </div>
                            <div className="text-[12px] leading-relaxed text-amber-900">
                                <p className="font-bold mb-0.5">
                                    Keep this screen private
                                </p>
                                <p className="opacity-90">
                                    Anyone who can see your screen can sign
                                    in as you. Use the eye icon to reveal
                                    your password only when you need it.
                                </p>
                            </div>
                        </div>

                        <CredentialRow
                            icon={<BadgeCheck size={18} />}
                            label="User ID"
                            value={creds?.userId || ''}
                            placeholder="—"
                            mono
                            onCopy={() => copy('User ID', creds?.userId)}
                            footer={
                                creds && !creds.userId ? (
                                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                        A unique User ID will appear here
                                        once your account finishes upgrading.
                                        Sign in by phone in the meantime.
                                    </p>
                                ) : null
                            }
                        />

                        <CredentialRow
                            icon={<Mail size={18} />}
                            label="Email"
                            value={creds?.email || ''}
                            placeholder="No email on record"
                            onCopy={() => copy('Email', creds?.email)}
                            footer={
                                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                    Used for account updates only — not for sign-in.
                                    Use your User ID or phone number to log in.
                                </p>
                            }
                        />

                        <CredentialRow
                            icon={<Phone size={18} />}
                            label="Phone"
                            value={creds?.phone || ''}
                            placeholder="No phone on record"
                            onCopy={() => copy('Phone', creds?.phone)}
                        />

                        <CredentialRow
                            icon={<KeyRound size={18} />}
                            label="Password"
                            value={creds?.password || ''}
                            placeholder="—"
                            isSecret
                            secretRevealed={showPassword}
                            onToggleSecret={() =>
                                setShowPassword((v) => !v)
                            }
                            onCopy={() =>
                                copy('Password', creds?.password)
                            }
                            footer={
                                creds && !creds.hasStoredPassword ? (
                                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                        Your current password was created
                                        before we started keeping a copy
                                        for this screen. It still works
                                        for sign-in, but cannot be shown
                                        here. Change your password to
                                        record a new one you can view
                                        later.
                                    </p>
                                ) : null
                            }
                        />

                        <button
                            type="button"
                            onClick={() => setChangeOpen(true)}
                            className="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-2xl py-3.5 flex items-center justify-center gap-2 transition-colors"
                        >
                            <Pencil size={16} />
                            Change Password
                        </button>
                    </>
                )}
            </div>

            {changeOpen && (
                <ChangePasswordModal
                    onClose={() => setChangeOpen(false)}
                    onSuccess={async () => {
                        setChangeOpen(false);
                        await fetchCreds();
                        setShowPassword(true);
                        toast.success('Password updated.');
                    }}
                />
            )}
        </div>
    );
};

/**
 * Inline modal — collects current + new password and POSTs to
 * `/customer/change-password`. On success the parent refetches the
 * credentials so the new value renders immediately.
 *
 * Per PO-request, the NEW password has zero complexity rules — same
 * relaxation that applies to signup. The CURRENT password is
 * required because the backend bcrypt-verifies it as proof of
 * knowledge.
 */
const ChangePasswordModal = ({ onClose, onSuccess }) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!currentPassword) {
            toast.error('Enter your current password.');
            return;
        }
        if (!newPassword) {
            toast.error('Enter a new password.');
            return;
        }
        setSubmitting(true);
        try {
            await customerApi.changePassword({
                currentPassword,
                newPassword,
            });
            onSuccess();
        } catch (err) {
            const code = err?.response?.data?.result?.code;
            const message = err?.response?.data?.message;
            if (code === 'INVALID_CURRENT_PASSWORD') {
                toast.error('Current password is incorrect.');
            } else {
                toast.error(message || 'Failed to update password.');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-100 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-3xl w-full max-w-md shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <h2 className="text-base font-bold text-slate-900">
                        Change Password
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 -mr-1.5 rounded-full text-slate-500 hover:bg-slate-100 transition-colors"
                        aria-label="Close"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={submit} className="px-5 py-5 space-y-4">
                    <ModalPasswordField
                        label="Current Password"
                        value={currentPassword}
                        onChange={setCurrentPassword}
                        show={showCurrent}
                        onToggleShow={() => setShowCurrent((v) => !v)}
                        autoFocus
                        autoComplete="current-password"
                    />

                    <ModalPasswordField
                        label="New Password"
                        value={newPassword}
                        onChange={setNewPassword}
                        show={showNew}
                        onToggleShow={() => setShowNew((v) => !v)}
                        autoComplete="new-password"
                    />

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-100 disabled:opacity-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            {submitting && (
                                <Loader2 size={14} className="animate-spin" />
                            )}
                            {submitting ? 'Updating…' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const ModalPasswordField = ({
    label,
    value,
    onChange,
    show,
    onToggleShow,
    autoComplete,
    autoFocus = false,
}) => (
    <label className="block">
        <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
            {label}
        </span>
        <div className="mt-1.5 relative">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoComplete={autoComplete}
                autoFocus={autoFocus}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-11 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-slate-400 focus:bg-white transition-colors"
            />
            <button
                type="button"
                onClick={onToggleShow}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition-colors"
                aria-label={show ? 'Hide password' : 'Show password'}
            >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
        </div>
    </label>
);

/**
 * Single label/value/action row. Handles both plain text fields
 * (email, phone) and the password's show/hide + copy combo.
 */
const CredentialRow = ({
    icon,
    label,
    value,
    placeholder = '—',
    isSecret = false,
    secretRevealed = false,
    onToggleSecret,
    onCopy,
    footer = null,
    mono = false,
}) => {
    const display = (() => {
        if (!value) return placeholder;
        if (!isSecret) return value;
        if (secretRevealed) return value;
        // Mask, but preserve length so the field doesn't reflow on
        // toggle. Cap at 24 dots for very long passwords.
        const len = Math.min(value.length, 24);
        return '•'.repeat(len);
    })();

    const hasValue = Boolean(value);
    const monoClass = isSecret || mono ? 'font-mono tracking-wider' : '';

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 shrink-0">
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                        {label}
                    </p>
                    <p
                        className={`mt-0.5 text-sm font-semibold truncate ${
                            hasValue ? 'text-slate-900' : 'text-slate-400'
                        } ${monoClass}`}
                    >
                        {display}
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {isSecret && (
                        <button
                            type="button"
                            onClick={onToggleSecret}
                            disabled={!hasValue}
                            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            aria-label={
                                secretRevealed
                                    ? 'Hide password'
                                    : 'Show password'
                            }
                        >
                            {secretRevealed ? (
                                <EyeOff size={18} />
                            ) : (
                                <Eye size={18} />
                            )}
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={onCopy}
                        disabled={!hasValue}
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        aria-label={`Copy ${label.toLowerCase()}`}
                    >
                        <Copy size={18} />
                    </button>
                </div>
            </div>
            {footer}
        </div>
    );
};

export default AccountCredentialsPage;

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Upload, ImageOff, Loader2, Smartphone, CreditCard } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';
import axiosInstance from '@core/api/axios';

/**
 * MLM Settings — admin-editable rate sheet driving every runtime
 * decision in `mlmConfigService.getMlmConfig()`. Persisted under
 * `Setting.mlm.*`.
 *
 * Sections:
 *   - Toggle + joining package
 *   - Plan A binary pair bonus tiers + fixed-after fallback + cooldown
 *   - Plan B repurchase bonus levels (editable rows)
 *   - Mentor royalty levels
 *   - Withdrawal charges
 *   - Daily earning cap + behaviour
 *   - Home shopping commissions
 */
const MlmSettings = () => {
    const [cfg, setCfg] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await adminMlmApi.getMlmSettings();
            setCfg(res.data?.result ?? res.data?.data);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const save = async () => {
        setSaving(true);
        try {
            // Only send writable fields; the backend will strip unknowns.
            const payload = {
                enabled: !!cfg.enabled,
                signupRequiresReferralCode: cfg.signupRequiresReferralCode !== false,
                joiningPackagePrice: Number(cfg.joiningPackagePrice) || 0,
                joiningPackageShoppingWalletCredit: Number(cfg.joiningPackageShoppingWalletCredit) || 0,
                joiningPaymentMode:
                    cfg.joiningPaymentMode === 'phonepe' ? 'phonepe' : 'manual_qr',
                manualQr: {
                    imageUrl: (cfg.manualQr?.imageUrl || '').trim(),
                    upiId: (cfg.manualQr?.upiId || '').trim(),
                    merchantName: (cfg.manualQr?.merchantName || '').trim(),
                    instructions: (cfg.manualQr?.instructions || '').trim(),
                },
                premiumUpgradeShoppingWalletTopup: Number(cfg.premiumUpgradeShoppingWalletTopup) || 0,
                planBAutoUpgradeAtPlanALifetimeEarnings: Number(cfg.planBAutoUpgradeAtPlanALifetimeEarnings) || 0,
                planAPairBonusTiers: (cfg.planAPairBonusTiers || []).map((t) => ({
                    pairIndex: Number(t.pairIndex) || 1,
                    bonusAmount: Number(t.bonusAmount) || 0,
                })),
                planAPairBonusFixedAfterPair: Number(cfg.planAPairBonusFixedAfterPair) || 0,
                planAPairBonusFixedAmount: Number(cfg.planAPairBonusFixedAmount) || 0,
                planAPairBonusReleaseCooldownDays: Number(cfg.planAPairBonusReleaseCooldownDays) || 0,
                repurchaseBonusLevels: (cfg.repurchaseBonusLevels || []).map((l) => ({
                    level: Number(l.level) || 1,
                    ratePercent: Number(l.ratePercent) || 0,
                })),
                mentorRoyaltyLevels: (cfg.mentorRoyaltyLevels || []).map((l) => ({
                    level: Number(l.level) || 1,
                    ratePercent: Number(l.ratePercent) || 0,
                })),
                homeShoppingProductId: cfg.homeShoppingProductId || null,
                homeShoppingPrice: Number(cfg.homeShoppingPrice) || 0,
                homeShoppingProductCreditValue: Number(cfg.homeShoppingProductCreditValue) || 0,
                homeShoppingCommissions: {
                    salesPercent: Number(cfg.homeShoppingCommissions?.salesPercent) || 0,
                    referralPercent: Number(cfg.homeShoppingCommissions?.referralPercent) || 0,
                    royaltyPercent: Number(cfg.homeShoppingCommissions?.royaltyPercent) || 0,
                },
                withdrawalMinAmount: Number(cfg.withdrawalMinAmount) || 0,
                withdrawalAdminChargePercent: Number(cfg.withdrawalAdminChargePercent) || 0,
                withdrawalGstOnAdminChargePercent: Number(cfg.withdrawalGstOnAdminChargePercent) || 0,
                dailyEarningCap: Number(cfg.dailyEarningCap) || 0,
                binaryPlacementStrategy: cfg.binaryPlacementStrategy || 'balanced_auto',
                bonusesOnReturn: cfg.bonusesOnReturn || 'clawback',
                sponsorChainMaxDepth: Number(cfg.sponsorChainMaxDepth) || 10,
                referralCodeLength: Number(cfg.referralCodeLength) || 8,
            };
            await adminMlmApi.updateMlmSettings(payload);
            toast.success('MLM settings saved');
            await load();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !cfg) return <div className="p-6 text-slate-500">Loading...</div>;

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
            <div className="flex items-start sm:items-center justify-between gap-3 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900">MLM Settings</h1>
                <button
                    onClick={save}
                    disabled={saving}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-lg flex items-center gap-2 disabled:bg-slate-300"
                >
                    <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
                </button>
            </div>

            <Section title="Program Toggle">
                <Toggle label="MLM Enabled" value={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} />
                <p className="text-xs text-slate-500 mt-2">When disabled, signup referral codes are still captured but no bonuses fire and the customer dashboard shows a "coming soon" placeholder.</p>
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <Toggle
                        label="Require referral code at signup"
                        value={cfg.signupRequiresReferralCode !== false}
                        onChange={(v) => setCfg({ ...cfg, signupRequiresReferralCode: v })}
                    />
                    <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        When ON, no new customer can create an account without
                        a valid sponsor referral code. The signup OTP endpoint
                        rejects the request before sending an SMS. Toggle OFF
                        only to bootstrap the very first member of the system,
                        then turn it back ON.
                    </p>
                </div>
            </Section>

            <Section title="Joining Package (Plan A entry)">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <NumField label="Price (₹)" value={cfg.joiningPackagePrice} onChange={(v) => setCfg({ ...cfg, joiningPackagePrice: v })} />
                    <NumField label="Shopping wallet credit on join (₹)" value={cfg.joiningPackageShoppingWalletCredit} onChange={(v) => setCfg({ ...cfg, joiningPackageShoppingWalletCredit: v })} />
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    Joining is a direct payment subscription — no product or order is created.
                    The price and shopping credit are snapshotted when the customer clicks
                    "Join Now", so mid-flight edits never cheat in-flight customers.
                </p>
            </Section>

            <Section title="Joining Payment Mode">
                <JoiningPaymentModePanel cfg={cfg} setCfg={setCfg} />
            </Section>

            <Section title="Plan A → Plan B Auto-Upgrade">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <NumField label="Auto-upgrade at lifetime Plan A earnings (₹)" value={cfg.planBAutoUpgradeAtPlanALifetimeEarnings} onChange={(v) => setCfg({ ...cfg, planBAutoUpgradeAtPlanALifetimeEarnings: v })} />
                    <NumField label="Plan B upgrade shopping wallet top-up (₹)" value={cfg.premiumUpgradeShoppingWalletTopup} onChange={(v) => setCfg({ ...cfg, premiumUpgradeShoppingWalletTopup: v })} />
                </div>
            </Section>

            <Section title="Plan A: Binary Pair Bonus Tiers">
                <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                    Plan A pays a bonus every time a sponsor completes a new
                    matched pair of direct referrals — one personally referred
                    member in the LEFT subtree and one in the RIGHT subtree
                    of their binary tree. Each row below sets the payout for
                    a specific pair index (1st pair, 2nd pair, ...). Pairs
                    beyond the table fall back to the fixed amount below.
                </p>
                <RuleEditor
                    rows={cfg.planAPairBonusTiers || []}
                    columns={[
                        { key: 'pairIndex', label: 'Pair #', type: 'number', min: 1 },
                        { key: 'bonusAmount', label: 'Bonus (₹)', type: 'number', min: 0 },
                    ]}
                    defaults={{ pairIndex: (cfg.planAPairBonusTiers?.length || 0) + 1, bonusAmount: 0 }}
                    onChange={(rows) => setCfg({ ...cfg, planAPairBonusTiers: rows })}
                />
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                    <NumField
                        label="Fixed amount kicks in AFTER pair #"
                        value={cfg.planAPairBonusFixedAfterPair}
                        onChange={(v) => setCfg({ ...cfg, planAPairBonusFixedAfterPair: v })}
                        min={0}
                    />
                    <NumField
                        label="Fixed bonus amount (₹)"
                        value={cfg.planAPairBonusFixedAmount}
                        onChange={(v) => setCfg({ ...cfg, planAPairBonusFixedAmount: v })}
                        min={0}
                    />
                    <NumField
                        label="Pending → Earnings cooldown (days)"
                        value={cfg.planAPairBonusReleaseCooldownDays}
                        onChange={(v) => setCfg({ ...cfg, planAPairBonusReleaseCooldownDays: v })}
                        min={0}
                        max={365}
                    />
                </div>
                <PairBonusPreview cfg={cfg} />
            </Section>

            <Section title="Plan B: Repurchase Bonus Levels (% of grandTotal)">
                <RuleEditor
                    rows={cfg.repurchaseBonusLevels || []}
                    columns={[
                        { key: 'level', label: 'Level', type: 'number', min: 1, max: 12 },
                        { key: 'ratePercent', label: 'Rate %', type: 'number', min: 0, max: 100 },
                    ]}
                    defaults={{ level: 1, ratePercent: 0 }}
                    onChange={(rows) => setCfg({ ...cfg, repurchaseBonusLevels: rows })}
                />
            </Section>

            <Section title="Plan B: Mentor Royalty (% of downline's commission)">
                <RuleEditor
                    rows={cfg.mentorRoyaltyLevels || []}
                    columns={[
                        { key: 'level', label: 'Level', type: 'number', min: 1, max: 6 },
                        { key: 'ratePercent', label: 'Rate %', type: 'number', min: 0, max: 100 },
                    ]}
                    defaults={{ level: 1, ratePercent: 0 }}
                    onChange={(rows) => setCfg({ ...cfg, mentorRoyaltyLevels: rows })}
                />
            </Section>

            <Section title="Home Shopping (Plan B exclusive)">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    <TextField label="Product ID" value={cfg.homeShoppingProductId || ''} onChange={(v) => setCfg({ ...cfg, homeShoppingProductId: v.trim() || null })} />
                    <NumField label="Price (₹)" value={cfg.homeShoppingPrice} onChange={(v) => setCfg({ ...cfg, homeShoppingPrice: v })} />
                    <NumField label="Product credit value (₹)" value={cfg.homeShoppingProductCreditValue} onChange={(v) => setCfg({ ...cfg, homeShoppingProductCreditValue: v })} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                    <NumField label="Sales %" value={cfg.homeShoppingCommissions?.salesPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, salesPercent: v } })} />
                    <NumField label="Referral %" value={cfg.homeShoppingCommissions?.referralPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, referralPercent: v } })} />
                    <NumField label="Royalty %" value={cfg.homeShoppingCommissions?.royaltyPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, royaltyPercent: v } })} />
                </div>
            </Section>

            <Section title="Withdrawals">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <NumField label="Min withdrawal (₹)" value={cfg.withdrawalMinAmount} onChange={(v) => setCfg({ ...cfg, withdrawalMinAmount: v })} />
                    <NumField label="Admin charge %" value={cfg.withdrawalAdminChargePercent} onChange={(v) => setCfg({ ...cfg, withdrawalAdminChargePercent: v })} max={100} />
                    <NumField label="TDS %" value={cfg.withdrawalGstOnAdminChargePercent} onChange={(v) => setCfg({ ...cfg, withdrawalGstOnAdminChargePercent: v })} max={100} />
                </div>
            </Section>

            <Section title="Cap & Behaviour">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <NumField label="Daily earning cap (₹)" value={cfg.dailyEarningCap} onChange={(v) => setCfg({ ...cfg, dailyEarningCap: v })} />
                    <SelectField
                        label="Binary placement strategy"
                        value={cfg.binaryPlacementStrategy}
                        onChange={(v) => setCfg({ ...cfg, binaryPlacementStrategy: v })}
                        options={[
                            { value: 'balanced_auto', label: 'Balanced (auto weaker leg)' },
                            { value: 'spillover', label: 'Spillover (preferred leg)' },
                            { value: 'manual', label: 'Manual' },
                        ]}
                    />
                    <SelectField
                        label="On return"
                        value={cfg.bonusesOnReturn}
                        onChange={(v) => setCfg({ ...cfg, bonusesOnReturn: v })}
                        options={[
                            { value: 'clawback', label: 'Clawback bonuses' },
                            { value: 'forfeit_future', label: 'Forfeit future bonuses' },
                        ]}
                    />
                    <NumField label="Sponsor chain max depth" value={cfg.sponsorChainMaxDepth} onChange={(v) => setCfg({ ...cfg, sponsorChainMaxDepth: v })} min={1} max={50} />
                </div>
            </Section>
        </div>
    );
};

const Section = ({ title, children }) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide mb-3">{title}</h3>
        {children}
    </div>
);

const NumField = ({ label, value, onChange, min, max }) => (
    <label className="block">
        <span className="text-xs font-semibold text-slate-600 block mb-1">{label}</span>
        <input
            type="number"
            min={min}
            max={max}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
    </label>
);

const TextField = ({ label, value, onChange, hint }) => (
    <label className="block">
        <span className="text-xs font-semibold text-slate-600 block mb-1">{label}</span>
        <input
            type="text"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
        />
        {hint && <span className="text-[11px] text-slate-500 mt-1 block">{hint}</span>}
    </label>
);

const Toggle = ({ label, value, onChange }) => (
    <button
        type="button"
        onClick={() => onChange(!value)}
        className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-lg ${value ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`}
    >
        {label}: {value ? 'ON' : 'OFF'}
    </button>
);

const SelectField = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-xs font-semibold text-slate-600 block mb-1">{label}</span>
        <select
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    </label>
);

/**
 * Inline preview of the resulting pair bonus payouts so admins can
 * verify their tier table at a glance. Shows pairs 1..min(8, fixedAfterPair+3)
 * with their resolved amount (per-tier override or fixed-amount fallback).
 */
const PairBonusPreview = ({ cfg }) => {
    const tiers = (cfg.planAPairBonusTiers || []).reduce((acc, t) => {
        if (t && Number.isFinite(Number(t.pairIndex))) {
            acc[Number(t.pairIndex)] = Number(t.bonusAmount) || 0;
        }
        return acc;
    }, {});
    const fixedAfter = Math.max(0, Number(cfg.planAPairBonusFixedAfterPair) || 0);
    const fixedAmount = Math.max(0, Number(cfg.planAPairBonusFixedAmount) || 0);
    const explicitMax = Object.keys(tiers).reduce(
        (m, k) => Math.max(m, Number(k) || 0),
        0,
    );
    const previewMax = Math.max(explicitMax, fixedAfter + 2, 5);

    const resolve = (idx) => {
        if (Object.prototype.hasOwnProperty.call(tiers, idx)) return tiers[idx];
        if (idx > fixedAfter) return fixedAmount;
        return 0;
    };

    return (
        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-3">
            <div className="text-[10px] uppercase font-bold text-slate-500 mb-2">Preview</div>
            <div className="flex flex-wrap gap-2">
                {Array.from({ length: previewMax }, (_, i) => i + 1).map((idx) => {
                    const amount = resolve(idx);
                    const isFixed = idx > fixedAfter && !Object.prototype.hasOwnProperty.call(tiers, idx);
                    return (
                        <div
                            key={idx}
                            className={`text-xs font-mono px-2 py-1 rounded ${isFixed ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}
                            title={isFixed ? 'Fixed amount fallback' : 'From tier table'}
                        >
                            Pair {idx}: ₹{amount}
                            {isFixed ? ' (fixed)' : ''}
                        </div>
                    );
                })}
            </div>
            <div className="text-[10px] text-slate-500 mt-2">
                Indigo = explicit tier row · Emerald = fixed-amount fallback (pairs &gt; {fixedAfter})
            </div>
        </div>
    );
};

const RuleEditor = ({ rows, columns, defaults, onChange }) => {
    const handleAdd = () => onChange([...rows, { ...defaults }]);
    const handleRemove = (i) => onChange(rows.filter((_, idx) => idx !== i));
    const handleEdit = (i, key, v) => {
        const next = rows.slice();
        next[i] = { ...next[i], [key]: v };
        onChange(next);
    };
    return (
        <div className="space-y-2">
            {rows.map((row, i) => (
                <div key={i} className="flex items-end gap-2">
                    {columns.map((col) => (
                        <label key={col.key} className="flex-1">
                            <span className="text-[10px] uppercase font-bold text-slate-500 block mb-0.5">{col.label}</span>
                            <input
                                type={col.type}
                                min={col.min}
                                max={col.max}
                                value={row[col.key] ?? ''}
                                onChange={(e) => handleEdit(i, col.key, col.type === 'number' ? Number(e.target.value) : e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                            />
                        </label>
                    ))}
                    <button
                        onClick={() => handleRemove(i)}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            ))}
            <button
                onClick={handleAdd}
                className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:underline"
            >
                <Plus size={14} /> Add row
            </button>
        </div>
    );
};

/**
 * Joining Payment Mode panel — radio toggle between manual QR and the
 * PhonePe gateway, plus the manual-QR display config (image upload, UPI
 * id, merchant name, instructions). Mirrors the customer-facing layout
 * in a live preview pane on the right.
 */
const JoiningPaymentModePanel = ({ cfg, setCfg }) => {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const mode = cfg.joiningPaymentMode === 'phonepe' ? 'phonepe' : 'manual_qr';
    const manualQr = cfg.manualQr || {};

    const setMode = (next) => setCfg({ ...cfg, joiningPaymentMode: next });
    const setManual = (patch) =>
        setCfg({ ...cfg, manualQr: { ...manualQr, ...patch } });

    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            toast.error('Please select an image file.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            toast.error('Image must be 10 MB or smaller.');
            return;
        }
        setUploading(true);
        try {
            const fd = new FormData();
            fd.append('file', file);
            const res = await axiosInstance.post('/media/upload', fd, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const url =
                res.data?.result?.url || res.data?.data?.url || res.data?.url || '';
            if (!url) throw new Error('Upload returned no URL');
            setManual({ imageUrl: url });
            toast.success('QR uploaded — remember to save changes');
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || 'Upload failed');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ModeRadio
                    active={mode === 'manual_qr'}
                    icon={<Smartphone size={18} />}
                    title="Manual QR"
                    badge="Temporary"
                    description="Customer scans an admin-uploaded UPI QR, pays externally, and submits txn id + screenshot. Admin manually approves in Joining Reviews."
                    onClick={() => setMode('manual_qr')}
                />
                <ModeRadio
                    active={mode === 'phonepe'}
                    icon={<CreditCard size={18} />}
                    title="PhonePe Gateway"
                    badge="Production"
                    description="Hosted checkout with automatic capture via webhook. Requires completed PhonePe KYC."
                    onClick={() => setMode('phonepe')}
                />
            </div>

            {mode === 'manual_qr' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-3">
                        <div>
                            <span className="text-xs font-semibold text-slate-600 block mb-1">
                                Payment QR image
                            </span>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleUpload}
                                className="hidden"
                            />
                            {manualQr.imageUrl ? (
                                <div className="flex gap-3 items-start">
                                    <img
                                        src={manualQr.imageUrl}
                                        alt="QR"
                                        className="w-24 h-24 object-contain border border-slate-200 rounded-lg bg-white"
                                    />
                                    <div className="flex-1 space-y-2">
                                        <button
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={uploading}
                                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-700 text-white inline-flex items-center gap-1 disabled:opacity-60">
                                            {uploading ? (
                                                <>
                                                    <Loader2 size={12} className="animate-spin" />
                                                    Uploading…
                                                </>
                                            ) : (
                                                <>
                                                    <Upload size={12} /> Replace
                                                </>
                                            )}
                                        </button>
                                        <button
                                            onClick={() => setManual({ imageUrl: '' })}
                                            className="ml-2 px-3 py-1.5 text-xs font-bold rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50">
                                            Remove
                                        </button>
                                        <p className="text-[11px] text-slate-500">
                                            Empty image falls back to a bundled
                                            placeholder on the customer page.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => fileInputRef.current?.click()}
                                    disabled={uploading}
                                    className="w-full border-2 border-dashed border-slate-300 rounded-lg py-6 px-4 flex flex-col items-center justify-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-60">
                                    {uploading ? (
                                        <Loader2 size={20} className="animate-spin text-slate-400" />
                                    ) : (
                                        <Upload size={20} className="text-slate-400" />
                                    )}
                                    <span className="text-sm font-bold text-slate-700">
                                        Upload UPI QR image
                                    </span>
                                    <span className="text-[11px] text-slate-500">
                                        JPG / PNG / WebP, ≤ 10 MB
                                    </span>
                                </button>
                            )}
                        </div>

                        <TextField
                            label="UPI ID"
                            value={manualQr.upiId || ''}
                            onChange={(v) => setManual({ upiId: v })}
                            hint="Shown alongside the QR for cross-verification."
                        />
                        <TextField
                            label="Merchant / payee name"
                            value={manualQr.merchantName || ''}
                            onChange={(v) => setManual({ merchantName: v })}
                        />
                        <label className="block">
                            <span className="text-xs font-semibold text-slate-600 block mb-1">
                                Instructions (optional)
                            </span>
                            <textarea
                                value={manualQr.instructions || ''}
                                onChange={(e) =>
                                    setManual({ instructions: e.target.value })
                                }
                                rows={4}
                                maxLength={2000}
                                placeholder="e.g. After payment, copy the UPI transaction ID from your bank app and upload a screenshot."
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            />
                        </label>
                    </div>

                    <ManualQrPreview cfg={cfg} manualQr={manualQr} />
                </div>
            )}

            {mode === 'phonepe' && (
                <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    PhonePe-pg checkout will handle joining payments
                    automatically. The customer will be redirected to
                    PhonePe and back; activation fires on the success
                    webhook. Configure provider credentials in System
                    Settings.
                </p>
            )}
        </div>
    );
};

const ModeRadio = ({ active, icon, title, badge, description, onClick }) => (
    <button
        type="button"
        onClick={onClick}
        className={`text-left rounded-2xl border p-4 transition-colors ${
            active
                ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}>
        <div className="flex items-center gap-2">
            <span
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                {icon}
            </span>
            <div className="flex-1">
                <div className="flex items-center gap-2">
                    <p className="font-bold text-slate-900 text-sm">{title}</p>
                    {badge && (
                        <span
                            className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                                badge === 'Temporary'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                            }`}>
                            {badge}
                        </span>
                    )}
                </div>
            </div>
            <span
                className={`w-4 h-4 rounded-full border-2 ${
                    active ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'
                }`}
            />
        </div>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
            {description}
        </p>
    </button>
);

const ManualQrPreview = ({ cfg, manualQr }) => {
    const price = Number(cfg.joiningPackagePrice) || 0;
    return (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">
                Customer view (preview)
            </p>
            <div className="rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-4 text-white mb-3">
                <p className="text-[11px] uppercase font-bold opacity-80 tracking-widest">
                    Amount to pay
                </p>
                <p className="text-2xl font-black mt-1">
                    ₹{price.toLocaleString('en-IN')}
                </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3 text-center">
                {manualQr.imageUrl ? (
                    <img
                        src={manualQr.imageUrl}
                        alt="QR preview"
                        className="w-32 h-32 object-contain mx-auto"
                    />
                ) : (
                    <div className="w-32 h-32 mx-auto flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded">
                        <ImageOff size={24} />
                        <p className="text-[10px] mt-2">Bundled fallback</p>
                    </div>
                )}
                {manualQr.merchantName && (
                    <p className="text-xs font-bold text-slate-900 mt-2">
                        {manualQr.merchantName}
                    </p>
                )}
                {manualQr.upiId && (
                    <p className="text-[11px] font-mono text-slate-600 mt-0.5">
                        {manualQr.upiId}
                    </p>
                )}
            </div>
            {manualQr.instructions && (
                <div className="mt-3 bg-white border border-slate-200 rounded-xl p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">
                        Instructions
                    </p>
                    <p className="text-xs text-slate-700 whitespace-pre-line leading-relaxed">
                        {manualQr.instructions}
                    </p>
                </div>
            )}
        </div>
    );
};

export default MlmSettings;

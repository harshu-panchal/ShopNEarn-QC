import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

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
        <div className="p-6 space-y-6 max-w-4xl">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-slate-900">MLM Settings</h1>
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
                <div className="grid grid-cols-2 gap-3">
                    <NumField label="Price (₹)" value={cfg.joiningPackagePrice} onChange={(v) => setCfg({ ...cfg, joiningPackagePrice: v })} />
                    <NumField label="Shopping wallet credit on join (₹)" value={cfg.joiningPackageShoppingWalletCredit} onChange={(v) => setCfg({ ...cfg, joiningPackageShoppingWalletCredit: v })} />
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">
                    Joining is a direct payment subscription — no product or order is created.
                    The price and shopping credit are snapshotted when the customer clicks
                    "Join Now", so mid-flight edits never cheat in-flight customers.
                </p>
            </Section>

            <Section title="Plan A → Plan B Auto-Upgrade">
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-3 gap-3 mt-4">
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
                <div className="grid grid-cols-2 gap-3">
                    <TextField label="Product ID" value={cfg.homeShoppingProductId || ''} onChange={(v) => setCfg({ ...cfg, homeShoppingProductId: v.trim() || null })} />
                    <NumField label="Price (₹)" value={cfg.homeShoppingPrice} onChange={(v) => setCfg({ ...cfg, homeShoppingPrice: v })} />
                    <NumField label="Product credit value (₹)" value={cfg.homeShoppingProductCreditValue} onChange={(v) => setCfg({ ...cfg, homeShoppingProductCreditValue: v })} />
                </div>
                <div className="grid grid-cols-3 gap-3 mt-2">
                    <NumField label="Sales %" value={cfg.homeShoppingCommissions?.salesPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, salesPercent: v } })} />
                    <NumField label="Referral %" value={cfg.homeShoppingCommissions?.referralPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, referralPercent: v } })} />
                    <NumField label="Royalty %" value={cfg.homeShoppingCommissions?.royaltyPercent || 0} onChange={(v) => setCfg({ ...cfg, homeShoppingCommissions: { ...cfg.homeShoppingCommissions, royaltyPercent: v } })} />
                </div>
            </Section>

            <Section title="Withdrawals">
                <div className="grid grid-cols-3 gap-3">
                    <NumField label="Min withdrawal (₹)" value={cfg.withdrawalMinAmount} onChange={(v) => setCfg({ ...cfg, withdrawalMinAmount: v })} />
                    <NumField label="Admin charge %" value={cfg.withdrawalAdminChargePercent} onChange={(v) => setCfg({ ...cfg, withdrawalAdminChargePercent: v })} max={100} />
                    <NumField label="GST on charge %" value={cfg.withdrawalGstOnAdminChargePercent} onChange={(v) => setCfg({ ...cfg, withdrawalGstOnAdminChargePercent: v })} max={100} />
                </div>
            </Section>

            <Section title="Cap & Behaviour">
                <div className="grid grid-cols-2 gap-3">
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

export default MlmSettings;

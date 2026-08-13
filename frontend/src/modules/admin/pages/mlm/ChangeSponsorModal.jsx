import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { UserCheck, X, Loader2, ArrowRight, AlertTriangle, ShieldCheck } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const ChangeSponsorModal = ({ open, onClose, member, onSuccess }) => {
    const [newSponsorQuery, setNewSponsorQuery] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) {
            setNewSponsorQuery('');
            setReason('');
            setLoading(false);
        }
    }, [open]);

    if (!open || !member) return null;

    const currentSponsorName = member?.sponsorId?.name || member?.sponsorName || 'None';
    const currentSponsorCode = member?.sponsorId?.userId || member?.sponsorUserId || 'N/A';
    const memberName = member?.userId?.name || member?.name || 'Member';
    const memberCode = member?.userId?.userId || member?.publicUserId || member?.referralCode || 'N/A';
    const membershipId = member?._id || member?.membershipId;

    const handleSubmit = async (e) => {
        e.preventDefault();
        const query = newSponsorQuery.trim().toUpperCase();
        if (!query) {
            toast.error('Please enter new sponsor referral code or user ID');
            return;
        }

        if (query === memberCode.toUpperCase()) {
            toast.error('Member cannot be their own sponsor');
            return;
        }

        if (query === currentSponsorCode.toUpperCase()) {
            toast.error(`Member is already sponsored by ${currentSponsorName} (${currentSponsorCode})`);
            return;
        }

        if (!window.confirm(`Are you sure you want to change direct sponsor of ${memberName} (${memberCode}) to ${query}?`)) {
            return;
        }

        setLoading(true);
        try {
            const res = await adminMlmApi.changeSponsor(membershipId, {
                newSponsorQuery: query,
                reason: reason.trim() || undefined,
            });
            const data = res.data?.data || res.data?.result;
            toast.success(`Direct sponsor updated successfully to ${data?.newSponsor?.name || query}`);
            onSuccess?.(data);
            onClose();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to update direct sponsor');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200 bg-slate-50/50">
                    <div>
                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <UserCheck className="text-indigo-600" size={20} />
                            Change Direct Sponsor
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Re-assign direct referral sponsorship for unilevel bonuses & downline counts.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full hover:bg-slate-200/70 flex items-center justify-center text-slate-500 transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
                    {/* Member Info Card */}
                    <div className="bg-indigo-50/60 border border-indigo-200/70 rounded-xl p-3 text-xs space-y-2">
                        <div className="flex items-center justify-between text-indigo-950 font-bold">
                            <span>Member: {memberName}</span>
                            <span className="font-mono text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200">
                                {memberCode}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-slate-600">
                            <span className="font-semibold">Current Direct Sponsor:</span>
                            <span className="font-bold text-slate-800">{currentSponsorName}</span>
                            <span className="font-mono text-slate-500">({currentSponsorCode})</span>
                        </div>
                    </div>

                    {/* New Sponsor Input */}
                    <div>
                        <label className="block text-xs font-bold text-slate-800 mb-1">
                            New Sponsor Referral Code / User ID <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="text"
                            value={newSponsorQuery}
                            onChange={(e) => setNewSponsorQuery(e.target.value.toUpperCase())}
                            placeholder="e.g. SE22899251"
                            required
                            className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm font-mono tracking-wide uppercase focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                            Enter the target sponsor's public Referral Code or Customer User ID.
                        </p>
                    </div>

                    {/* Reason Textarea */}
                    <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Reason / Audit Note (optional)
                        </label>
                        <textarea
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={2}
                            maxLength={500}
                            placeholder="Correction or support ticket request details"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        />
                    </div>

                    {/* Safety Notice Callout */}
                    <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-amber-50/80 text-[11px] text-amber-900 leading-normal">
                        <ShieldCheck className="shrink-0 text-amber-600 mt-0.5" size={16} />
                        <div>
                            <span className="font-bold block">Genealogy Safety Protection:</span>
                            This action updates direct referral sponsorship and unilevel downline chains. The member's <strong>binary tree placement and position will remain 100% untouched</strong>.
                        </div>
                    </div>

                    {/* Modal Actions */}
                    <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !newSponsorQuery.trim()}
                            className="px-4 py-2 text-xs font-bold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
                        >
                            {loading ? <Loader2 size={14} className="animate-spin" /> : <UserCheck size={14} />}
                            Confirm & Change Sponsor
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ChangeSponsorModal;

import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    Loader2,
    X,
} from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const RECALC_JOBS = [
    {
        id: 'backfill-leg-direct-counts',
        label: 'Leg direct counts',
        description: 'Recompute left/right leg direct counters.',
    },
    {
        id: 'backfill-binary-team-pair-counts',
        label: 'Team pair counters',
        description: 'Recompute team volumes and pair eligibility.',
    },
    {
        id: 'recalculate-downline-counters',
        label: 'Downline counters',
        description: 'Rebuild active/inactive downline counts (sponsor change).',
        sponsorOnly: true,
    },
    {
        id: 'recalc-earnings-wallet',
        label: 'Earnings wallets (destructive)',
        description: 'Zero and re-credit binary pair earnings from current tree.',
        destructive: true,
        options: { force: true },
    },
];

/**
 * Admin wizard — move an existing member to an empty binary slot.
 * Opened once source member + destination slot are chosen on the canvas.
 */
const MoveMemberWizard = ({
    open,
    onClose,
    sourceMember,
    destination,
    onMoved,
}) => {
    const [changeSponsor, setChangeSponsor] = useState(false);
    const [reason, setReason] = useState('');
    const [preview, setPreview] = useState(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [applying, setApplying] = useState(false);
    const [moveResult, setMoveResult] = useState(null);
    const [runningJobId, setRunningJobId] = useState(null);
    const [jobOutputs, setJobOutputs] = useState([]);

    useEffect(() => {
        if (!open) {
            setChangeSponsor(false);
            setReason('');
            setPreview(null);
            setMoveResult(null);
            setJobOutputs([]);
        }
    }, [open]);

    useEffect(() => {
        setPreview(null);
    }, [sourceMember?.membershipId, destination?.parentMembershipId, destination?.leg, changeSponsor]);

    if (!open || !sourceMember || !destination) return null;

    const loadPreview = async () => {
        setPreviewLoading(true);
        try {
            const res = await adminMlmApi.previewMoveBinary(sourceMember.membershipId, {
                newParentMembershipId: destination.parentMembershipId,
                leg: destination.leg,
                changeSponsorToNewParent: changeSponsor,
            });
            setPreview(res.data?.result ?? res.data?.data ?? null);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Preview failed');
        } finally {
            setPreviewLoading(false);
        }
    };

    const applyMove = async () => {
        if (!preview) {
            toast.error('Load the impact preview first');
            return;
        }
        if (
            !window.confirm(
                'Apply this tree move? Binary pointers will be updated immediately.',
            )
        ) {
            return;
        }
        setApplying(true);
        try {
            const res = await adminMlmApi.moveBinary(sourceMember.membershipId, {
                newParentMembershipId: destination.parentMembershipId,
                leg: destination.leg,
                changeSponsorToNewParent: changeSponsor,
                reason: reason.trim() || undefined,
            });
            const result = res.data?.result ?? res.data?.data ?? null;
            setMoveResult(result);
            toast.success('Member moved successfully');
            onMoved?.(result);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Move failed');
        } finally {
            setApplying(false);
        }
    };

    const runJob = async (job) => {
        if (job.destructive) {
            if (
                !window.confirm(
                    'Recalculate earnings wallets? This zeros earnings/pending and re-credits from the current tree.',
                )
            ) {
                return;
            }
        }
        setRunningJobId(job.id);
        try {
            const res = await adminMlmApi.runMaintenanceJob(job.id, {
                apply: true,
                options: job.options || {},
            });
            const output = res.data?.result ?? res.data?.data ?? null;
            setJobOutputs((prev) => [...prev, { jobId: job.id, output }]);
            if (output?.success) {
                toast.success(`${job.label} completed`);
            } else {
                toast.error(`${job.label} failed`);
            }
        } catch (err) {
            toast.error(err?.response?.data?.message || `${job.label} failed`);
        } finally {
            setRunningJobId(null);
        }
    };

    const runRecommended = async () => {
        const ids = moveResult?.recommendedJobIds || preview?.recommendedJobIds || [];
        for (const jobId of ids) {
            const job = RECALC_JOBS.find((j) => j.id === jobId);
            if (!job) continue;
            if (job.destructive) continue;
            await runJob(job);
        }
        toast.success('Recommended counter backfills finished');
    };

    const recommendedIds =
        moveResult?.recommendedJobIds || preview?.recommendedJobIds || [];

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="flex items-start justify-between px-5 py-4 border-b border-slate-200">
                    <div>
                        <h3 className="text-base font-bold text-slate-900">
                            Move member in tree
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Empty slot only — occupied slots are rejected.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-800">
                                {sourceMember.name}
                            </span>
                            <span className="font-mono text-slate-500">
                                {sourceMember.referralCode}
                            </span>
                            <ArrowRight size={14} className="text-slate-400" />
                            <span className="font-bold text-slate-800">
                                {destination.parentName}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 font-bold">
                                {destination.leg} leg
                            </span>
                        </div>
                    </div>

                    {!moveResult && (
                        <>
                            <label className="flex items-start gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={changeSponsor}
                                    onChange={(e) => setChangeSponsor(e.target.checked)}
                                    className="mt-0.5 rounded border-slate-300"
                                />
                                <span>
                                    <span className="font-semibold text-slate-800 block">
                                        Make direct referral of destination parent
                                    </span>
                                    <span className="text-xs text-slate-500">
                                        Updates unilevel sponsor and Direct Referrals list.
                                        Past signup/activation bonuses stay with the original
                                        sponsor.
                                    </span>
                                </span>
                            </label>

                            <label className="block text-xs">
                                <span className="font-semibold text-slate-700 block mb-1">
                                    Reason (optional)
                                </span>
                                <textarea
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    rows={2}
                                    maxLength={500}
                                    placeholder="Support ticket or correction note"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                />
                            </label>

                            <button
                                type="button"
                                disabled={previewLoading}
                                onClick={loadPreview}
                                className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50"
                            >
                                {previewLoading ? (
                                    <span className="inline-flex items-center gap-2">
                                        <Loader2 size={14} className="animate-spin" />
                                        Loading preview…
                                    </span>
                                ) : (
                                    'Load impact preview'
                                )}
                            </button>

                            {preview && (
                                <div className="border border-amber-200 bg-amber-50/60 rounded-xl p-3 text-xs space-y-2">
                                    <p className="font-bold text-amber-900">
                                        Subtree size: {preview.subtreeSize} member(s)
                                    </p>
                                    {preview.willChangeSponsor && (
                                        <p className="text-amber-800">
                                            Unilevel sponsor will change.
                                        </p>
                                    )}
                                    <ul className="list-disc pl-4 text-amber-800 space-y-0.5">
                                        {(preview.warnings || []).map((w) => (
                                            <li key={w}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}

                    {moveResult && (
                        <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-3 text-xs">
                            <div className="flex items-center gap-2 text-emerald-800 font-bold mb-2">
                                <CheckCircle2 size={16} />
                                Move applied
                            </div>
                            <p className="text-emerald-700 mb-3">
                                Run counter backfills so pair volumes and incomes match the
                                new tree.
                            </p>
                            <div className="space-y-2">
                                <button
                                    type="button"
                                    disabled={Boolean(runningJobId)}
                                    onClick={runRecommended}
                                    className="w-full px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    Run recommended backfills
                                </button>
                                {RECALC_JOBS.filter(
                                    (j) =>
                                        recommendedIds.includes(j.id) ||
                                        j.id === 'recalc-earnings-wallet',
                                ).map((job) => (
                                    <button
                                        key={job.id}
                                        type="button"
                                        disabled={
                                            Boolean(runningJobId) ||
                                            (job.sponsorOnly && !preview?.willChangeSponsor && !moveResult?.sponsorChanged)
                                        }
                                        onClick={() => runJob(job)}
                                        className={`w-full px-3 py-2 text-xs font-bold rounded-lg border disabled:opacity-50 flex items-center justify-center gap-1.5 ${
                                            job.destructive
                                                ? 'border-rose-300 text-rose-700 hover:bg-rose-50'
                                                : 'border-slate-300 text-slate-800 hover:bg-slate-50'
                                        }`}
                                    >
                                        {runningJobId === job.id ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : job.destructive ? (
                                            <AlertTriangle size={14} />
                                        ) : null}
                                        {job.label}
                                    </button>
                                ))}
                            </div>
                            {jobOutputs.length > 0 && (
                                <pre className="mt-3 p-2 bg-slate-950 text-slate-100 rounded-lg text-[10px] max-h-32 overflow-auto whitespace-pre-wrap">
                                    {jobOutputs[jobOutputs.length - 1]?.output?.output ||
                                        '(no output)'}
                                </pre>
                            )}
                        </div>
                    )}
                </div>

                <div className="px-5 py-3 border-t border-slate-200 flex gap-2 bg-white">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 px-3 py-2.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                        {moveResult ? 'Done' : 'Cancel'}
                    </button>
                    {!moveResult && (
                        <button
                            type="button"
                            disabled={applying || previewLoading || !preview}
                            onClick={applyMove}
                            className="flex-[1.5] px-3 py-2.5 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        >
                            {applying ? (
                                <Loader2 size={14} className="animate-spin" />
                            ) : null}
                            Apply move
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MoveMemberWizard;

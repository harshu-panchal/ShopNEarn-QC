import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Play, Terminal, Wrench } from 'lucide-react';
import { adminMlmApi } from '../../services/api/mlmApi';

const DANGER_STYLES = {
    low: 'border-slate-200 bg-slate-50',
    medium: 'border-amber-200 bg-amber-50/50',
    high: 'border-orange-200 bg-orange-50/50',
    critical: 'border-rose-300 bg-rose-50',
};

const DANGER_LABELS = {
    low: 'Read-only',
    medium: 'Writes data',
    high: 'Tree / structure',
    critical: 'Destructive',
};

const CATEGORY_ORDER = [
    'Binary Tree',
    'Counters',
    'Income & Bonuses',
    'Audit',
];

/**
 * Admin maintenance panel — runs curated backend/scripts via the API.
 * Mounted at the bottom of MLM Settings.
 */
const MlmMaintenanceTools = () => {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [runningJobId, setRunningJobId] = useState(null);
    const [optionValues, setOptionValues] = useState({});
    const [lastResult, setLastResult] = useState(null);

    useEffect(() => {
        (async () => {
            setLoading(true);
            try {
                const res = await adminMlmApi.listMaintenanceJobs();
                const list = res.data?.result?.jobs ?? res.data?.data?.jobs ?? [];
                setJobs(list);
                const defaults = {};
                for (const job of list) {
                    defaults[job.id] = {};
                    for (const opt of job.options || []) {
                        if (opt.type === 'boolean') {
                            defaults[job.id][opt.key] = Boolean(opt.default);
                        } else {
                            defaults[job.id][opt.key] = opt.default ?? '';
                        }
                    }
                }
                setOptionValues(defaults);
            } catch (err) {
                toast.error(err?.response?.data?.message || 'Failed to load maintenance jobs');
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    const grouped = useMemo(() => {
        const map = new Map();
        for (const cat of CATEGORY_ORDER) map.set(cat, []);
        for (const job of jobs) {
            if (!map.has(job.category)) map.set(job.category, []);
            map.get(job.category).push(job);
        }
        return [...map.entries()].filter(([, items]) => items.length > 0);
    }, [jobs]);

    const setOption = (jobId, key, value) => {
        setOptionValues((prev) => ({
            ...prev,
            [jobId]: { ...prev[jobId], [key]: value },
        }));
    };

    const runJob = async (job, apply) => {
        const opts = optionValues[job.id] || {};
        for (const opt of job.options || []) {
            if (opt.required && !String(opts[opt.key] ?? '').trim()) {
                toast.error(`${opt.label} is required`);
                return;
            }
        }

        const applyLabel = job.readOnly
            ? 'run'
            : job.noDryRun
              ? 'run'
              : apply
                ? 'apply changes'
                : 'preview (dry run)';
        const confirmMsg = job.readOnly
            ? `Run "${job.label}"?`
            : job.noDryRun
              ? `Run "${job.label}"? This will write to the database.`
              : apply
                ? `Apply "${job.label}"? This will write to the database.`
                : `Preview "${job.label}" without writing changes?`;

        if (!window.confirm(confirmMsg)) return;

        setRunningJobId(job.id);
        setLastResult(null);
        try {
            const effectiveApply = job.readOnly ? false : job.noDryRun ? true : Boolean(apply);
            const res = await adminMlmApi.runMaintenanceJob(job.id, {
                apply: effectiveApply,
                options: opts,
            });
            const result = res.data?.result ?? res.data?.data ?? null;
            setLastResult(result);
            if (result?.success) {
                toast.success(`${job.label} — completed (${applyLabel})`);
            } else {
                toast.error(result?.timedOut ? 'Job timed out' : `${job.label} failed`);
            }
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Job failed to start');
        } finally {
            setRunningJobId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
                <Loader2 size={16} className="animate-spin" /> Loading maintenance tools…
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                <Wrench size={18} className="text-indigo-600 shrink-0 mt-0.5" />
                <div className="text-xs text-indigo-900 leading-relaxed space-y-1">
                    <p className="font-bold">Recommended order after a tree rebuild</p>
                    <p>
                        1) Repair slot conflicts → 2) Rebuild tree → 3) Leg direct counts →
                        4) Team pair counters → 5) Earnings recalc (if needed).
                    </p>
                    <p className="text-indigo-700">
                        Do not re-run leg backfill after pair backfill — it can conflict on{' '}
                        <code className="font-mono">pairsCompleted</code>.
                    </p>
                </div>
            </div>

            {grouped.map(([category, items]) => (
                <div key={category} className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        {category}
                    </h4>
                    {items.map((job) => {
                        const busy = runningJobId === job.id;
                        const opts = optionValues[job.id] || {};
                        const danger = job.danger || 'medium';
                        return (
                            <div
                                key={job.id}
                                className={`border rounded-xl p-4 ${DANGER_STYLES[danger] || DANGER_STYLES.medium}`}
                            >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <div className="flex-1 min-w-[200px]">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-bold text-sm text-slate-900">
                                                {job.label}
                                            </p>
                                            <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-white/80 text-slate-600 border border-slate-200">
                                                {DANGER_LABELS[danger] || danger}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                            {job.description}
                                        </p>
                                    </div>
                                    <div className="flex flex-wrap gap-2 shrink-0">
                                        {job.readOnly || job.noDryRun ? (
                                            <button
                                                type="button"
                                                disabled={busy || Boolean(runningJobId)}
                                                onClick={() => runJob(job, job.noDryRun)}
                                                className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 ${
                                                    job.noDryRun
                                                        ? 'bg-indigo-600 hover:bg-indigo-700'
                                                        : 'bg-slate-800 hover:bg-slate-900'
                                                }`}
                                            >
                                                {busy ? (
                                                    <Loader2 size={14} className="animate-spin" />
                                                ) : (
                                                    <Play size={14} />
                                                )}
                                                Run
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={busy || Boolean(runningJobId)}
                                                    onClick={() => runJob(job, false)}
                                                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 disabled:opacity-50 flex items-center gap-1.5"
                                                >
                                                    {busy ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <Terminal size={14} />
                                                    )}
                                                    Preview
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={busy || Boolean(runningJobId)}
                                                    onClick={() => runJob(job, true)}
                                                    className={`px-3 py-1.5 text-xs font-bold rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 ${
                                                        danger === 'critical'
                                                            ? 'bg-rose-600 hover:bg-rose-700'
                                                            : 'bg-indigo-600 hover:bg-indigo-700'
                                                    }`}
                                                >
                                                    {busy ? (
                                                        <Loader2 size={14} className="animate-spin" />
                                                    ) : (
                                                        <AlertTriangle size={14} />
                                                    )}
                                                    Apply
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                {(job.options || []).length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-black/5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {job.options.map((opt) => (
                                            <label key={opt.key} className="block text-xs">
                                                <span className="font-semibold text-slate-700 block mb-1">
                                                    {opt.label}
                                                    {opt.required ? ' *' : ''}
                                                </span>
                                                {opt.type === 'boolean' ? (
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(opts[opt.key])}
                                                        onChange={(e) =>
                                                            setOption(job.id, opt.key, e.target.checked)
                                                        }
                                                        className="rounded border-slate-300"
                                                    />
                                                ) : (
                                                    <input
                                                        type="text"
                                                        value={opts[opt.key] ?? ''}
                                                        placeholder={opt.placeholder || ''}
                                                        onChange={(e) =>
                                                            setOption(job.id, opt.key, e.target.value)
                                                        }
                                                        className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-sm font-mono uppercase"
                                                    />
                                                )}
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ))}

            {lastResult && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div
                        className={`px-4 py-2 text-xs font-bold flex items-center justify-between ${
                            lastResult.success
                                ? 'bg-emerald-50 text-emerald-800'
                                : 'bg-rose-50 text-rose-800'
                        }`}
                    >
                        <span>
                            {lastResult.label} —{' '}
                            {lastResult.success ? 'success' : 'failed'}
                            {lastResult.timedOut ? ' (timed out)' : ''}
                        </span>
                        <span className="font-mono font-normal opacity-80">
                            {Math.round((lastResult.durationMs || 0) / 1000)}s
                        </span>
                    </div>
                    <pre className="p-4 text-[11px] leading-relaxed font-mono bg-slate-950 text-slate-100 max-h-96 overflow-auto whitespace-pre-wrap">
                        {lastResult.command}
                        {'\n\n'}
                        {lastResult.output || '(no output)'}
                    </pre>
                </div>
            )}
        </div>
    );
};

export default MlmMaintenanceTools;

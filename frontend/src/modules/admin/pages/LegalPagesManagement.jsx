import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import DOMPurify from 'dompurify';
import {
    FileText,
    Plus,
    Save,
    Trash2,
    Eye,
    EyeOff,
    Sparkles,
    Pencil,
    AlertCircle,
    Loader2,
    Search,
    Code2,
    Type,
    Lightbulb,
} from 'lucide-react';
import { adminLegalPagesApi } from '../services/api/legalPagesApi';
import RichTextEditor from '../components/RichTextEditor';

/**
 * Admin Legal Pages Manager
 * -------------------------
 * Per-app (customer / seller / delivery) editor for legal /
 * informational page content. Each page is identified by a
 * (app, slug) pair and surfaced in the corresponding consumer app
 * via /public/legal-pages/:app/:slug.
 *
 * UX:
 *   - Top-level tabs switch between apps.
 *   - Left rail lists every page for the active app, with a search
 *     box and "+ Add page" / "Add default templates" actions.
 *   - Right pane is the editor: title, slug, status, raw HTML body,
 *     plus a sanitised live preview (DOMPurify) so admins see the
 *     actual end-user output before saving.
 */

const APP_TABS = [
    { value: 'customer', label: 'Customer App', accent: 'bg-sky-100 text-sky-700' },
    { value: 'seller', label: 'Seller App', accent: 'bg-indigo-100 text-indigo-700' },
    { value: 'delivery', label: 'Delivery App', accent: 'bg-amber-100 text-amber-700' },
];

const STATUS_BADGE = {
    published: 'bg-emerald-100 text-emerald-700',
    draft: 'bg-slate-200 text-slate-600',
};

const slugify = (s) =>
    String(s || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')
        .slice(0, 80);

const emptyDraft = (app) => ({
    _id: null,
    app,
    slug: '',
    title: '',
    content: '',
    status: 'draft',
    version: 1,
    effectiveAt: null,
    updatedAt: null,
    lastUpdatedBy: null,
});

const LegalPagesManagement = () => {
    const [activeApp, setActiveApp] = useState('customer');
    const [pages, setPages] = useState([]);
    const [loadingList, setLoadingList] = useState(false);
    const [search, setSearch] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [draft, setDraft] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [seeding, setSeeding] = useState(false);
    const [showPreview, setShowPreview] = useState(true);
    // 'visual' = WYSIWYG (Quill), 'html' = raw markup (escape hatch).
    // Default to visual so non-technical admins never see HTML.
    const [editorMode, setEditorMode] = useState('visual');

    /* -------------------- data loading -------------------- */
    const loadPages = async (app) => {
        setLoadingList(true);
        try {
            const res = await adminLegalPagesApi.listLegalPages({
                app,
                limit: 200,
            });
            const result = res?.data?.result;
            const items = Array.isArray(result?.items) ? result.items : [];
            setPages(items);
            return items;
        } catch (err) {
            toast.error(
                err?.response?.data?.message ||
                'Failed to load legal pages',
            );
            return [];
        } finally {
            setLoadingList(false);
        }
    };

    useEffect(() => {
        loadPages(activeApp).then((items) => {
            if (items.length > 0) {
                setSelectedId(items[0]._id);
                setDraft(items[0]);
            } else {
                setSelectedId(null);
                setDraft(null);
            }
            setDirty(false);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeApp]);

    /* -------------------- list filtering -------------------- */
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return pages;
        return pages.filter(
            (p) =>
                p.title?.toLowerCase().includes(q) ||
                p.slug?.toLowerCase().includes(q),
        );
    }, [pages, search]);

    /* -------------------- selection -------------------- */
    const selectPage = (page) => {
        if (dirty) {
            const ok = window.confirm(
                'You have unsaved changes. Discard and switch?',
            );
            if (!ok) return;
        }
        setSelectedId(page._id);
        setDraft(page);
        setDirty(false);
    };

    const startNewPage = () => {
        if (dirty) {
            const ok = window.confirm(
                'You have unsaved changes. Discard and switch?',
            );
            if (!ok) return;
        }
        setSelectedId(null);
        setDraft(emptyDraft(activeApp));
        setDirty(true);
    };

    /* -------------------- mutations -------------------- */
    const updateDraft = (patch) => {
        setDraft((d) => ({ ...(d || emptyDraft(activeApp)), ...patch }));
        setDirty(true);
    };

    const handleSave = async () => {
        if (!draft) return;
        const slug = draft.slug?.trim();
        const title = draft.title?.trim();
        if (!title) return toast.error('Title is required');
        if (!slug) return toast.error('Slug is required');

        setSaving(true);
        try {
            if (!draft._id) {
                const res = await adminLegalPagesApi.createLegalPage({
                    app: activeApp,
                    slug,
                    title,
                    content: draft.content || '',
                    status: draft.status || 'draft',
                });
                const created = res?.data?.result;
                toast.success('Page created');
                const items = await loadPages(activeApp);
                const next = items.find((p) => p._id === created?._id) || created;
                setSelectedId(next?._id || null);
                setDraft(next || null);
                setDirty(false);
            } else {
                const payload = {
                    title,
                    slug,
                    content: draft.content || '',
                    status: draft.status || 'draft',
                };
                const res = await adminLegalPagesApi.updateLegalPage(
                    draft._id,
                    payload,
                );
                const updated = res?.data?.result;
                toast.success('Saved');
                const items = await loadPages(activeApp);
                const next = items.find((p) => p._id === draft._id) || updated;
                setDraft(next || null);
                setDirty(false);
            }
        } catch (err) {
            toast.error(
                err?.response?.data?.message || 'Failed to save the page',
            );
        } finally {
            setSaving(false);
        }
    };

    const togglePublish = async () => {
        if (!draft?._id) {
            toast.error('Save the page first to publish it');
            return;
        }
        const nextStatus =
            draft.status === 'published' ? 'draft' : 'published';
        try {
            await adminLegalPagesApi.updateLegalPage(draft._id, {
                status: nextStatus,
            });
            toast.success(
                nextStatus === 'published' ? 'Page published' : 'Page unpublished',
            );
            const items = await loadPages(activeApp);
            const next = items.find((p) => p._id === draft._id);
            setDraft(next || null);
            setDirty(false);
        } catch (err) {
            toast.error(
                err?.response?.data?.message || 'Failed to update status',
            );
        }
    };

    const handleDelete = async () => {
        if (!draft?._id) return;
        const ok = window.confirm(
            `Delete "${draft.title}"? This cannot be undone.`,
        );
        if (!ok) return;
        try {
            await adminLegalPagesApi.deleteLegalPage(draft._id);
            toast.success('Page deleted');
            const items = await loadPages(activeApp);
            if (items.length > 0) {
                setSelectedId(items[0]._id);
                setDraft(items[0]);
            } else {
                setSelectedId(null);
                setDraft(null);
            }
            setDirty(false);
        } catch (err) {
            toast.error(
                err?.response?.data?.message || 'Failed to delete the page',
            );
        }
    };

    const handleSeedDefaults = async () => {
        setSeeding(true);
        try {
            const res = await adminLegalPagesApi.seedDefaultLegalPages(
                activeApp,
            );
            const created = res?.data?.result?.created ?? 0;
            if (created > 0) {
                toast.success(`Added ${created} default page(s)`);
            } else {
                toast.message('All default pages already exist');
            }
            const items = await loadPages(activeApp);
            if (!selectedId && items.length > 0) {
                setSelectedId(items[0]._id);
                setDraft(items[0]);
            }
        } catch (err) {
            toast.error(
                err?.response?.data?.message || 'Failed to seed defaults',
            );
        } finally {
            setSeeding(false);
        }
    };

    /* -------------------- render -------------------- */
    const sanitisedPreview = useMemo(() => {
        const raw = draft?.content || '';
        if (!raw) return '';
        return DOMPurify.sanitize(raw, {
            ADD_ATTR: ['target', 'rel'],
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
        });
    }, [draft?.content]);

    return (
        <div className="p-6 space-y-5 max-w-[1500px]">
            <header className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-slate-900 flex items-center justify-center text-white">
                        <FileText size={20} />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-900 leading-tight">
                            Legal Pages
                        </h1>
                        <p className="text-xs text-slate-500">
                            Manage privacy policy, terms, about, and other legal
                            content shown inside each app.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleSeedDefaults}
                        disabled={seeding}
                        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                        {seeding ? (
                            <Loader2 size={14} className="animate-spin" />
                        ) : (
                            <Sparkles size={14} />
                        )}
                        Add default templates
                    </button>
                    <button
                        onClick={startNewPage}
                        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        <Plus size={14} /> New page
                    </button>
                </div>
            </header>

            {/* App tabs */}
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
                {APP_TABS.map((t) => (
                    <button
                        key={t.value}
                        onClick={() => setActiveApp(t.value)}
                        className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                            activeApp === t.value
                                ? `${t.accent} ring-1 ring-current/10`
                                : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-5 items-start">
                {/* List rail */}
                <aside className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="px-3 pt-3">
                        <div className="relative">
                            <Search
                                size={14}
                                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                            />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by title or slug…"
                                className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            />
                        </div>
                    </div>
                    <div className="p-2">
                        {loadingList ? (
                            <div className="flex items-center justify-center py-8 text-slate-400 gap-2 text-xs">
                                <Loader2 size={14} className="animate-spin" />
                                Loading…
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="px-3 py-8 text-center text-xs text-slate-400">
                                {pages.length === 0 ? (
                                    <>
                                        No pages yet.<br />
                                        <button
                                            onClick={handleSeedDefaults}
                                            className="mt-2 text-indigo-600 font-semibold hover:underline"
                                        >
                                            Add default templates
                                        </button>
                                    </>
                                ) : (
                                    'No pages match your search.'
                                )}
                            </div>
                        ) : (
                            <ul className="space-y-1">
                                {filtered.map((p) => {
                                    const active = p._id === selectedId;
                                    return (
                                        <li key={p._id}>
                                            <button
                                                onClick={() => selectPage(p)}
                                                className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                                                    active
                                                        ? 'bg-indigo-50 ring-1 ring-indigo-200'
                                                        : 'hover:bg-slate-50'
                                                }`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-slate-800 truncate">
                                                        {p.title || p.slug}
                                                    </span>
                                                    <span
                                                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded shrink-0 ${
                                                            STATUS_BADGE[p.status] ||
                                                            STATUS_BADGE.draft
                                                        }`}
                                                    >
                                                        {p.status}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                                                    /{p.slug}
                                                </p>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>
                </aside>

                {/* Editor */}
                <section className="bg-white border border-slate-200 rounded-xl">
                    {!draft ? (
                        <div className="p-12 text-center text-sm text-slate-500">
                            Select a page on the left or create a new one.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-200">
                            {/* Title bar */}
                            <div className="px-5 py-4 flex items-start justify-between gap-3 flex-wrap">
                                <div className="min-w-0">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                                        {draft._id ? 'Editing' : 'New page'}
                                    </p>
                                    <h2 className="text-lg font-bold text-slate-900 truncate">
                                        {draft.title || '(untitled)'}
                                    </h2>
                                    {draft.lastUpdatedBy?.name && (
                                        <p className="text-[11px] text-slate-500">
                                            Last edit by {draft.lastUpdatedBy.name}
                                            {draft.updatedAt
                                                ? ` · ${new Date(draft.updatedAt).toLocaleString()}`
                                                : ''}
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {draft._id && (
                                        <>
                                            <button
                                                onClick={togglePublish}
                                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ${
                                                    draft.status === 'published'
                                                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                                                }`}
                                            >
                                                {draft.status === 'published' ? (
                                                    <>
                                                        <EyeOff size={14} /> Unpublish
                                                    </>
                                                ) : (
                                                    <>
                                                        <Eye size={14} /> Publish
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={handleDelete}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                                            >
                                                <Trash2 size={14} /> Delete
                                            </button>
                                        </>
                                    )}
                                    <button
                                        onClick={handleSave}
                                        disabled={saving || !dirty}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300"
                                    >
                                        {saving ? (
                                            <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                            <Save size={14} />
                                        )}
                                        {draft._id ? 'Save changes' : 'Create page'}
                                    </button>
                                </div>
                            </div>

                            {/* Meta */}
                            <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        Title
                                    </label>
                                    <input
                                        type="text"
                                        value={draft.title}
                                        onChange={(e) => {
                                            const newTitle = e.target.value;
                                            updateDraft({
                                                title: newTitle,
                                                // Auto-derive slug ONLY when creating a new
                                                // page and the admin hasn't typed a slug yet
                                                slug:
                                                    !draft._id && !draft.slug
                                                        ? slugify(newTitle)
                                                        : draft.slug,
                                            });
                                        }}
                                        placeholder="e.g. Privacy Policy"
                                        className="mt-1 w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        Slug (URL identifier)
                                    </label>
                                    <input
                                        type="text"
                                        value={draft.slug}
                                        onChange={(e) =>
                                            updateDraft({
                                                slug: slugify(e.target.value),
                                            })
                                        }
                                        placeholder="privacy-policy"
                                        className="mt-1 w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-200 font-mono"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Lowercase, kebab-case. Used in the public URL
                                        <span className="font-mono">
                                            {' '}/public/legal-pages/{activeApp}/{draft.slug || '<slug>'}
                                        </span>
                                    </p>
                                </div>
                            </div>

                            {/* Editor + preview */}
                            <div className="px-5 py-4">
                                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                    <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                        Page content
                                    </label>
                                    <div className="flex items-center gap-2">
                                        {/* Visual / HTML mode toggle */}
                                        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
                                            <button
                                                onClick={() => setEditorMode('visual')}
                                                className={`px-3 py-1.5 inline-flex items-center gap-1.5 transition-colors ${
                                                    editorMode === 'visual'
                                                        ? 'bg-indigo-600 text-white'
                                                        : 'bg-white text-slate-600 hover:bg-slate-50'
                                                }`}
                                            >
                                                <Type size={12} /> Visual
                                            </button>
                                            <button
                                                onClick={() => setEditorMode('html')}
                                                className={`px-3 py-1.5 inline-flex items-center gap-1.5 border-l border-slate-200 transition-colors ${
                                                    editorMode === 'html'
                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                        : 'bg-white text-slate-600 hover:bg-slate-50'
                                                }`}
                                                title="Edit raw HTML — for power users"
                                            >
                                                <Code2 size={12} /> HTML
                                            </button>
                                        </div>
                                        <button
                                            onClick={() => setShowPreview((v) => !v)}
                                            className="text-xs font-semibold text-indigo-600 hover:underline"
                                        >
                                            {showPreview ? 'Hide preview' : 'Show preview'}
                                        </button>
                                    </div>
                                </div>

                                {/* Friendly tip — only shown in visual mode for new admins */}
                                {editorMode === 'visual' && (
                                    <p className="mb-2 text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                                        <Lightbulb
                                            size={12}
                                            className="mt-0.5 text-amber-500 shrink-0"
                                        />
                                        Use the toolbar below to add headings, bullet lists,
                                        bold/italic, and links — just like Microsoft Word.
                                        No HTML knowledge required.
                                    </p>
                                )}

                                <div
                                    className={`grid gap-4 ${
                                        showPreview
                                            ? 'grid-cols-1 lg:grid-cols-2'
                                            : 'grid-cols-1'
                                    }`}
                                >
                                    {editorMode === 'visual' ? (
                                        <RichTextEditor
                                            value={draft.content}
                                            onChange={(html) =>
                                                updateDraft({ content: html })
                                            }
                                            placeholder="Start writing your page here…"
                                            minHeight={420}
                                        />
                                    ) : (
                                        <div>
                                            <textarea
                                                value={draft.content}
                                                onChange={(e) =>
                                                    updateDraft({
                                                        content: e.target.value,
                                                    })
                                                }
                                                spellCheck={false}
                                                className="min-h-[480px] w-full px-3 py-2 text-xs font-mono bg-slate-950 text-slate-100 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
                                                placeholder={
                                                    '<h2>Section title</h2>\n<p>Your paragraph...</p>\n<ul>\n  <li>Item one</li>\n  <li>Item two</li>\n</ul>'
                                                }
                                            />
                                            <p className="mt-2 text-[11px] text-amber-700 leading-relaxed flex items-start gap-1.5">
                                                <AlertCircle
                                                    size={12}
                                                    className="mt-0.5 shrink-0"
                                                />
                                                You&apos;re editing raw HTML. Switch back to
                                                <strong className="px-1">Visual</strong>
                                                if you&apos;d rather use the toolbar.
                                            </p>
                                        </div>
                                    )}

                                    {showPreview && (
                                        <div className="min-h-[480px] bg-slate-50 border border-slate-200 rounded-lg p-4 overflow-auto">
                                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                                                Preview (as customers will see it)
                                            </p>
                                            {sanitisedPreview ? (
                                                <article
                                                    className="legal-content"
                                                    // eslint-disable-next-line react/no-danger
                                                    dangerouslySetInnerHTML={{
                                                        __html: sanitisedPreview,
                                                    }}
                                                />
                                            ) : (
                                                <p className="text-xs text-slate-400 italic">
                                                    Start typing on the left and your page
                                                    will appear here exactly as it will look
                                                    inside the app.
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <p className="mt-3 text-[11px] text-slate-500 leading-relaxed flex items-start gap-1.5">
                                    <AlertCircle
                                        size={12}
                                        className="mt-0.5 text-slate-400 shrink-0"
                                    />
                                    The content is sanitised before being shown to end
                                    users — scripts, inline event handlers, &lt;iframe&gt;,
                                    and similar tags are stripped automatically for safety.
                                </p>
                            </div>

                            {/* Footer chips */}
                            <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2 bg-slate-50 rounded-b-xl">
                                <div className="flex items-center gap-2 text-[11px]">
                                    <span className="font-semibold text-slate-500">
                                        Status:
                                    </span>
                                    <span
                                        className={`px-2 py-0.5 rounded font-bold uppercase ${
                                            STATUS_BADGE[draft.status] ||
                                            STATUS_BADGE.draft
                                        }`}
                                    >
                                        {draft.status}
                                    </span>
                                    {draft.version > 1 && (
                                        <>
                                            <span className="text-slate-300">·</span>
                                            <span className="text-slate-500">
                                                v{draft.version}
                                            </span>
                                        </>
                                    )}
                                </div>
                                {dirty && (
                                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
                                        <Pencil size={12} /> Unsaved changes
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default LegalPagesManagement;

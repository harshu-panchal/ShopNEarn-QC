import React, { useMemo } from "react";
import DOMPurify from "dompurify";
import { ChevronLeft, ScrollText, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLegalPage } from "@core/hooks/useLegalPage";

/**
 * Generic renderer for admin-edited legal / informational pages.
 *
 * Accepts a target `app` + `slug` and:
 *   1. Fetches the published version via `useLegalPage`.
 *   2. Sanitises the HTML with DOMPurify before injecting it.
 *   3. Falls back to `fallbackTitle` + `fallbackContent` (a React node)
 *      when the admin hasn't published a page yet, so legacy hardcoded
 *      copies stay visible during the rollout window.
 *
 * Long-form HTML readability is handled by Tailwind's prose utilities;
 * the wrapper applies `prose prose-slate prose-sm max-w-none` so the
 * sanitised body inherits sensible spacing without extra styling work.
 *
 * @param {object} props
 * @param {"customer"|"seller"|"delivery"} props.app
 * @param {string} props.slug
 * @param {string} [props.fallbackTitle]
 * @param {React.ReactNode} [props.fallbackContent]
 * @param {React.ReactNode} [props.headerIcon]
 */
const LegalPageView = ({
    app,
    slug,
    fallbackTitle,
    fallbackContent = null,
    headerIcon = null,
}) => {
    const navigate = useNavigate();
    const { page, loading } = useLegalPage({ app, slug });

    const sanitisedHtml = useMemo(() => {
        if (!page?.content) return "";
        return DOMPurify.sanitize(page.content, {
            // Allow target="_blank" on links + class attribute so admins can
            // paste rich content from Google Docs / Notion. Forbid any
            // <script> / on*= handlers automatically (DOMPurify default).
            ADD_ATTR: ["target", "rel"],
            FORBID_TAGS: ["style", "script", "iframe", "object", "embed"],
        });
    }, [page?.content]);

    const title = page?.title || fallbackTitle || "Information";

    const lastUpdated = useMemo(() => {
        const ts = page?.effectiveAt || page?.updatedAt;
        if (!ts) return null;
        try {
            return new Date(ts).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
            });
        } catch {
            return null;
        }
    }, [page?.effectiveAt, page?.updatedAt]);

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-10">
            {/* Header */}
            <div className="bg-white sticky top-0 z-30 px-4 py-3 flex items-center gap-1 shadow-sm">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                    aria-label="Go back"
                >
                    <ChevronLeft size={24} className="text-slate-600" />
                </button>
                <h1 className="text-lg font-black text-slate-800">{title}</h1>
            </div>

            <div className="p-5 max-w-3xl mx-auto space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-700">
                            {headerIcon || <ScrollText size={24} />}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h2 className="text-xl font-bold text-slate-800 truncate">
                                {title}
                            </h2>
                            {lastUpdated ? (
                                <p className="text-xs text-slate-500 font-medium">
                                    Last updated: {lastUpdated}
                                </p>
                            ) : null}
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
                            <Loader2 size={18} className="animate-spin" />
                            <span className="text-sm font-medium">Loading…</span>
                        </div>
                    ) : sanitisedHtml ? (
                        <div
                            className="legal-content"
                            // eslint-disable-next-line react/no-danger
                            dangerouslySetInnerHTML={{ __html: sanitisedHtml }}
                        />
                    ) : (
                        <div className="legal-content space-y-4">
                            {fallbackContent || (
                                <p className="text-slate-500 italic">
                                    This page hasn&apos;t been published yet. Please check back soon.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default LegalPageView;

import mongoose from "mongoose";

/**
 * LegalPage — admin-editable content for legal / informational pages
 * surfaced inside the customer, seller, and delivery apps. The same
 * row can be referenced from any app via the `(app, slug)` pair.
 *
 * Examples of `slug` values: "privacy-policy", "terms-of-service",
 * "about", "refund-policy", "shipping-policy", "cancellation-policy",
 * "contact-us". Slugs are NOT enumerated server-side so admins can
 * mint new pages without a code change.
 *
 * `content` is HTML and is rendered on the client via DOMPurify
 * before being injected via dangerouslySetInnerHTML — see
 * `frontend/src/core/components/LegalPageView.jsx`.
 *
 * Updates increment `version` and stamp `effectiveAt` so the public
 * renderer can show "Last updated" next to the title.
 */

export const LEGAL_PAGE_APPS = Object.freeze(["customer", "seller", "delivery"]);
export const LEGAL_PAGE_STATUSES = Object.freeze(["published", "draft"]);

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const legalPageSchema = new mongoose.Schema(
    {
        app: {
            type: String,
            enum: LEGAL_PAGE_APPS,
            required: true,
            index: true,
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            validate: {
                validator: (v) => SLUG_REGEX.test(v),
                message:
                    "slug must be lowercase kebab-case (a-z, 0-9, hyphens only)",
            },
        },
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
        },
        // Free-form HTML body. Sanitized on the client at render time
        // (DOMPurify). Allow up to 200 KB so a long policy with images
        // / inlined SVG fits without surprises.
        content: {
            type: String,
            default: "",
            maxlength: 200_000,
        },
        status: {
            type: String,
            enum: LEGAL_PAGE_STATUSES,
            default: "draft",
        },
        // Bumped on every successful save so clients can cache by it.
        version: {
            type: Number,
            default: 1,
        },
        // Wall-clock "last updated" stamp shown in the page header.
        // Defaults to row creation; refreshed on every content edit.
        effectiveAt: {
            type: Date,
            default: () => new Date(),
        },
        lastUpdatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
    },
    {
        timestamps: true,
    },
);

// Each (app, slug) pair is unique — exactly one privacy-policy
// per app at a time. Admins update in place; deletes are explicit.
legalPageSchema.index({ app: 1, slug: 1 }, { unique: true });
// Public reads filter on app + status; this index covers them.
legalPageSchema.index({ app: 1, status: 1 });

const LegalPage = mongoose.model("LegalPage", legalPageSchema);

export default LegalPage;

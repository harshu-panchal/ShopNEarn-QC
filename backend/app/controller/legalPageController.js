import LegalPage, { LEGAL_PAGE_APPS } from "../models/legalPage.js";
import { handleResponse } from "../utils/helper.js";
import { buildSearchRegex } from "../utils/regex.js";
import {
    createLegalPageSchema,
    listLegalPagesSchema,
    updateLegalPageSchema,
    validateSchema,
} from "../validation/legalPageValidation.js";

/**
 * Default page templates surfaced as "starters" in the admin UI when
 * an admin clicks "Add default pages". Adding more entries here is
 * the only place admins ever need a code change for new slugs — the
 * actual model permits any kebab-case slug.
 */
export const DEFAULT_LEGAL_PAGE_TEMPLATES = Object.freeze([
    {
        slug: "privacy-policy",
        title: "Privacy Policy",
        content: `
<h2>Privacy Policy</h2>
<p>This Privacy Policy explains how we collect, use, and protect your personal information when you use our services.</p>
<h3>1. Information We Collect</h3>
<p>We collect information you provide directly — such as your name, address, phone number, and payment details — and usage data automatically.</p>
<h3>2. How We Use Information</h3>
<p>We use your data to process orders, improve our services, and communicate with you about promotions and updates.</p>
<h3>3. Data Security</h3>
<p>We implement industry-standard security measures to protect your data. However, no method of transmission is 100% secure.</p>
<h3>4. Sharing of Information</h3>
<p>We do not sell your personal data. We may share data with service providers (e.g. delivery partners) as necessary to fulfil your orders.</p>
<h3>5. Your Rights</h3>
<p>You have the right to access, correct, or delete your personal data. Contact our support team for assistance.</p>
`.trim(),
    },
    {
        slug: "terms-of-service",
        title: "Terms & Conditions",
        content: `
<h2>Terms &amp; Conditions</h2>
<p>By accessing or using our application and services, you agree to be bound by these Terms.</p>
<h3>1. Acceptance of Terms</h3>
<p>By creating an account or using our services, you agree to comply with these terms. If you do not agree, you may not use our services.</p>
<h3>2. Use of Service</h3>
<p>You must be at least 18 years old to use our services. You agree to provide accurate information during registration and to keep your account secure.</p>
<h3>3. Orders and Payments</h3>
<p>All orders are subject to availability. Prices may change without notice. We reserve the right to cancel orders at our discretion.</p>
<h3>4. Intellectual Property</h3>
<p>All content, trademarks, and data on this app are our property and are protected by law.</p>
<h3>5. Termination</h3>
<p>We reserve the right to end or suspend your account at any time for violation of these terms.</p>
`.trim(),
    },
    {
        slug: "about",
        title: "About Us",
        content: `
<h2>About Us</h2>
<p>Tell your customers who you are, what you do, and what you stand for.</p>
<h3>Our mission</h3>
<p>Briefly describe the problem you solve and the value you bring.</p>
<h3>What we do</h3>
<ul>
  <li>Highlight one</li>
  <li>Highlight two</li>
  <li>Highlight three</li>
</ul>
<h3>Our values</h3>
<ul>
  <li><strong>Customer first.</strong> Your satisfaction is our top priority.</li>
  <li><strong>Quality.</strong> We deliver only the freshest and best products.</li>
  <li><strong>Speed with safety.</strong> Fast delivery without compromising on standards.</li>
</ul>
`.trim(),
    },
    {
        slug: "refund-policy",
        title: "Refund & Cancellation Policy",
        content: `
<h2>Refund &amp; Cancellation Policy</h2>
<p>Outline how refunds and cancellations are handled — eligibility windows, the process, and the channel customers should use.</p>
<h3>Cancellation</h3>
<p>Orders can be cancelled before they are dispatched. Once shipped, please follow the return flow.</p>
<h3>Refunds</h3>
<ul>
  <li>Refunds are processed to the original payment method within 5–7 business days.</li>
  <li>Wallet credits are reversed immediately.</li>
</ul>
<h3>Need help?</h3>
<p>Reach out to our support team for any refund-related queries.</p>
`.trim(),
    },
    {
        slug: "shipping-policy",
        title: "Shipping & Delivery Policy",
        content: `
<h2>Shipping &amp; Delivery Policy</h2>
<p>Describe your delivery zones, expected timelines, and any charges that apply.</p>
<h3>Delivery zones</h3>
<p>Currently we deliver to selected cities. Enter your pin code at checkout to confirm availability.</p>
<h3>Timelines</h3>
<ul>
  <li>Express (within 30 minutes) for select categories.</li>
  <li>Standard same-day for orders placed before 6 PM.</li>
</ul>
<h3>Charges</h3>
<p>Delivery fees are calculated based on distance and order value. The exact amount is shown at checkout.</p>
`.trim(),
    },
    {
        slug: "contact-us",
        title: "Contact Us",
        content: `
<h2>Get in touch</h2>
<p>We're here to help. Reach out to us through any of the channels below.</p>
<ul>
  <li><strong>Email:</strong> support@example.com</li>
  <li><strong>Phone:</strong> +91 00000 00000</li>
  <li><strong>Address:</strong> Your business address</li>
</ul>
<p>Our customer support team is available Monday–Saturday, 9 AM to 9 PM.</p>
`.trim(),
    },
]);

/* ===========================================================
   ADMIN endpoints
   =========================================================== */

export const listAdminLegalPages = async (req, res) => {
    try {
        const params = validateSchema(listLegalPagesSchema, req.query || {});
        const filter = {};
        if (params.app) filter.app = params.app;
        if (params.status) filter.status = params.status;
        if (params.search && params.search.trim()) {
            const safe = buildSearchRegex(params.search.trim(), {
                anchored: false,
            });
            filter.$or = [{ title: safe }, { slug: safe }];
        }

        const skip = (params.page - 1) * params.limit;
        const [items, total] = await Promise.all([
            LegalPage.find(filter)
                .sort({ app: 1, slug: 1 })
                .skip(skip)
                .limit(params.limit)
                .populate("lastUpdatedBy", "name email")
                .lean(),
            LegalPage.countDocuments(filter),
        ]);

        return handleResponse(res, 200, "Legal pages fetched", {
            items,
            page: params.page,
            limit: params.limit,
            total,
            totalPages: Math.ceil(total / params.limit) || 1,
        });
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message || "Failed to fetch legal pages",
        );
    }
};

export const getAdminLegalPageById = async (req, res) => {
    try {
        const page = await LegalPage.findById(req.params.id)
            .populate("lastUpdatedBy", "name email")
            .lean();
        if (!page) return handleResponse(res, 404, "Legal page not found");
        return handleResponse(res, 200, "Legal page fetched", page);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

export const createLegalPage = async (req, res) => {
    try {
        const payload = validateSchema(createLegalPageSchema, req.body || {});

        const existing = await LegalPage.findOne({
            app: payload.app,
            slug: payload.slug,
        }).lean();
        if (existing) {
            return handleResponse(
                res,
                409,
                `A '${payload.slug}' page already exists for the ${payload.app} app.`,
            );
        }

        const page = await LegalPage.create({
            ...payload,
            effectiveAt: new Date(),
            lastUpdatedBy: req.user?.id || null,
            version: 1,
        });

        return handleResponse(res, 201, "Legal page created", page);
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message || "Failed to create legal page",
        );
    }
};

export const updateLegalPage = async (req, res) => {
    try {
        const payload = validateSchema(updateLegalPageSchema, req.body || {});

        const page = await LegalPage.findById(req.params.id);
        if (!page) return handleResponse(res, 404, "Legal page not found");

        // If the slug is changing we have to defend the unique index by
        // hand because Mongo won't surface a friendly conflict message.
        if (payload.slug && payload.slug !== page.slug) {
            const conflict = await LegalPage.findOne({
                app: page.app,
                slug: payload.slug,
                _id: { $ne: page._id },
            }).lean();
            if (conflict) {
                return handleResponse(
                    res,
                    409,
                    `Another page with slug '${payload.slug}' already exists for the ${page.app} app.`,
                );
            }
        }

        const contentChanged =
            typeof payload.content === "string" && payload.content !== page.content;
        const titleChanged =
            typeof payload.title === "string" && payload.title !== page.title;

        Object.assign(page, payload);
        if (contentChanged || titleChanged) {
            page.version = (page.version || 1) + 1;
            page.effectiveAt = new Date();
        }
        page.lastUpdatedBy = req.user?.id || page.lastUpdatedBy;

        await page.save();

        return handleResponse(res, 200, "Legal page updated", page);
    } catch (error) {
        return handleResponse(
            res,
            error.statusCode || 500,
            error.message || "Failed to update legal page",
        );
    }
};

export const deleteLegalPage = async (req, res) => {
    try {
        const removed = await LegalPage.findByIdAndDelete(req.params.id);
        if (!removed) return handleResponse(res, 404, "Legal page not found");
        return handleResponse(res, 200, "Legal page deleted");
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/**
 * POST /admin/legal-pages/seed-defaults
 * body: { app: "customer" | "seller" | "delivery" }
 *
 * Idempotently inserts every default template that is missing for the
 * given app. Existing rows are NEVER overwritten — admins run this to
 * spin up a fresh app surface, not to revert their edits.
 */
export const seedDefaultLegalPages = async (req, res) => {
    try {
        const app = String(req.body?.app || "").trim();
        if (!LEGAL_PAGE_APPS.includes(app)) {
            return handleResponse(
                res,
                400,
                `app must be one of: ${LEGAL_PAGE_APPS.join(", ")}`,
            );
        }

        const existing = await LegalPage.find({ app }).select("slug").lean();
        const existingSlugs = new Set(existing.map((p) => p.slug));
        const toInsert = DEFAULT_LEGAL_PAGE_TEMPLATES.filter(
            (tpl) => !existingSlugs.has(tpl.slug),
        ).map((tpl) => ({
            app,
            slug: tpl.slug,
            title: tpl.title,
            content: tpl.content,
            status: "draft",
            version: 1,
            effectiveAt: new Date(),
            lastUpdatedBy: req.user?.id || null,
        }));

        if (toInsert.length === 0) {
            return handleResponse(res, 200, "All default pages already exist", {
                created: 0,
            });
        }

        await LegalPage.insertMany(toInsert);
        return handleResponse(
            res,
            201,
            `${toInsert.length} default page(s) created`,
            { created: toInsert.length },
        );
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===========================================================
   PUBLIC endpoints
   =========================================================== */

/**
 * GET /public/legal-pages/:app
 * Returns *published* pages for the given app, slim payload — used
 * to render an index ("All policies") screen if any app needs one.
 */
export const listPublicLegalPages = async (req, res) => {
    try {
        const app = String(req.params.app || "").trim();
        if (!LEGAL_PAGE_APPS.includes(app)) {
            return handleResponse(
                res,
                400,
                `app must be one of: ${LEGAL_PAGE_APPS.join(", ")}`,
            );
        }
        const items = await LegalPage.find({ app, status: "published" })
            .select("app slug title version effectiveAt updatedAt")
            .sort({ slug: 1 })
            .lean();
        return handleResponse(res, 200, "Pages fetched", { items });
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/**
 * GET /public/legal-pages/:app/:slug
 * Returns a single published page (or 404 if it's a draft / missing).
 */
export const getPublicLegalPage = async (req, res) => {
    try {
        const app = String(req.params.app || "").trim();
        const slug = String(req.params.slug || "").trim().toLowerCase();
        if (!LEGAL_PAGE_APPS.includes(app)) {
            return handleResponse(
                res,
                400,
                `app must be one of: ${LEGAL_PAGE_APPS.join(", ")}`,
            );
        }
        const page = await LegalPage.findOne({
            app,
            slug,
            status: "published",
        })
            .select("app slug title content version effectiveAt updatedAt")
            .lean();
        if (!page) return handleResponse(res, 404, "Page not found");
        return handleResponse(res, 200, "Page fetched", page);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

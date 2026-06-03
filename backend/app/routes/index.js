import customerRoute from "./customerAuth.js";
import deliveryRoute from "./deliveryAuth.js";
import adminRoute from "./adminAuth.js";
import sellerRoute from "./sellerAuth.js";
import categoryRoute from "./categoryRoutes.js";
import productRoute from "./productRoutes.js";
import cartRoute from "./cartRoutes.js";
import wishlistRoute from "./wishlistRoutes.js";
import orderRoute from "./orderRoutes.js";
import paymentRoute from "./paymentRoutes.js";
import notificationRoute from "./notificationRoutes.js";
import pushRoute from "./pushRoutes.js";
import ticketRoute from "./ticketRoutes.js";
import reviewRoute from "./reviewRoutes.js";
import faqRoute from "./faqRoutes.js";
import {
    legalPageAdminRouter,
    legalPagePublicRouter,
} from "./legalPageRoutes.js";
import experienceRoute from "./experienceRoutes.js";
import offerRoute from "./offerRoutes.js";
import couponRoute from "./couponRoutes.js";
import settingsRoute from "./settingsRoutes.js";
import mapsRoute from "./mapsRoutes.js";
import mediaRoute from "./mediaRoutes.js";
import healthRoute from "./healthRoutes.js";
import metricsRoute from "./metricsRoutes.js";
import authOtpRoute from "../modules/otp/otp.routes.js";
import mlmCustomerRoute from "./mlmCustomerRoutes.js";
import mlmAdminRoute from "./mlmAdminRoutes.js";

import express from "express";

const setupRoutes = (app) => {
    const router = express.Router();

    // Health and metrics endpoints (no /api prefix for standard paths)
    app.use("/health", healthRoute);
    app.use("/metrics", metricsRoute);

    // MLM customer endpoints (membership, referral, earnings, withdrawals).
    // Mounted BEFORE "/customer" so /api/customer/mlm/* hits the MLM router
    // even though customerRoute itself only declares non-MLM paths.
    router.use("/customer/mlm", mlmCustomerRoute);
    router.use("/customer", customerRoute);
    router.use("/delivery", deliveryRoute);
    // categoryRoute is mounted twice on purpose:
    //   /admin/categories → admin category management (auth enforced inside the router)
    //   /categories       → public category browsing (read-only handlers)
    // Same router, two URL surfaces. Do not deduplicate without coordinated frontend changes.
    router.use("/admin/categories", categoryRoute);
    // MLM admin endpoints — mounted before "/admin" so /api/admin/mlm/*
    // hits the dedicated MLM admin router.
    router.use("/admin/mlm", mlmAdminRoute);
    router.use("/admin", adminRoute);
    router.use("/seller", sellerRoute);
    router.use("/settings", settingsRoute);
    router.use("/categories", categoryRoute);
    router.use("/products", productRoute);
    router.use("/cart", cartRoute);
    router.use("/wishlist", wishlistRoute);
    router.use("/orders", orderRoute);
    router.use("/payments", paymentRoute);
    router.use("/maps", mapsRoute);
    router.use("/media", mediaRoute);
    // experienceRoute, offerRoute, couponRoute are mounted at "/" intentionally:
    // each of these routers declares ABSOLUTE paths internally (e.g.
    //   router.get("/experience", ...), router.get("/offers", ...),
    //   router.get("/admin-offers", ...), router.get("/admin/coupons", ...))
    // Mounting them under an explicit prefix would double the path
    // ("/offers/offers", etc.) and break every existing frontend caller.
    // The right cleanup is to rewrite each router to use a relative prefix
    // and update the frontend in the same PR. Until then, keep the "/" mount.
    router.use("/", experienceRoute);
    router.use("/", offerRoute);
    router.use("/", couponRoute);
    router.use("/notifications", notificationRoute);
    router.use("/auth/otp", authOtpRoute);
    router.use("/push", pushRoute);
    router.use("/tickets", ticketRoute);
    router.use("/reviews", reviewRoute);
    router.use("/admin/faqs", faqRoute);
    router.use("/public/faqs", faqRoute); // For public access without admin prefix

    // Legal / informational pages — admin-editable content surfaced
    // by the customer, seller, and delivery apps.
    router.use("/admin/legal-pages", legalPageAdminRouter);
    router.use("/public/legal-pages", legalPagePublicRouter);

    app.use("/api", router);
}
export default setupRoutes;

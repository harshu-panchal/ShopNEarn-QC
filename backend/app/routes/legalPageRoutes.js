import express from "express";
import {
    createLegalPage,
    deleteLegalPage,
    getAdminLegalPageById,
    getPublicLegalPage,
    listAdminLegalPages,
    listPublicLegalPages,
    seedDefaultLegalPages,
    updateLegalPage,
} from "../controller/legalPageController.js";
import { adminPermissionGuard } from "../middleware/authMiddleware.js";

const router = express.Router();

/* Admin (mounted at /admin/legal-pages) */
export const legalPageAdminRouter = express.Router();
legalPageAdminRouter.get("/", ...adminPermissionGuard("content:view"), listAdminLegalPages);
legalPageAdminRouter.post("/", ...adminPermissionGuard("content:create"), createLegalPage);
legalPageAdminRouter.post(
    "/seed-defaults",
    ...adminPermissionGuard("content:create"),
    seedDefaultLegalPages,
);
legalPageAdminRouter.get("/:id", ...adminPermissionGuard("content:view"), getAdminLegalPageById);
legalPageAdminRouter.put("/:id", ...adminPermissionGuard("content:update"), updateLegalPage);
legalPageAdminRouter.delete("/:id", ...adminPermissionGuard("content:delete"), deleteLegalPage);

/* Public (mounted at /public/legal-pages) */
export const legalPagePublicRouter = express.Router();
legalPagePublicRouter.get("/:app", listPublicLegalPages);
legalPagePublicRouter.get("/:app/:slug", getPublicLegalPage);

export default router;

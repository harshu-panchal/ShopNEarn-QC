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
import { allowRoles, verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();
const adminGuard = [verifyToken, allowRoles("admin")];

/* Admin (mounted at /admin/legal-pages) */
export const legalPageAdminRouter = express.Router();
legalPageAdminRouter.get("/", ...adminGuard, listAdminLegalPages);
legalPageAdminRouter.post("/", ...adminGuard, createLegalPage);
legalPageAdminRouter.post(
    "/seed-defaults",
    ...adminGuard,
    seedDefaultLegalPages,
);
legalPageAdminRouter.get("/:id", ...adminGuard, getAdminLegalPageById);
legalPageAdminRouter.put("/:id", ...adminGuard, updateLegalPage);
legalPageAdminRouter.delete("/:id", ...adminGuard, deleteLegalPage);

/* Public (mounted at /public/legal-pages) */
export const legalPagePublicRouter = express.Router();
legalPagePublicRouter.get("/:app", listPublicLegalPages);
legalPagePublicRouter.get("/:app/:slug", getPublicLegalPage);

export default router;

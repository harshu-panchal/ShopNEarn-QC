import express from "express";
import {
    createTicket,
    getMyTickets,
    getAllTickets,
    replyToTicket,
    updateTicketStatus
} from "../controller/ticketController.js";
import {
    verifyToken,
    adminPermissionGuard,
    requireAdminPermissionIfAdmin,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Mixed/Shared routes (Need login)
router.post("/create", verifyToken, createTicket);
router.get("/my-tickets", verifyToken, getMyTickets);
router.post(
    "/reply/:id",
    verifyToken,
    requireAdminPermissionIfAdmin("support:reply"),
    replyToTicket,
);

// Admin only routes
router.get("/admin/all", ...adminPermissionGuard("support:view"), getAllTickets);
router.patch("/admin/status/:id", ...adminPermissionGuard("support:update"), updateTicketStatus);

export default router;

import handleResponse from "../utils/helper.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";
import {
    createLowStockAlertCandidate,
    isLowStockAlertsEnabled,
} from "../services/lowStockAlertService.js";
import {
    adjustHubProductStock,
    getHubInventorySummary,
    listHubStockMovements,
} from "../services/inventory/hubInventoryService.js";
import { HUB_STOCK_TYPES } from "../constants/inventory.js";

/* ===============================
   ADJUST STOCK MANUALLY
================================ */
export const adjustStock = async (req, res) => {
    try {
        const { productId, type, quantity, note, variantSku } = req.body;
        const sellerId = req.user.id;

        const normalizedType = String(type || "").trim();
        const allowed = [
            HUB_STOCK_TYPES.RESTOCK,
            HUB_STOCK_TYPES.CORRECTION,
            HUB_STOCK_TYPES.DAMAGE,
        ];
        if (!allowed.includes(normalizedType)) {
            return handleResponse(res, 400, `Invalid type. Allowed: ${allowed.join(", ")}`);
        }

        const result = await adjustHubProductStock({
            sellerId,
            productId,
            type: normalizedType,
            quantity,
            note,
            variantSku: variantSku || null,
        });

        if (
            normalizedType !== HUB_STOCK_TYPES.RESTOCK &&
            Number(quantity) > 0 &&
            await isLowStockAlertsEnabled()
        ) {
            const product = { stock: result.newStock, lowStockAlert: 5 };
            const lowStockAlert = createLowStockAlertCandidate({
                product,
                previousStock: result.previousStock,
                currentStock: result.newStock,
            });
            if (lowStockAlert) {
                emitNotificationEvent(NOTIFICATION_EVENTS.LOW_STOCK_ALERT, lowStockAlert);
            }
        }

        return handleResponse(res, 200, "Stock adjusted successfully", {
            newStock: result.newStock,
            historyEntry: result.historyEntry,
        });
    } catch (error) {
        return handleResponse(res, error.statusCode || 500, error.message);
    }
};

/* ===============================
   GET STOCK HISTORY LOG
================================ */
export const getStockHistory = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const result = await listHubStockMovements(sellerId, {
            page: req.query.page,
            limit: req.query.limit,
            type: req.query.type,
            direction: req.query.direction,
            productId: req.query.productId,
            startDate: req.query.startDate,
            endDate: req.query.endDate,
        });

        return handleResponse(res, 200, "Stock history fetched", result);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

/* ===============================
   INVENTORY SUMMARY
================================ */
export const getInventorySummary = async (req, res) => {
    try {
        const sellerId = req.user.id;
        const summary = await getHubInventorySummary(sellerId);
        return handleResponse(res, 200, "Inventory summary fetched", summary);
    } catch (error) {
        return handleResponse(res, 500, error.message);
    }
};

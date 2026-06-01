/**
 * Notification domain barrel. See `app/domains/README.md`.
 *
 * The notification module already lives self-contained under
 * `app/modules/notifications/`. This barrel gives it a home under
 * `domains/` so cross-domain imports follow a consistent path.
 */
export * as notificationController from "./notification.controller.js";
export * from "./notification.service.js";
export { default as notificationRoutes } from "./notification.routes.js";

/**
 * Aggregate barrel for the notification module.
 *
 * The module is already self-contained (constants, emitter, service, queue,
 * worker, builder, model). This barrel exposes it under `domains/`:
 *
 *   import {
 *     emitNotificationEvent,
 *     NOTIFICATION_EVENTS,
 *   } from "@/domains/notification";
 */
export * from "../../modules/notifications/notification.service.js";
export * from "../../modules/notifications/notification.emitter.js";
export * from "../../modules/notifications/notification.constants.js";
export * from "../../modules/notifications/notification.builder.js";
export * from "../../modules/notifications/notification.queue.js";

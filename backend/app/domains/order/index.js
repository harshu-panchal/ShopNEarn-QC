/**
 * Order domain barrel.
 *
 * Prefer importing this in new code:
 *
 *   import { OrderReturnService, requestReturnSchema } from "@/domains/order";
 *
 * Existing imports from `controller/orderController.js`,
 * `services/orderQueryService.js`, `validation/orderValidation.js`, and
 * `routes/orderRoutes.js` continue to work unchanged via shims.
 */
export * as orderController from "./order.controller.js";
export * from "./order.service.js";
export * as orderValidation from "./order.validation.js";
export { default as orderRoutes } from "./order.routes.js";

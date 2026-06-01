/**
 * Aggregate barrel for order-domain services.
 *
 * Each sub-service has been extracted from `app/controller/orderController.js`
 * over the course of refactor Phase 2. They live alongside one another
 * under `app/services/` and `app/services/order/` for now and are re-
 * exported here so callers inside `app/domains/order/` can fetch them via
 * a single import.
 */
export {
  OrderReturnService,
  default as orderReturnService,
} from "../../services/order/orderReturnService.js";

export * from "../../services/orderQueryService.js";
export * from "../../services/orderWorkflowService.js";

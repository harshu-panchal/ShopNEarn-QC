/**
 * Product domain barrel. See `app/domains/README.md`.
 *
 * Prefer importing this in new code:
 *
 *   import { productController, createProductSchema } from "@/domains/product";
 *
 * Existing imports from `controller/productController.js`,
 * `validation/productValidation.js`, and `routes/productRoutes.js` continue
 * to work unchanged via shims.
 */
export * as productController from "./product.controller.js";
export * from "./product.service.js";
export * as productValidation from "./product.validation.js";
export { default as productRoutes } from "./product.routes.js";

/**
 * OTP domain barrel. See `app/domains/README.md`.
 *
 * Like notifications, the OTP module already lives self-contained under
 * `app/modules/otp/`. This barrel exposes it under `domains/`.
 */
export * as otpController from "./otp.controller.js";
export * from "./otp.service.js";
export { default as otpRoutes } from "./otp.routes.js";

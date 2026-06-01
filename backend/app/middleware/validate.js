/**
 * Shared Joi request-validation utilities.
 *
 * Exposes two complementary entry points so that:
 *   1. New code can use `validate(schema)` as Express middleware on routes.
 *   2. Existing controllers that historically did inline validation via a
 *      local `validateWithJoi(schema, payload)` helper can switch to
 *      `validateBody(schema, payload)` with a one-line import change.
 *
 * Both share the same Joi options (`abortEarly: false`, `stripUnknown: true`)
 * and the same error contract so behaviour is identical to the previous
 * per-controller copies.
 */

const JOI_OPTIONS = Object.freeze({
  abortEarly: false,
  stripUnknown: true,
});

function joinJoiMessages(error) {
  return error.details.map((detail) => detail.message).join("; ");
}

const ALLOWED_SOURCES = new Set(["body", "query", "params", "headers"]);

/**
 * Express middleware factory. Validates a request input source against the
 * supplied Joi schema, replaces the source with the sanitized value on
 * success, and responds 400 with a uniform error envelope on failure.
 *
 *   router.post("/orders",    validate(createOrderSchema),               placeOrder);
 *   router.get ("/orders",    validate(listOrdersSchema,    "query"),    listOrders);
 *   router.delete("/orders/:id", validate(orderParamsSchema, "params"),  cancelOrder);
 *
 * The `source` parameter is optional and defaults to `"body"`, so every
 * existing `validate(schema)` call site continues to behave identically.
 * Added in Phase 1 (audit-plan ticket P1-4) so route files can validate
 * URL params and query strings without falling back to inline checks.
 *
 * @param {import('joi').Schema} schema
 * @param {"body"|"query"|"params"|"headers"} [source="body"]
 */
export function validate(schema, source = "body") {
  if (!ALLOWED_SOURCES.has(source)) {
    throw new Error(
      `validate(): unsupported source "${source}". Expected one of: ${[...ALLOWED_SOURCES].join(", ")}.`,
    );
  }
  return (req, res, next) => {
    // `convert: true` only when validating non-body sources, where values
    // arrive as strings (e.g. "?page=2") and the schema expects numbers.
    // Keep body validation strict to preserve existing behavior.
    const options =
      source === "body" ? JOI_OPTIONS : { ...JOI_OPTIONS, convert: true };
    const { error, value } = schema.validate(req[source], options);
    if (error) {
      return res.status(400).json({
        success: false,
        error: true,
        message: joinJoiMessages(error),
      });
    }
    // Mutating req.query / req.params is supported by Express and matches
    // the pre-existing req.body pattern; downstream handlers see the
    // sanitized value transparently.
    req[source] = value;
    return next();
  };
}

/**
 * Imperative validator for controllers that need to validate a payload that
 * is NOT `req.body` (for example `req.query` or a hand-assembled object), or
 * that have to run additional logic between validation and the response.
 *
 * On failure it throws an Error with `statusCode = 400` so the controller's
 * existing try/catch + `handleResponse(res, error.statusCode || 500, ...)`
 * pattern keeps producing the same HTTP response.
 *
 * @param {import('joi').Schema} schema
 * @param {*} payload
 * @returns {*} the sanitized value
 */
export function validateBody(schema, payload) {
  const { error, value } = schema.validate(payload, JOI_OPTIONS);
  if (error) {
    const err = new Error(joinJoiMessages(error));
    err.statusCode = 400;
    throw err;
  }
  return value;
}

/**
 * Non-throwing variant. Returns a result object so the caller can decide how
 * to respond. Used by controllers that prefer the `{ isValid, value, message }`
 * pattern over try/catch.
 *
 * @param {import('joi').Schema} schema
 * @param {*} payload
 * @returns {{ isValid: boolean, value?: *, message?: string }}
 */
export function validateBodySafe(schema, payload) {
  const { error, value } = schema.validate(payload, JOI_OPTIONS);
  if (error) {
    return {
      isValid: false,
      message: joinJoiMessages(error),
    };
  }
  return { isValid: true, value };
}

export default validate;

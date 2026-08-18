import MlmJoiningPlan from "../../models/mlmJoiningPlan.js";

function makeError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

/** Active joining plans, in the order they should appear on the picker. */
export async function listActiveJoiningPlans({ session } = {}) {
  return MlmJoiningPlan.find({ active: true }, null, { session })
    .sort({ sortOrder: 1, price: 1 })
    .lean();
}

/** Fetch one joining plan by id. Throws 404 if missing or soft-deleted. */
export async function getJoiningPlanById(id, { session } = {}) {
  if (!id) return null;
  const plan = await MlmJoiningPlan.findById(id, null, { session }).lean();
  if (!plan) {
    throw makeError("Joining plan not found.", 404, "JOINING_PLAN_NOT_FOUND");
  }
  return plan;
}

/**
 * Lowest-sortOrder active plan — used as the default when a caller
 * (an unmigrated client, or an admin action that doesn't specify one)
 * omits `joiningPlanId`. Never throws; returns null if no active plan
 * exists at all (callers fall back to the legacy global config).
 */
export async function getDefaultJoiningPlan({ session } = {}) {
  const plans = await MlmJoiningPlan.find({ active: true }, null, { session })
    .sort({ sortOrder: 1, price: 1 })
    .limit(1)
    .lean();
  return plans[0] || null;
}

/** Would deactivating/deleting `excludeId` leave zero active plans? */
export async function wouldLeaveNoActivePlans(excludeId) {
  const remaining = await MlmJoiningPlan.countDocuments({
    active: true,
    _id: { $ne: excludeId },
  });
  return remaining === 0;
}

import mongoose from "mongoose";
import crypto from "crypto";
import MlmMembership from "../../models/mlmMembership.js";
import Customer from "../../models/customer.js";
import {
  MLM_BINARY_PLACEMENT_STRATEGY,
  MLM_DEFAULTS,
  MLM_MEMBERSHIP_STATUS,
  MLM_PLAN_TYPE,
} from "../../constants/mlm.js";
import { getMlmConfig } from "./mlmConfigService.js";

/**
 * mlmMembershipService — every read/write of MlmMembership rows goes
 * through this module. Responsibilities:
 *   - Lazy-create or fetch a membership document for a user.
 *   - Generate a unique referral code (collision-retry).
 *   - Assign sponsor + build the denormalised sponsorChain.
 *   - Place a new member in the binary tree (weaker-leg BFS by default).
 *   - Maintain denormalised counters (directReferralsCount,
 *     totalDownlineCount) and the `Customer.mlm` projection.
 *
 * All mutating functions accept `{session}` so callers can compose
 * with the surrounding transaction (per `mongoose-transaction-wrap`
 * skill).
 */

const REFERRAL_CODE_MAX_RETRIES = 8;

function randomCodeChars(length, alphabet) {
  const buf = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[buf[i] % alphabet.length];
  }
  return out;
}

/**
 * Generate a unique uppercase referral code. Collision-retry up to N
 * attempts (extremely unlikely beyond 1 with 8-char alphanumeric).
 */
export async function generateReferralCode({ session } = {}) {
  const cfg = await getMlmConfig();
  const length = Number(cfg.referralCodeLength) || MLM_DEFAULTS.referralCodeLength;
  const alphabet = MLM_DEFAULTS.referralCodeAlphabet;

  for (let attempt = 0; attempt < REFERRAL_CODE_MAX_RETRIES; attempt += 1) {
    const candidate = randomCodeChars(length, alphabet);
    const existing = await MlmMembership.findOne(
      { referralCode: candidate, __includeDeleted: true },
      null,
      session ? { session } : {},
    ).lean();
    if (!existing) return candidate;
  }
  throw new Error(
    `Could not generate a unique referral code after ${REFERRAL_CODE_MAX_RETRIES} attempts`,
  );
}

/**
 * Find a membership by user id. Returns null if the user is not an
 * MLM member (which is the expected default for every customer).
 */
export async function getMembershipByUserId(userId, { session } = {}) {
  if (!userId) return null;
  return MlmMembership.findOne({ userId }, null, session ? { session } : {});
}

export async function getMembershipByReferralCode(code, { session } = {}) {
  if (!code) return null;
  return MlmMembership.findOne(
    { referralCode: String(code).trim().toUpperCase() },
    null,
    session ? { session } : {},
  );
}

/**
 * Build the sponsorChain for `newMembership` by prepending sponsor's
 * sponsorChain. Capped at `sponsorChainMaxDepth`.
 */
async function buildSponsorChain(sponsorMembership, { session } = {}) {
  if (!sponsorMembership) return [];
  const cfg = await getMlmConfig();
  const maxDepth = Number(cfg.sponsorChainMaxDepth) || MLM_DEFAULTS.sponsorChainMaxDepth;

  const chain = [sponsorMembership.userId];
  for (const upline of sponsorMembership.sponsorChain || []) {
    if (chain.length >= maxDepth) break;
    chain.push(upline);
  }
  return chain;
}

/**
 * Recompute and persist `Customer.mlm` denormalised projection. Idempotent.
 */
export async function syncCustomerMlmProjection(userId, { session } = {}) {
  const membership = await getMembershipByUserId(userId, { session });
  const projection = membership
    ? {
        active: membership.status === MLM_MEMBERSHIP_STATUS.ACTIVE,
        planType: membership.planType,
        referralCode: membership.referralCode,
        sponsorId: membership.sponsorId || null,
        directReferralsCount: membership.directReferralsCount || 0,
        lifetimePlanAEarnings: membership.lifetimePlanAEarnings || 0,
        lifetimePlanBEarnings: membership.lifetimePlanBEarnings || 0,
        joinedAt: membership.joinedAt,
        homeShoppingUnlocked: !!membership.homeShoppingUnlocked,
      }
    : {
        active: false,
        planType: null,
        referralCode: undefined,
        sponsorId: null,
        directReferralsCount: 0,
        lifetimePlanAEarnings: 0,
        lifetimePlanBEarnings: 0,
        joinedAt: null,
        homeShoppingUnlocked: false,
      };

  await Customer.updateOne(
    { _id: userId },
    { $set: { mlm: projection } },
    session ? { session } : {},
  );
}

/**
 * Find the deepest empty slot on the weaker leg of `rootMembership`
 * using BFS. Returns { parentMembership, position } where position is
 * "L" or "R". If `rootMembership` itself has an empty slot, that slot
 * wins (depth 0).
 */
async function findBalancedBinarySlot(rootMembership, { session } = {}) {
  const queue = [rootMembership];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node.binaryLeftChildId) return { parentMembership: node, position: "L" };
    if (!node.binaryRightChildId) return { parentMembership: node, position: "R" };

    // Pick the leg with the fewer descendants. Count via direct child
    // lookup is fine because BFS already balances depth; for a deeper
    // tree the totalDownlineCount counter (when populated) wins.
    const [leftChild, rightChild] = await Promise.all([
      MlmMembership.findOne(
        { userId: node.binaryLeftChildId },
        null,
        session ? { session } : {},
      ),
      MlmMembership.findOne(
        { userId: node.binaryRightChildId },
        null,
        session ? { session } : {},
      ),
    ]);
    if (!leftChild) return { parentMembership: node, position: "L" };
    if (!rightChild) return { parentMembership: node, position: "R" };
    const leftCount = leftChild.totalDownlineCount || 0;
    const rightCount = rightChild.totalDownlineCount || 0;
    if (leftCount <= rightCount) {
      queue.push(leftChild);
      queue.push(rightChild);
    } else {
      queue.push(rightChild);
      queue.push(leftChild);
    }
  }
  return null;
}

/**
 * Place `newMembership` into the binary tree under `sponsorMembership`
 * using the configured placement strategy. Mutates both documents in
 * place; caller is responsible for saving them in the same session.
 */
export async function placeInBinaryTree({
  newMembership,
  sponsorMembership,
  session,
  preferredPosition = null, // "L" | "R" | null
}) {
  if (!sponsorMembership) return;

  const cfg = await getMlmConfig();
  const strategy = cfg.binaryPlacementStrategy || MLM_DEFAULTS.binaryPlacementStrategy;

  let parentMembership = sponsorMembership;
  let position = preferredPosition && ["L", "R"].includes(preferredPosition) ? preferredPosition : null;

  if (strategy === MLM_BINARY_PLACEMENT_STRATEGY.BALANCED_AUTO) {
    const slot = await findBalancedBinarySlot(sponsorMembership, { session });
    if (!slot) return; // no slot found (shouldn't happen for a fresh tree)
    parentMembership = slot.parentMembership;
    position = slot.position;
  } else if (strategy === MLM_BINARY_PLACEMENT_STRATEGY.SPILLOVER) {
    // Honour preferredPosition if open; otherwise spillover down that leg.
    let prefer = position || "L";
    let cursor = sponsorMembership;
    // Walk down the preferred leg until we find an empty slot.
    // Safety: cap at sponsorChainMaxDepth iterations.
    const maxIter = Number(cfg.sponsorChainMaxDepth) || 10;
    for (let i = 0; i < maxIter; i += 1) {
      const childId = prefer === "L" ? cursor.binaryLeftChildId : cursor.binaryRightChildId;
      if (!childId) {
        parentMembership = cursor;
        position = prefer;
        break;
      }
      cursor = await MlmMembership.findOne(
        { userId: childId },
        null,
        session ? { session } : {},
      );
      if (!cursor) break;
    }
  } else {
    // manual: require preferredPosition; if not provided, default to L.
    parentMembership = sponsorMembership;
    position = position || "L";
  }

  if (!parentMembership || !position) return;

  newMembership.binaryParentId = parentMembership.userId;
  newMembership.binaryParentMembershipId = parentMembership._id;
  newMembership.binaryPosition = position;

  if (position === "L") {
    parentMembership.binaryLeftChildId = newMembership.userId;
  } else {
    parentMembership.binaryRightChildId = newMembership.userId;
  }
  await parentMembership.save({ session });
}

/**
 * Increment the direct-referrals counter on the sponsor's membership.
 * Returns the post-increment count (used by the caller to evaluate
 * milestone bonuses).
 */
export async function incrementDirectReferralCount(sponsorUserId, { session } = {}) {
  if (!sponsorUserId) return 0;
  const updated = await MlmMembership.findOneAndUpdate(
    { userId: sponsorUserId },
    { $inc: { directReferralsCount: 1, totalDownlineCount: 1 } },
    { new: true, session },
  );
  return updated ? updated.directReferralsCount : 0;
}

/**
 * Increment totalDownlineCount on every ancestor in the chain. Bounded
 * by the sponsor chain length (already capped at `sponsorChainMaxDepth`).
 */
export async function incrementUplineDownlineCounts(sponsorChain, { session } = {}) {
  if (!Array.isArray(sponsorChain) || sponsorChain.length === 0) return;
  // Skip index 0 — that's the direct sponsor, already bumped by
  // incrementDirectReferralCount above. Bump only further upline.
  const tail = sponsorChain.slice(1);
  if (tail.length === 0) return;
  await MlmMembership.updateMany(
    { userId: { $in: tail } },
    { $inc: { totalDownlineCount: 1 } },
    session ? { session } : {},
  );
}

/**
 * Create a new MlmMembership row for `userId`. Idempotent — if the
 * customer already has a membership row, that row is returned as-is.
 *
 * Caller is responsible for ALL sponsor / binary / upline wiring via
 * `assignSponsor` separately. This function ONLY mints the row, the
 * referral code, and the projection.
 *
 * @returns {Promise<{membership: MlmMembership, created: boolean}>}
 */
export async function createOrGetMembership(userId, { session } = {}) {
  const existing = await getMembershipByUserId(userId, { session });
  if (existing) return { membership: existing, created: false };

  const referralCode = await generateReferralCode({ session });
  const created = await MlmMembership.create(
    [
      {
        userId,
        referralCode,
        planType: MLM_PLAN_TYPE.A,
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
        joinedAt: new Date(),
        planAJoinedAt: new Date(),
      },
    ],
    session ? { session } : {},
  );
  const membership = created[0];
  await syncCustomerMlmProjection(userId, { session });
  return { membership, created: true };
}

/**
 * Wire the sponsor edge for `membership`. Looks up the sponsor by
 * referral code, walks the chain, places in binary tree, bumps counters,
 * resyncs both customer projections.
 *
 * - If `sponsorReferralCode` is missing or invalid, the membership stays
 *   sponsor-less (top of its own tree).
 * - If the sponsor is the same user (self-referral), throws.
 * - If the membership already has a sponsor, throws (no re-parenting).
 */
export async function assignSponsor({
  membership,
  sponsorReferralCode,
  session,
  preferredBinaryPosition = null,
}) {
  if (!membership) throw new Error("membership is required");
  if (membership.sponsorId) {
    throw new Error("Membership already has a sponsor");
  }

  const code = String(sponsorReferralCode || "").trim().toUpperCase();
  if (!code) return membership; // silent no-op for missing code

  const sponsorMembership = await getMembershipByReferralCode(code, { session });
  if (!sponsorMembership) return membership; // silent no-op for unknown code

  if (String(sponsorMembership.userId) === String(membership.userId)) {
    throw new Error("Self-referral is not allowed");
  }

  membership.sponsorId = sponsorMembership.userId;
  membership.sponsorMembershipId = sponsorMembership._id;
  membership.sponsorChain = await buildSponsorChain(sponsorMembership, { session });

  await placeInBinaryTree({
    newMembership: membership,
    sponsorMembership,
    session,
    preferredPosition: preferredBinaryPosition,
  });

  await membership.save({ session });

  await incrementDirectReferralCount(sponsorMembership.userId, { session });
  await incrementUplineDownlineCounts(membership.sponsorChain, { session });

  await syncCustomerMlmProjection(membership.userId, { session });
  await syncCustomerMlmProjection(sponsorMembership.userId, { session });

  return membership;
}

/**
 * Walk the upline chain for `userId` up to `maxDepth` levels. Returns
 * an array of memberships in order [L1, L2, ...]. Excludes the user
 * itself.
 */
export async function getUplineChain(userId, maxDepth, { session } = {}) {
  const membership = await getMembershipByUserId(userId, { session });
  if (!membership) return [];
  const chain = (membership.sponsorChain || []).slice(0, Math.max(0, maxDepth || 0));
  if (chain.length === 0) return [];
  const memberships = await MlmMembership.find(
    { userId: { $in: chain }, status: MLM_MEMBERSHIP_STATUS.ACTIVE },
    null,
    session ? { session } : {},
  );
  // Re-order to match `chain` ordering (the find() may not preserve it).
  const indexByUserId = new Map(chain.map((id, idx) => [String(id), idx]));
  return memberships
    .slice()
    .sort(
      (a, b) =>
        (indexByUserId.get(String(a.userId)) ?? 0) -
        (indexByUserId.get(String(b.userId)) ?? 0),
    );
}

/**
 * Lightweight summary of a member's direct referrals — for dashboard.
 * Returns at most `limit` rows.
 */
export async function getDirectReferrals(userId, { limit = 50, session } = {}) {
  const list = await MlmMembership.find(
    { sponsorId: userId, status: MLM_MEMBERSHIP_STATUS.ACTIVE },
    null,
    session ? { session } : {},
  )
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 500));
  return list;
}

/**
 * Bump lifetime earnings counters and persist. Used by the bonus
 * engine after each credit. Returns the post-increment values.
 */
export async function recordLifetimeEarning({
  userId,
  amount,
  planType,
  session,
}) {
  if (!userId || !amount || amount <= 0) return null;
  const inc = {
    [planType === MLM_PLAN_TYPE.B ? "lifetimePlanBEarnings" : "lifetimePlanAEarnings"]:
      amount,
  };
  const updated = await MlmMembership.findOneAndUpdate(
    { userId },
    { $inc: inc },
    { new: true, session },
  );
  if (updated) {
    await syncCustomerMlmProjection(userId, { session });
  }
  return updated;
}

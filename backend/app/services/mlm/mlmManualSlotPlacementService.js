import bcrypt from "bcrypt";
import mongoose from "mongoose";
import Customer from "../../models/customer.js";
import MlmMembership from "../../models/mlmMembership.js";
import { MLM_MEMBERSHIP_STATUS } from "../../constants/mlm.js";
import {
  assignSponsor,
  createOrGetMembership,
  getMembershipByUserId,
} from "./mlmMembershipService.js";
import { sendCustomerWelcomeEmail } from "../emailService.js";
import { generateUniqueUserId } from "../../utils/userIdGenerator.js";
import {
  isValidE164Phone,
  normalizePhoneNumber,
} from "../../utils/phone.js";

/**
 * mlmManualSlotPlacementService — creates a brand-new Customer +
 * MlmMembership row positioned in a SPECIFIC empty slot of an
 * existing parent member's binary tree.
 *
 * This is the backing service for the redesigned Genealogy view's
 * "Add member from blue empty slot" action (shared by the customer
 * panel and the admin panel). The actor (customer who owns / can
 * see the parent in their downline, OR an admin) fills out the same
 * form fields collected at public signup, EXCEPT the OTP step is
 * skipped — the new member's row lands `isVerified=true` and
 * `MlmMembership.status=REGISTERED_UNPAID` so the regular joining
 * payment flow still gates payouts (see the user clarifications
 * captured in the redesign chat).
 *
 * Invariants enforced here:
 *   - The target leg slot must actually be empty at write time
 *     (best-effort check inside the transaction; the unique index
 *     on `MlmMembership.userId` is the ultimate backstop against
 *     races).
 *   - The new member's SPONSOR is the FILLED parent of the slot
 *     (not the actor). Binary placement always lands at the exact
 *     `{parentMembership, leg}` the caller chose — `assignSponsor`
 *     is called with `forceManualPlacement=true` and walks down
 *     the parent's chosen leg deterministically.
 *   - Phone is the canonical unique identity; duplicates throw a
 *     friendly 409 instead of bubbling Mongo's E11000.
 *   - The welcome email (login credentials echo + referral code)
 *     fires OUTSIDE the transaction; failures are logged but never
 *     roll the member back.
 */

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "10", 10);

/**
 * Authorization helper — checks whether `actorUserId` is allowed to
 * place a member directly under `parentMembership` from the
 * customer panel.
 *
 * Rule (matches the on-canvas "blue empty slot" visual rule): the
 * actor must EITHER be the parent themselves, OR have the parent
 * in their downline. The latter is decided by the parent's
 * `sponsorChain` (which always contains every upline in unilevel
 * order, regardless of binary spillover).
 *
 * Admins bypass this check via the dedicated admin endpoint that
 * never calls this helper.
 */
export function isActorAllowedForParent({ actorUserId, parentMembership }) {
  if (!parentMembership) return false;
  if (
    String(parentMembership.userId?._id || parentMembership.userId) ===
    String(actorUserId)
  ) {
    return true;
  }
  const chain = (parentMembership.sponsorChain || []).map((id) => String(id));
  return chain.includes(String(actorUserId));
}

function makeError(message, statusCode = 400, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

function sanitizeInputs({ name, email, phone, password, leg }) {
  const cleanName = String(name || "").trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw makeError("Please enter a valid full name (2-80 characters).", 400, "NAME_INVALID");
  }

  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 160) {
    throw makeError("Please enter a valid email address.", 400, "EMAIL_INVALID");
  }

  // The auth service normalises Indian 10-digit numbers to E.164 by
  // prepending the default country code (+91). Mirror that here so a
  // viewer can paste a bare 10-digit number into the modal.
  const cleanPhone = normalizePhoneNumber(phone);
  if (!isValidE164Phone(cleanPhone)) {
    throw makeError("Please enter a valid phone number.", 400, "PHONE_INVALID");
  }

  const cleanPassword = String(password || "");
  if (cleanPassword.length < 1 || cleanPassword.length > 1024) {
    throw makeError("Please enter a password.", 400, "PASSWORD_INVALID");
  }

  const cleanLeg = String(leg || "").trim().toUpperCase();
  if (!["L", "R"].includes(cleanLeg)) {
    throw makeError("Please choose a leg position (Left or Right).", 400, "LEG_INVALID");
  }

  return {
    name: cleanName,
    email: cleanEmail,
    phone: cleanPhone,
    password: cleanPassword,
    leg: cleanLeg,
  };
}

/**
 * @returns {Promise<{customer, membership, sponsor, leg}>}
 *
 * @param {object} args
 * @param {string} args.parentMembershipId  - `_id` of the FILLED parent membership.
 * @param {"L"|"R"} args.leg                - which slot under the parent.
 * @param {string}  args.name               - full name (from form).
 * @param {string}  args.email              - email (from form).
 * @param {string}  args.phone              - phone (10-digit IN or E.164).
 * @param {string}  args.password           - password (any non-empty string).
 * @param {"customer"|"admin"} args.actorType
 * @param {string}  args.actorUserId        - acting user / admin id (for audit).
 * @param {boolean} [args.skipAuthorization=false] - true for admin path.
 */
export async function createMemberInBinarySlot(args) {
  const inputs = sanitizeInputs(args);

  if (!mongoose.isValidObjectId(args.parentMembershipId)) {
    throw makeError("Invalid parent reference.", 400, "PARENT_INVALID");
  }

  // Up-front parent lookup OUTSIDE the transaction (read-only) so we
  // can return clean validation errors without aborting a session.
  const parent = await MlmMembership.findById(args.parentMembershipId).lean();
  if (!parent) {
    throw makeError("Parent member not found.", 404, "PARENT_NOT_FOUND");
  }

  if (!parent.referralCode) {
    throw makeError(
      "Parent has no referral code on record — cannot place a member under them.",
      400,
      "PARENT_REFERRAL_MISSING",
    );
  }

  if (!args.skipAuthorization) {
    const allowed = isActorAllowedForParent({
      actorUserId: args.actorUserId,
      parentMembership: parent,
    });
    if (!allowed) {
      throw makeError(
        "You can only add members directly under your own downline.",
        403,
        "PARENT_NOT_IN_DOWNLINE",
      );
    }
  }

  // Slot occupancy guard. The DB-level guarantee comes from the
  // unique index on `MlmMembership.userId` + the placement engine,
  // but a friendly preflight here avoids a confusing "duplicate key"
  // error when both sibling slots are already taken.
  const isLeftLeg = inputs.leg === "L";
  const occupantId = isLeftLeg ? parent.binaryLeftChildId : parent.binaryRightChildId;
  if (occupantId) {
    throw makeError(
      `The ${isLeftLeg ? "left" : "right"} slot under this member is already taken.`,
      409,
      "SLOT_TAKEN",
    );
  }

  // Phone uniqueness preflight (same friendly-error reason).
  const phoneTaken = await Customer.exists({ phone: inputs.phone });
  if (phoneTaken) {
    throw makeError(
      "An account with this phone number already exists.",
      409,
      "PHONE_TAKEN",
    );
  }

  const passwordHash = await bcrypt.hash(inputs.password, BCRYPT_ROUNDS);
  const userId = await generateUniqueUserId(Customer);

  const session = await mongoose.startSession();
  let newCustomer = null;
  let newMembership = null;
  try {
    await session.withTransaction(async () => {
      // Re-verify slot is still empty inside the transaction. A
      // racing concurrent placement (e.g. balanced-auto BFS landing
      // a spillover here) would fail this re-check and abort the
      // session cleanly.
      const parentFresh = await MlmMembership.findById(parent._id).session(session);
      if (!parentFresh) {
        throw makeError("Parent member disappeared.", 410, "PARENT_GONE");
      }
      const stillEmpty = isLeftLeg
        ? !parentFresh.binaryLeftChildId
        : !parentFresh.binaryRightChildId;
      if (!stillEmpty) {
        throw makeError(
          `The ${isLeftLeg ? "left" : "right"} slot was just filled by someone else. Please refresh.`,
          409,
          "SLOT_RACE",
        );
      }

      const created = await Customer.create(
        [
          {
            name: inputs.name,
            email: inputs.email,
            phone: inputs.phone,
            password: passwordHash,
            _signupPasswordPlaintext: inputs.password,
            userId,
            // Skip OTP — the actor vouches for this account being
            // legitimate (see clarification: viewer-created accounts
            // are pre-verified). Login works immediately via
            // user-id/phone + password.
            isVerified: true,
            // Same shape the OTP flow uses so any downstream reader
            // that inspects these audit fields still works.
            pendingSponsorReferralCode: parent.referralCode,
            pendingSponsorLeg: inputs.leg,
          },
        ],
        { session },
      );
      newCustomer = created[0];

      const membershipResult = await createOrGetMembership(newCustomer._id, {
        session,
        status: MLM_MEMBERSHIP_STATUS.REGISTERED_UNPAID,
      });
      newMembership = membershipResult.membership;

      await assignSponsor({
        membership: newMembership,
        sponsorReferralCode: parent.referralCode,
        session,
        preferredBinaryPosition: inputs.leg,
        // forceManualPlacement honours the picked leg even when the
        // admin's binary placement strategy is BALANCED_AUTO. Same
        // flag the public signup flow uses.
        forceManualPlacement: true,
      });
    });
  } finally {
    await session.endSession();
  }

  if (!newCustomer || !newMembership) {
    throw makeError("Failed to create member.", 500, "CREATE_FAILED");
  }

  // Refetch the membership post-commit so the caller sees the
  // populated sponsor/binary fields written by assignSponsor.
  const persistedMembership = await getMembershipByUserId(newCustomer._id);

  // Welcome email — best effort, never throws back to the caller.
  // Same template as the public signup; includes login credentials
  // echo so the new member never loses their password.
  try {
    await sendCustomerWelcomeEmail({
      email: newCustomer.email,
      name: newCustomer.name,
      referralCode: persistedMembership?.referralCode || null,
      loginEmail: newCustomer.email,
      loginPhone: newCustomer.phone,
      loginPassword: inputs.password,
      loginUserId: newCustomer.userId,
    });
  } catch (mailErr) {
    // Intentionally swallowed — the member exists and can sign in;
    // surfacing this would imply the action failed when it didn't.
    if (typeof console !== "undefined" && console.warn) {
      console.warn(
        "[mlmManualSlotPlacementService] welcome email dispatch failed",
        { error: mailErr.message },
      );
    }
  }

  return {
    customer: newCustomer,
    membership: persistedMembership || newMembership,
    sponsor: {
      membershipId: parent._id,
      referralCode: parent.referralCode,
      userId: parent.userId,
    },
    leg: inputs.leg,
  };
}

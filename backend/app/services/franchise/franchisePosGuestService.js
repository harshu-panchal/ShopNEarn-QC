import Customer from "../../models/customer.js";
import { FRANCHISE_POS_WALKIN_PHONE } from "../../constants/franchise.js";

let cachedWalkInUserId = null;

/**
 * Platform User used as Order.customer for guest POS sales (buyer snapshot in posBuyer).
 */
export async function getFranchisePosWalkInUserId({ session } = {}) {
  if (cachedWalkInUserId) return cachedWalkInUserId;

  // `phone` carries a unique index, so a plain find-then-create races on
  // the very first guest sale (or right after a process restart, before
  // the in-memory cache is warm): two concurrent callers can both find
  // nothing and both attempt to create the same row, and the loser
  // throws an uncaught E11000 straight to the cashier terminal. An
  // atomic upsert makes the "find or create" a single operation — only
  // one caller ever actually inserts, everyone else just reads it back.
  const user = await Customer.findOneAndUpdate(
    { phone: FRANCHISE_POS_WALKIN_PHONE },
    {
      $setOnInsert: {
        name: "Franchise POS Walk-in",
        phone: FRANCHISE_POS_WALKIN_PHONE,
        role: "user",
        isVerified: true,
      },
    },
    {
      upsert: true,
      new: true,
      session,
      setDefaultsOnInsert: true,
    },
  )
    .select("_id")
    .lean();

  cachedWalkInUserId = user._id;
  return cachedWalkInUserId;
}

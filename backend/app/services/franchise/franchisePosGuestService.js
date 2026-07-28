import Customer from "../../models/customer.js";
import { FRANCHISE_POS_WALKIN_PHONE } from "../../constants/franchise.js";

let cachedWalkInUserId = null;

/**
 * Platform User used as Order.customer for guest POS sales (buyer snapshot in posBuyer).
 */
export async function getFranchisePosWalkInUserId({ session } = {}) {
  if (cachedWalkInUserId) return cachedWalkInUserId;

  let q = Customer.findOne({ phone: FRANCHISE_POS_WALKIN_PHONE }).select("_id");
  if (session) q = q.session(session);
  let user = await q.lean();

  if (!user) {
    const created = await Customer.create(
      [
        {
          name: "Franchise POS Walk-in",
          phone: FRANCHISE_POS_WALKIN_PHONE,
          role: "user",
          isVerified: true,
        },
      ],
      session ? { session } : undefined,
    );
    user = created[0];
  }

  cachedWalkInUserId = user._id;
  return cachedWalkInUserId;
}

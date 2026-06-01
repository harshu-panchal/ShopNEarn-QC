/**
 * loadtest-mlm-bonus-chain.js
 *
 * Synthetic 6-level downline load test for the MLM bonus engine.
 *
 *   L0 (root sponsor)
 *     └── L1 (1 child)
 *           └── L2 (1 child)
 *                 └── L3 (1 child)
 *                       └── L4 (1 child)
 *                             └── L5 (1 child)
 *                                   └── L6 (paying buyer)
 *
 * The script:
 *   1. Creates 7 synthetic Customer docs with phone prefix
 *      `LOADTEST-MLM-` so they're easy to clean up.
 *   2. Activates each through `assignSponsor` so the binary tree,
 *      sponsorChain, and direct-count counters are populated.
 *   3. Creates a synthetic delivered Order on L6 with the requested
 *      grand total (defaults: ₹1,000 normal + ₹10,000 home-shopping).
 *   4. Fires `computeAndCreditRepurchaseBonusChain` and
 *      `computeAndCreditHomeShoppingCommissions` for the order.
 *   5. Reports timings, per-upline event counts, and total drift.
 *
 * Usage:
 *   node backend/scripts/loadtest-mlm-bonus-chain.js                # dry-run
 *   node backend/scripts/loadtest-mlm-bonus-chain.js --apply        # actually create + fire
 *   node backend/scripts/loadtest-mlm-bonus-chain.js --apply --cleanup
 *
 * --cleanup deletes the synthetic users + memberships + bonus events
 *   so re-runs are idempotent. MUST NOT be used in production.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import Customer from "../app/models/customer.js";
import MlmMembership from "../app/models/mlmMembership.js";
import MlmCommissionEvent from "../app/models/mlmCommissionEvent.js";
import Order from "../app/models/order.js";
import {
  assignSponsor,
  createOrGetMembership,
} from "../app/services/mlm/mlmMembershipService.js";
import {
  computeAndCreditRepurchaseBonusChain,
  computeAndCreditHomeShoppingCommissions,
} from "../app/services/mlm/mlmBonusEngineService.js";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const CLEANUP = process.argv.includes("--cleanup");
const ORDER_TOTAL = Number(process.env.LOADTEST_ORDER_TOTAL || 1000);
const HOME_SHOPPING_TOTAL = Number(process.env.LOADTEST_HOME_SHOPPING_TOTAL || 10000);
const PREFIX = "LOADTEST-MLM";
const DEPTH = 6;

async function ensureUser(idx) {
  const phone = `${PREFIX}-${String(idx).padStart(4, "0")}`;
  let user = await Customer.findOne({ phone });
  if (!user) {
    user = await Customer.create({
      name: `Load Test L${idx}`,
      phone,
      email: `${phone.toLowerCase()}@loadtest.local`,
    });
  }
  return user;
}

async function ensureMembership(userId) {
  const { membership } = await createOrGetMembership(userId);
  return membership;
}

async function timed(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  const dt = Date.now() - t0;
  console.log(`  [${label}] ${dt}ms`);
  return { result, dt };
}

async function createSyntheticOrder({ buyerId, grandTotal, isHomeShoppingOrder }) {
  // Minimal viable Order for the bonus chain — only the fields actually
  // read by the engine are populated. This bypasses orderPlacementService
  // entirely so we can drive the chain without payment plumbing.
  const order = await Order.create({
    user: buyerId,
    items: [],
    status: "DELIVERED",
    isHomeShoppingOrder: !!isHomeShoppingOrder,
    paymentBreakdown: {
      grandTotal,
      itemsTotal: grandTotal,
      walletAmount: 0,
      walletSplit: { shopping: 0, earnings: 0, available: 0 },
      currency: "INR",
    },
    deliveredAt: new Date(),
  });
  return order;
}

async function main() {
  await connectDB();

  console.log(`MLM bonus-chain load test — apply=${APPLY} cleanup=${CLEANUP}`);
  console.log(`Order total = ₹${ORDER_TOTAL}, Home-shopping total = ₹${HOME_SHOPPING_TOTAL}`);

  if (!APPLY) {
    console.log(`\nDry-run: would build ${DEPTH + 1}-member chain (L0..L${DEPTH}) and fire repurchase + home-shopping chains.`);
    console.log("Re-run with --apply to actually execute.");
    await mongoose.disconnect();
    return;
  }

  const users = [];
  for (let i = 0; i <= DEPTH; i += 1) {
    users.push(await ensureUser(i));
  }
  console.log(`\nCreated/loaded ${users.length} users.`);

  const memberships = [];
  for (const user of users) {
    memberships.push(await ensureMembership(user._id));
  }

  // Wire sponsor chain L0 -> L1 -> ... -> L6.
  for (let i = 1; i < users.length; i += 1) {
    const sponsorMembership = await MlmMembership.findById(memberships[i - 1]._id);
    const myMembership = await MlmMembership.findById(memberships[i]._id);
    if (!myMembership.sponsorId) {
      await assignSponsor({
        membership: myMembership,
        sponsorReferralCode: sponsorMembership.referralCode,
      });
    }
  }
  console.log(`Sponsor chain wired L0 -> ... -> L${DEPTH}.`);

  const buyer = users[DEPTH];

  // Repurchase chain
  console.log(`\nCreating synthetic order ₹${ORDER_TOTAL} for L${DEPTH} buyer...`);
  const repurchaseOrder = await createSyntheticOrder({
    buyerId: buyer._id,
    grandTotal: ORDER_TOTAL,
    isHomeShoppingOrder: false,
  });
  console.log(`  orderId=${repurchaseOrder._id}`);

  await timed("repurchase-chain", () =>
    computeAndCreditRepurchaseBonusChain({
      orderId: repurchaseOrder._id,
      downlineUserId: buyer._id,
      correlationId: `LOADTEST-${Date.now()}`,
    }),
  );

  // Home-shopping chain
  console.log(`\nCreating synthetic HOME-SHOPPING order ₹${HOME_SHOPPING_TOTAL} for L${DEPTH} buyer...`);
  const hsOrder = await createSyntheticOrder({
    buyerId: buyer._id,
    grandTotal: HOME_SHOPPING_TOTAL,
    isHomeShoppingOrder: true,
  });
  console.log(`  orderId=${hsOrder._id}`);

  await timed("home-shopping-chain", () =>
    computeAndCreditHomeShoppingCommissions({
      orderId: hsOrder._id,
      downlineUserId: buyer._id,
      correlationId: `LOADTEST-HS-${Date.now()}`,
    }),
  );

  console.log("\n--- Bonus rows per upline member (this run) ---");
  const allEventOrderIds = [repurchaseOrder._id, hsOrder._id];
  for (let i = 0; i <= DEPTH; i += 1) {
    const rows = await MlmCommissionEvent.find({
      recipientId: users[i]._id,
      sourceOrderId: { $in: allEventOrderIds },
    }).select({ bonusType: 1, cappedAmount: 1, status: 1 }).lean();
    const total = rows.reduce((acc, r) => acc + (r.cappedAmount || 0), 0);
    console.log(`  L${i} (${i === DEPTH ? "buyer" : "sponsor"}): ${rows.length} events, ₹${total.toFixed(2)}`);
  }

  if (CLEANUP) {
    console.log("\nCleaning up synthetic data...");
    const userIds = users.map((u) => u._id);
    await MlmCommissionEvent.deleteMany({ recipientId: { $in: userIds } });
    await MlmMembership.deleteMany({ userId: { $in: userIds } });
    await Order.deleteMany({ user: { $in: userIds }, _id: { $in: allEventOrderIds } });
    await Customer.deleteMany({ _id: { $in: userIds } });
    console.log("Cleanup complete.");
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

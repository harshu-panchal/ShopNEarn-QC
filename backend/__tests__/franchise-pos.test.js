/**
 * Franchise POS sale tests (Mongo + real services).
 *
 * Run: RUN_E2E_TESTS=true REDIS_DISABLED=true npm test -- franchise-pos
 */

import mongoose from "mongoose";
import { jest } from "@jest/globals";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import User from "../app/models/customer.js";
import Seller from "../app/models/seller.js";
import Category from "../app/models/category.js";
import Product from "../app/models/product.js";
import Setting from "../app/models/setting.js";
import Order from "../app/models/order.js";
import Wallet from "../app/models/wallet.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import FranchiseStockLedger from "../app/models/franchiseStockLedger.js";
import FranchiseStockMovement from "../app/models/franchiseStockMovement.js";

import { FRANCHISE_PARTNER_STATUS } from "../app/constants/franchise.js";
import { FRANCHISE_STOCK_TYPES } from "../app/constants/inventory.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

process.env.REDIS_DISABLED = process.env.REDIS_DISABLED || "true";

const { createPosSale, previewPosSale } =
  await import("../app/services/franchise/franchisePosService.js");
const { listFranchisePartnerOrders } =
  await import("../app/services/franchise/franchiseOrderService.js");
const { settleDeliveredOrder } =
  await import("../app/services/finance/orderFinanceService.js");

jest.setTimeout(120000);

const RUN_INTEGRATION = process.env.RUN_E2E_TESTS === "true";

function randomSuffix() {
  return `${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function resetCollections() {
  await Promise.all([
    User.deleteMany({}),
    Seller.deleteMany({}),
    Category.deleteMany({}),
    Product.deleteMany({}),
    Setting.deleteMany({}),
    Order.deleteMany({}),
    Wallet.deleteMany({}),
    LedgerEntry.deleteMany({}),
    FranchisePartner.deleteMany({}),
    FranchiseStockLedger.deleteMany({}),
    FranchiseStockMovement.deleteMany({}),
  ]);
}

async function seedPosFixture() {
  const suffix = randomSuffix();

  const partnerUser = await User.create({
    name: "POS Partner",
    phone: `8900${suffix.slice(-6)}`,
    role: "user",
    isVerified: true,
  });

  const hubSeller = await Seller.create({
    name: "Hub Seller",
    email: `hub_pos_${suffix}@test.example`,
    phone: `8910${suffix.slice(-6)}`,
    password: "Password@123",
    shopName: "Hub POS Test",
    isVerified: true,
    isActive: true,
    isPlatformHub: true,
    isFranchiseCatalogSource: true,
    applicationStatus: "approved",
  });

  const header = await Category.create({
    name: `Header ${suffix}`,
    slug: `header-pos-${suffix}`,
    type: "header",
    adminCommissionType: "percentage",
    adminCommissionValue: 10,
    handlingFeeType: "fixed",
    handlingFeeValue: 0,
    status: "active",
  });

  const category = await Category.create({
    name: `Category ${suffix}`,
    slug: `category-pos-${suffix}`,
    type: "category",
    parentId: header._id,
    adminCommissionType: "percentage",
    adminCommissionValue: 10,
    handlingFeeType: "fixed",
    handlingFeeValue: 0,
    status: "active",
  });

  const hubProduct = await Product.create({
    name: "POS Test Product",
    slug: `pos-product-${suffix}`,
    sku: `POS-SKU-${suffix}`,
    description: "POS test",
    price: 100,
    salePrice: 80,
    stock: 50,
    headerId: header._id,
    categoryId: category._id,
    sellerId: hubSeller._id,
    status: "active",
  });

  await Setting.create({
    homeShoppy: {
      enabled: true,
      posEnabled: true,
      hubSellerId: hubSeller._id,
      hubShopDisplayName: hubSeller.shopName,
    },
  });

  const partner = await FranchisePartner.create({
    userId: partnerUser._id,
    referralCode: `HP${suffix.slice(-6).toUpperCase()}`,
    status: FRANCHISE_PARTNER_STATUS.ACTIVE,
    hubSellerId: hubSeller._id,
    registeredAt: new Date(),
    displayName: partnerUser.name,
    hasCompletedFirstTopup: true,
  });

  await FranchiseStockLedger.create({
    franchisePartnerId: partner._id,
    productId: hubProduct._id,
    quantity: 5,
  });

  return { partner, partnerUser, hubProduct, hubSeller };
}

(RUN_INTEGRATION ? describe : describe.skip)("Franchise POS", () => {
  beforeAll(async () => {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI required for franchise POS integration tests");
    }
    await mongoose.connect(process.env.MONGO_URI);
  });

  afterAll(async () => {
    await mongoose.disconnect();
  });

  beforeEach(async () => {
    await resetCollections();
  });

  it("creates a POS sale and decrements franchise stock", async () => {
    const { partner, partnerUser, hubProduct } = await seedPosFixture();

    const result = await createPosSale({
      franchisePartnerId: partner._id,
      userId: partnerUser._id,
      items: [{ productId: String(hubProduct._id), quantity: 2 }],
      buyer: { kind: "guest", name: "Walk-in", phone: "9999999999" },
      payment: { method: "cash" },
      idempotencyKey: "test-key-1",
    });

    expect(result.duplicate).toBe(false);
    expect(result.order.isFranchisePosSale).toBe(true);
    expect(result.order.franchiseStockConsumed).toBe(true);

    const ledger = await FranchiseStockLedger.findOne({
      franchisePartnerId: partner._id,
      productId: hubProduct._id,
    }).lean();
    expect(ledger.quantity).toBe(3);

    const movement = await FranchiseStockMovement.findOne({
      franchisePartnerId: partner._id,
      type: FRANCHISE_STOCK_TYPES.POS_SALE,
    }).lean();
    expect(movement).toBeTruthy();
    expect(Math.abs(movement.quantity)).toBe(2);
  });

  it("rejects sale when stock is insufficient", async () => {
    const { partner, partnerUser, hubProduct } = await seedPosFixture();

    await expect(
      createPosSale({
        franchisePartnerId: partner._id,
        userId: partnerUser._id,
        items: [{ productId: String(hubProduct._id), quantity: 10 }],
        buyer: { kind: "guest" },
        payment: { method: "cash" },
        idempotencyKey: "test-key-2",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("is idempotent on duplicate Idempotency-Key", async () => {
    const { partner, partnerUser, hubProduct } = await seedPosFixture();

    const first = await createPosSale({
      franchisePartnerId: partner._id,
      userId: partnerUser._id,
      items: [{ productId: String(hubProduct._id), quantity: 1 }],
      buyer: { kind: "guest" },
      payment: { method: "cash" },
      idempotencyKey: "dup-key",
    });

    const second = await createPosSale({
      franchisePartnerId: partner._id,
      userId: partnerUser._id,
      items: [{ productId: String(hubProduct._id), quantity: 1 }],
      buyer: { kind: "guest" },
      payment: { method: "cash" },
      idempotencyKey: "dup-key",
    });

    expect(second.duplicate).toBe(true);
    expect(String(second.order._id)).toBe(String(first.order._id));

    const orderCount = await Order.countDocuments({ isFranchisePosSale: true });
    expect(orderCount).toBe(1);
  });

  it("excludes POS sales from online franchise order inbox", async () => {
    const { partner, partnerUser, hubProduct } = await seedPosFixture();

    await createPosSale({
      franchisePartnerId: partner._id,
      userId: partnerUser._id,
      items: [{ productId: String(hubProduct._id), quantity: 1 }],
      buyer: { kind: "guest" },
      payment: { method: "cash" },
      idempotencyKey: "inbox-key",
    });

    const list = await listFranchisePartnerOrders(partner._id);
    expect(list.total).toBe(0);
  });

  it("settleDeliveredOrder is a no-op for POS sales", async () => {
    const { partner, partnerUser, hubProduct } = await seedPosFixture();

    const { order } = await createPosSale({
      franchisePartnerId: partner._id,
      userId: partnerUser._id,
      items: [{ productId: String(hubProduct._id), quantity: 1 }],
      buyer: { kind: "guest" },
      payment: { method: "cash" },
      idempotencyKey: "settle-key",
    });

    const payoutsBefore = await LedgerEntry.countDocuments({});
    const updated = await settleDeliveredOrder(order._id);
    const payoutsAfter = await LedgerEntry.countDocuments({});

    expect(updated.financeFlags?.deliveredSettlementApplied).toBe(true);
    expect(payoutsAfter).toBe(payoutsBefore);
  });

  it("preview validates hub catalog pricing", async () => {
    const { partner, hubProduct } = await seedPosFixture();
    const preview = await previewPosSale(partner._id, {
      items: [{ productId: String(hubProduct._id), quantity: 1 }],
    });
    expect(preview.grandTotal).toBe(80);
    expect(preview.lineItems[0].unitPrice).toBe(80);
  });
});

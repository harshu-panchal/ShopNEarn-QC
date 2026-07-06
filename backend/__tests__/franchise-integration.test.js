/**
 * Franchise integration tests (Mongo + real services).
 *
 * Covers:
 *   - B2B stock purchase (wallet debit + stock ledger)
 *   - Hub-only customer order routing to franchise partner
 *   - Partner accept / admin dispatch workflow
 *
 * Run: RUN_E2E_TESTS=true REDIS_DISABLED=true npm test -- franchise-integration
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
import CheckoutGroup from "../app/models/checkoutGroup.js";
import FranchisePartner from "../app/models/franchisePartner.js";
import FranchiseStockLedger from "../app/models/franchiseStockLedger.js";
import FranchiseWalletTopUp from "../app/models/franchiseWalletTopUp.js";
import FranchiseRegistrationPayment from "../app/models/franchiseRegistrationPayment.js";
import Cart from "../app/models/cart.js";
import StockHistory from "../app/models/stockHistory.js";
import Delivery from "../app/models/delivery.js";

import {
  OWNER_TYPE,
  LEDGER_TRANSACTION_TYPE,
} from "../app/constants/finance.js";
import {
  FRANCHISE_ORDER_STATUS,
  FRANCHISE_PARTNER_STATUS,
} from "../app/constants/franchise.js";
import { WORKFLOW_STATUS } from "../app/constants/orderWorkflow.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

process.env.REDIS_DISABLED = process.env.REDIS_DISABLED || "true";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "franchise-integration-test-secret";

const { creditWallet } =
  await import("../app/services/finance/walletService.js");
const { purchaseFranchiseStock, getFranchiseStockSummary } =
  await import("../app/services/franchise/franchiseStockService.js");
const { getFranchiseWalletBalance } =
  await import("../app/services/franchise/franchiseWalletService.js");
const { cartIsHubOnly } =
  await import("../app/services/franchise/franchiseCatalogService.js");
const { resolveFranchisePartner } =
  await import("../app/services/franchise/franchiseOrderRoutingService.js");
const { placeOrderAtomic } =
  await import("../app/services/orderPlacementService.js");
const {
  listFranchisePartnerOrders,
  acceptFranchiseOrder,
  createFranchiseOrderShipment,
  assignFranchiseOrderDelivery,
  markFranchiseOrderDeliveredFromWorkflow,
} = await import("../app/services/franchise/franchiseOrderService.js");

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
    CheckoutGroup.deleteMany({}),
    FranchisePartner.deleteMany({}),
    FranchiseStockLedger.deleteMany({}),
    FranchiseWalletTopUp.deleteMany({}),
    FranchiseRegistrationPayment.deleteMany({}),
    Cart.deleteMany({}),
    StockHistory.deleteMany({}),
    Delivery.deleteMany({}),
  ]);
}

async function seedFranchiseFixture() {
  const suffix = randomSuffix();
  const territoryPincode = "380015";

  const partnerUser = await User.create({
    name: "Franchise Partner",
    phone: `8800${suffix.slice(-6)}`,
    role: "user",
    isVerified: true,
  });

  const buyerUser = await User.create({
    name: "Retail Buyer",
    phone: `8810${suffix.slice(-6)}`,
    role: "user",
    isVerified: true,
  });

  const hubSeller = await Seller.create({
    name: "Hub Seller",
    email: `hub_${suffix}@franchise-test.example`,
    phone: `8820${suffix.slice(-6)}`,
    password: "Password@123",
    shopName: "Harsh's Hub Test",
    isVerified: true,
    isActive: true,
    isPlatformHub: true,
    isFranchiseCatalogSource: true,
    applicationStatus: "approved",
    location: {
      type: "Point",
      coordinates: [72.51, 23.03],
    },
  });

  const header = await Category.create({
    name: `Header ${suffix}`,
    slug: `header-${suffix}`,
    type: "header",
    adminCommissionType: "percentage",
    adminCommissionValue: 10,
    handlingFeeType: "fixed",
    handlingFeeValue: 0,
    status: "active",
  });

  const category = await Category.create({
    name: `Category ${suffix}`,
    slug: `category-${suffix}`,
    type: "category",
    parentId: header._id,
    status: "active",
  });

  const subcategory = await Category.create({
    name: `Subcategory ${suffix}`,
    slug: `subcategory-${suffix}`,
    type: "subcategory",
    parentId: category._id,
    status: "active",
  });

  const hubProduct = await Product.create({
    name: "Hub Test Product",
    slug: `hub-product-${suffix}`,
    sku: `HUB-SKU-${suffix}`,
    description: "Franchise integration test product",
    price: 100,
    salePrice: 100,
    stock: 100,
    headerId: header._id,
    categoryId: category._id,
    subcategoryId: subcategory._id,
    sellerId: hubSeller._id,
    status: "active",
  });

  await Setting.create({
    deliveryPricingMode: "distance_based",
    pricingMode: "distance_based",
    customerBaseDeliveryFee: 30,
    riderBasePayout: 30,
    baseDeliveryCharge: 30,
    baseDistanceCapacityKm: 0.5,
    incrementalKmSurcharge: 10,
    deliveryPartnerRatePerKm: 5,
    fleetCommissionRatePerKm: 5,
    fixedDeliveryFee: 30,
    handlingFeeStrategy: "highest_category_fee",
    codEnabled: true,
    onlineEnabled: true,
    homeShoppy: {
      enabled: true,
      walletCreditMultiplier: 2,
    },
  });

  const partner = await FranchisePartner.create({
    userId: partnerUser._id,
    referralCode: `HS${suffix.slice(-6).toUpperCase()}`,
    status: FRANCHISE_PARTNER_STATUS.ACTIVE,
    territoryPincodes: [territoryPincode],
    address: "Shop 12, Main Road",
    locality: "Satellite",
    pincode: territoryPincode,
    city: "Ahmedabad",
    state: "Gujarat",
    hubSellerId: hubSeller._id,
    registeredAt: new Date(),
    displayName: partnerUser.name,
    location: {
      type: "Point",
      coordinates: [72.51, 23.03],
    },
  });

  await creditWallet({
    ownerType: OWNER_TYPE.FRANCHISE,
    ownerId: partner._id,
    amount: 50000,
    ledgerType: LEDGER_TRANSACTION_TYPE.FRANCHISE_WALLET_TOPUP_CREDIT,
    ledgerReference: `test-seed-${suffix}`,
    ledgerDescription: "Integration test seed balance",
    idempotencyKey: `FRANCHISE-TEST-SEED-${suffix}`,
    syncUserWalletBalance: false,
  });

  const deliveryAddress = {
    type: "Home",
    name: buyerUser.name,
    address: "Near franchise territory",
    city: "Ahmedabad",
    pincode: territoryPincode,
    phone: buyerUser.phone,
    location: { lat: 23.03, lng: 72.51 },
  };

  return {
    suffix,
    partnerUser,
    buyerUser,
    hubSeller,
    hubProduct,
    partner,
    deliveryAddress,
    territoryPincode,
  };
}

(RUN_INTEGRATION ? describe : describe.skip)(
  "Franchise integration (Mongo + services)",
  () => {
    let mongoUri;

    beforeAll(async () => {
      mongoUri = process.env.MONGO_URI_E2E || process.env.MONGO_URI;
      if (!mongoUri) {
        throw new Error(
          "Set MONGO_URI_E2E (or MONGO_URI) to run franchise integration tests",
        );
      }

      const dbName = `fr_int_${Date.now().toString(36)}`;
      await mongoose.connect(mongoUri, {
        dbName,
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
      });
    });

    beforeEach(async () => {
      await resetCollections();
    });

    afterAll(async () => {
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.dropDatabase();
        await mongoose.connection.close();
      }
    });

    it("purchases hub stock from franchise wallet and updates stock ledger", async () => {
      const { partnerUser, partner, hubProduct } = await seedFranchiseFixture();

      const beforeWallet = await getFranchiseWalletBalance(partner._id);
      expect(beforeWallet.availableBalance).toBe(50000);

      const result = await purchaseFranchiseStock({
        franchisePartnerId: partner._id,
        userId: partnerUser._id,
        items: [{ productId: hubProduct._id, quantity: 3 }],
      });

      expect(result.totalCost).toBe(300);
      expect(result.lineItems).toHaveLength(1);

      const afterWallet = await getFranchiseWalletBalance(partner._id);
      expect(afterWallet.availableBalance).toBe(49700);

      const stock = await getFranchiseStockSummary(partner._id);
      expect(stock).toHaveLength(1);
      expect(stock[0].quantity).toBe(3);
      expect(String(stock[0].productId)).toBe(String(hubProduct._id));

      const stockOrder = await Order.findById(result.stockOrderId).lean();
      expect(stockOrder.isFranchiseStockOrder).toBe(true);
      expect(String(stockOrder.franchisePartnerId)).toBe(String(partner._id));
    });

    it("rejects stock purchase when wallet balance is insufficient", async () => {
      const { partnerUser, partner, hubProduct } = await seedFranchiseFixture();

      await expect(
        purchaseFranchiseStock({
          franchisePartnerId: partner._id,
          userId: partnerUser._id,
          items: [{ productId: hubProduct._id, quantity: 600 }],
        }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INSUFFICIENT_FRANCHISE_WALLET",
      });
    });

    it("prices hub-only checkout from franchise partner distance, not hub warehouse radius", async () => {
      const fixture = await seedFranchiseFixture();

      await Seller.findByIdAndUpdate(fixture.hubSeller._id, {
        shopName: "Shop N Earn",
        isPlatformHub: true,
        location: { type: "Point", coordinates: [77.5946, 12.9716] },
        serviceRadius: 10,
      });

      const { buildCheckoutPricingSnapshot } =
        await import("../app/services/checkoutPricingService.js");

      const snapshot = await buildCheckoutPricingSnapshot({
        orderItems: [{ product: String(fixture.hubProduct._id), quantity: 1 }],
        address: fixture.deliveryAddress,
        customerId: fixture.buyerUser._id,
      });

      expect(snapshot.sellerCount).toBe(1);
      expect(snapshot.aggregateBreakdown.grandTotal).toBeGreaterThan(0);
      expect(snapshot.isFranchiseHubCart).toBe(true);
      expect(snapshot.sellerBreakdownEntries[0].distanceKm).toBeLessThan(1);
    });

    it("detects franchise hub cart via isPlatformHub when hubSellerId config is unset", async () => {
      const fixture = await seedFranchiseFixture();

      await Seller.findByIdAndUpdate(fixture.hubSeller._id, {
        shopName: "Shop N Earn",
        isPlatformHub: true,
        location: { type: "Point", coordinates: [77.5946, 12.9716] },
        serviceRadius: 10,
      });
      await Setting.updateMany({}, { $set: { homeShoppy: { enabled: true } } });

      const { buildCheckoutPricingSnapshot } =
        await import("../app/services/checkoutPricingService.js");

      await expect(
        buildCheckoutPricingSnapshot({
          orderItems: [
            { product: String(fixture.hubProduct._id), quantity: 1 },
          ],
          address: fixture.deliveryAddress,
          customerId: fixture.buyerUser._id,
        }),
      ).resolves.toMatchObject({ sellerCount: 1 });
    });

    it("routes hub-only retail orders to the nearest active franchise partner", async () => {
      const { buyerUser, hubProduct, partner, deliveryAddress, hubSeller } =
        await seedFranchiseFixture();

      const isHubOnly = await cartIsHubOnly([
        { sellerId: String(hubSeller._id) },
      ]);
      expect(isHubOnly).toBe(true);

      const resolved = await resolveFranchisePartner({
        address: deliveryAddress,
      });
      expect(String(resolved._id)).toBe(String(partner._id));

      const placement = await placeOrderAtomic({
        customerId: buyerUser._id,
        payload: {
          items: [{ product: String(hubProduct._id), quantity: 2 }],
          address: deliveryAddress,
          paymentMode: "COD",
          timeSlot: "now",
          tipAmount: 0,
          discountTotal: 0,
        },
      });

      expect(placement.duplicate).toBe(false);
      expect(placement.order).toBeTruthy();
      expect(String(placement.order.franchisePartnerId)).toBe(
        String(partner._id),
      );
      expect(placement.order.franchiseStatus).toBe(
        FRANCHISE_ORDER_STATUS.PENDING,
      );
      expect(placement.order.workflowStatus).toBe("FRANCHISE_PENDING");
      expect(placement.order.isFranchiseStockOrder).not.toBe(true);

      const stored = await Order.findOne({
        orderId: placement.order.orderId,
      }).lean();
      expect(stored.franchiseRoutedAt).toBeInstanceOf(Date);
    });

    it("does not route mixed-seller carts to a franchise partner", async () => {
      const suffix = randomSuffix();
      const fixture = await seedFranchiseFixture();

      const otherSeller = await Seller.create({
        name: "Other Seller",
        email: `other_${suffix}@franchise-test.example`,
        phone: `8830${suffix.slice(-6)}`,
        password: "Password@123",
        shopName: "Other Shop",
        isVerified: true,
        isActive: true,
        applicationStatus: "approved",
        location: { type: "Point", coordinates: [72.52, 23.04] },
      });

      const otherProduct = await Product.create({
        name: "Non-hub Product",
        slug: `other-product-${suffix}`,
        sku: `OTHER-SKU-${suffix}`,
        description: "Not from hub",
        price: 50,
        salePrice: 50,
        stock: 50,
        headerId: fixture.hubProduct.headerId,
        categoryId: fixture.hubProduct.categoryId,
        subcategoryId: fixture.hubProduct.subcategoryId,
        sellerId: otherSeller._id,
        status: "active",
      });

      const placement = await placeOrderAtomic({
        customerId: fixture.buyerUser._id,
        payload: {
          items: [
            { product: String(fixture.hubProduct._id), quantity: 1 },
            { product: String(otherProduct._id), quantity: 1 },
          ],
          address: fixture.deliveryAddress,
          paymentMode: "COD",
          timeSlot: "now",
        },
      });

      for (const order of placement.orders) {
        expect(order.franchisePartnerId).toBeFalsy();
        expect(order.franchiseStatus).toBeFalsy();
      }
    });

    it("lists retail orders for partner and supports accept → admin dispatch → delivered", async () => {
      const { buyerUser, hubProduct, partner, deliveryAddress, suffix } =
        await seedFranchiseFixture();

      const rider = await Delivery.create({
        name: "Dispatch Rider",
        phone: `8830${suffix.slice(-6)}`,
        role: "delivery",
        isVerified: true,
        isOnline: true,
        location: {
          type: "Point",
          coordinates: [72.51, 23.03],
        },
      });

      const placement = await placeOrderAtomic({
        customerId: buyerUser._id,
        payload: {
          items: [{ product: String(hubProduct._id), quantity: 1 }],
          address: deliveryAddress,
          paymentMode: "COD",
          timeSlot: "now",
        },
      });

      const orderId = placement.order._id;

      const pendingList = await listFranchisePartnerOrders(partner._id, {
        status: "pending",
      });
      expect(pendingList.total).toBe(1);
      expect(String(pendingList.items[0]._id)).toBe(String(orderId));

      const stockOnlyList = await listFranchisePartnerOrders(partner._id);
      const stockOrders = stockOnlyList.items.filter(
        (o) => o.isFranchiseStockOrder,
      );
      expect(stockOrders).toHaveLength(0);

      const accepted = await acceptFranchiseOrder({
        franchisePartnerId: partner._id,
        orderId,
      });
      expect(accepted.franchiseStatus).toBe(FRANCHISE_ORDER_STATUS.ACCEPTED);
      expect(accepted.workflowStatus).toBe(WORKFLOW_STATUS.FRANCHISE_ACCEPTED);
      expect(accepted.status).toBe("confirmed");
      expect(accepted.shipmentStatus).toBe("pending");

      const shipped = await createFranchiseOrderShipment({
        franchisePartnerId: partner._id,
        orderId,
      });
      expect(shipped.shipmentStatus).toBe("created");
      expect(shipped.shipmentReference).toBeTruthy();

      const assigned = await assignFranchiseOrderDelivery({
        orderId: placement.order.orderId,
        deliveryBoyId: rider._id,
        adminId: "admin-test",
      });
      expect(assigned.workflowStatus).toBe(WORKFLOW_STATUS.DELIVERY_ASSIGNED);
      expect(String(assigned.deliveryBoy)).toBe(String(rider._id));

      assigned.workflowStatus = WORKFLOW_STATUS.DELIVERED;
      await markFranchiseOrderDeliveredFromWorkflow(assigned);
      const delivered = await Order.findById(orderId);
      expect(delivered.franchiseStatus).toBe(FRANCHISE_ORDER_STATUS.FULFILLED);

      const fulfilledList = await listFranchisePartnerOrders(partner._id, {
        status: "fulfilled",
      });
      expect(fulfilledList.total).toBe(1);
    });
  },
);

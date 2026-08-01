import mongoose from "mongoose";
import Order from "../../models/order.js";
import FranchisePartner from "../../models/franchisePartner.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import Product from "../../models/product.js";
import Customer from "../../models/customer.js";
import Wallet from "../../models/wallet.js";
import {
  FRANCHISE_PARTNER_STATUS,
  FRANCHISE_ORDER_STATUS,
  FRANCHISE_IDEMPOTENCY_PREFIX,
  FRANCHISE_POS_PAYMENT_METHOD,
  FRANCHISE_POS_BUYER_KIND,
} from "../../constants/franchise.js";
import { FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";
import {
  WORKFLOW_STATUS,
  legacyStatusFromWorkflow,
} from "../../constants/orderWorkflow.js";
import { ORDER_PAYMENT_STATUS } from "../../constants/finance.js";
import { listHubCatalogProducts, isHubProduct } from "./franchiseCatalogService.js";
import { getFranchiseConfig } from "./franchiseConfigService.js";
import { formatFranchiseAddress } from "./franchiseAddressUtils.js";
import { getFranchisePosWalkInUserId } from "./franchisePosGuestService.js";
import { generateUniquePublicOrderId } from "../orderIdService.js";
import { decrementFranchiseStock } from "../inventory/inventoryMovementService.js";
import { freezeFinancialSnapshot } from "../finance/orderFinanceService.js";
import { resolveSellingPrice } from "../../utils/productStockUtils.js";
import { normalizePhoneNumber } from "../../utils/phone.js";

function roundCurrency(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function assertPosEnabled() {
  const cfg = await getFranchiseConfig();
  if (!cfg.enabled) {
    const err = new Error("Home Shoppy franchise is not enabled");
    err.statusCode = 503;
    throw err;
  }
  if (!cfg.posEnabled) {
    const err = new Error("Franchise POS is not enabled for this platform");
    err.statusCode = 403;
    err.code = "POS_DISABLED";
    throw err;
  }
  return cfg;
}

async function loadActivePartnerForUser(userId) {
  const partner = await FranchisePartner.findOne({ userId }).lean();
  if (!partner) {
    const err = new Error("Not a franchise partner");
    err.statusCode = 404;
    throw err;
  }
  if (partner.status !== FRANCHISE_PARTNER_STATUS.ACTIVE) {
    const err = new Error("Franchise partner account is not active");
    err.statusCode = 403;
    err.code = "PARTNER_NOT_ACTIVE";
    throw err;
  }
  return partner;
}

async function ledgerQtyMap(franchisePartnerId, productIds = []) {
  if (!productIds.length) return new Map();
  const rows = await FranchiseStockLedger.find({
    franchisePartnerId,
    productId: { $in: productIds },
  })
    .select("productId quantity")
    .lean();
  return new Map(rows.map((r) => [String(r.productId), Number(r.quantity) || 0]));
}

function normalizeCartItems(items = []) {
  const merged = new Map();
  for (const line of items) {
    const productId = String(line?.productId || line?.product || "").trim();
    if (!productId) continue;
    const qty = Math.max(1, Math.floor(Number(line?.quantity) || 1));
    merged.set(productId, (merged.get(productId) || 0) + qty);
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

async function hydrateHubProducts(productIds) {
  if (!productIds.length) return new Map();
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  return new Map(products.map((p) => [String(p._id), p]));
}

export async function listPosProducts(franchisePartnerId, { q, page, limit } = {}) {
  await assertPosEnabled();

  const partnerOid = mongoose.Types.ObjectId.isValid(franchisePartnerId)
    ? new mongoose.Types.ObjectId(franchisePartnerId)
    : franchisePartnerId;

  // 1. Fetch all products held in stock by this franchise partner in stock ledger (quantity > 0)
  const inStockLedgers = await FranchiseStockLedger.find({
    franchisePartnerId: { $in: [partnerOid, String(franchisePartnerId)] },
    quantity: { $gt: 0 },
  }).lean();

  const inStockProductIds = inStockLedgers.map((l) => l.productId);
  const inStockProductsMap = new Map();
  if (inStockProductIds.length > 0) {
    const prods = await Product.find({ _id: { $in: inStockProductIds } }).lean();
    prods.forEach((p) => inStockProductsMap.set(String(p._id), p));
  }

  // 2. Fetch hub catalog products
  const catalog = await listHubCatalogProducts({ page, limit, q });

  // 3. Merge in-stock products with catalog products
  const productMap = new Map();

  for (const [id, product] of inStockProductsMap.entries()) {
    productMap.set(id, product);
  }

  catalog.items.forEach((p) => {
    productMap.set(String(p._id), p);
  });

  const allProductIds = Array.from(productMap.keys());
  const onHand = await ledgerQtyMap(franchisePartnerId, allProductIds);

  let items = Array.from(productMap.values()).map((product) => {
    const id = String(product._id);
    const onHandQty = onHand.get(id) || 0;
    const unitPrice = resolveSellingPrice(product);
    const name = product.name || product.productName || product.title || "Unnamed Product";
    return {
      ...product,
      name,
      onHandQty,
      unitPrice,
      canSell: onHandQty > 0,
    };
  });

  // 4. Search query filter
  if (q && typeof q === "string" && q.trim()) {
    const searchTerm = q.trim().toLowerCase();
    items = items.filter((p) => {
      const nameMatch = (p.name || p.productName || p.title || "").toLowerCase().includes(searchTerm);
      const descMatch = (p.description || "").toLowerCase().includes(searchTerm);
      const skuMatch = (p.sku || "").toLowerCase().includes(searchTerm);
      const brandMatch = (p.brand || "").toLowerCase().includes(searchTerm);
      return nameMatch || descMatch || skuMatch || brandMatch;
    });
  }

  // 5. Sort: In-stock (onHandQty > 0) first, then higher onHandQty, then name
  items.sort((a, b) => {
    if (a.canSell !== b.canSell) return a.canSell ? -1 : 1;
    if (b.onHandQty !== a.onHandQty) return b.onHandQty - a.onHandQty;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return {
    ...catalog,
    items,
    total: items.length,
  };
}

export async function previewPosSale(franchisePartnerId, { items }) {
  await assertPosEnabled();
  const lines = normalizeCartItems(items);
  if (lines.length === 0) {
    const err = new Error("Cart is empty");
    err.statusCode = 400;
    throw err;
  }

  const productMap = await hydrateHubProducts(lines.map((l) => l.productId));
  const onHand = await ledgerQtyMap(
    franchisePartnerId,
    lines.map((l) => l.productId),
  );

  let subtotal = 0;
  const lineItems = [];
  for (const line of lines) {
    const hubOk = await isHubProduct(line.productId);
    if (!hubOk) {
      const err = new Error("Product is not available in hub catalog");
      err.statusCode = 422;
      throw err;
    }
    const product = productMap.get(line.productId);
    if (!product) {
      const err = new Error("Product not found");
      err.statusCode = 404;
      throw err;
    }
    const available = onHand.get(line.productId) || 0;
    if (line.quantity > available) {
      const err = new Error(
        `Insufficient stock for ${product.name || "product"} (on hand: ${available})`,
      );
      err.statusCode = 422;
      err.code = "INSUFFICIENT_STOCK";
      throw err;
    }
    const unitPrice = resolveSellingPrice(product);
    const lineTotal = roundCurrency(unitPrice * line.quantity);
    subtotal += lineTotal;
    lineItems.push({
      productId: line.productId,
      name: product.name,
      quantity: line.quantity,
      unitPrice,
      lineTotal,
      onHandQty: available,
    });
  }

  return {
    lineItems,
    subtotal: roundCurrency(subtotal),
    grandTotal: roundCurrency(subtotal),
  };
}

function buildPosPaymentBreakdown(grandTotal) {
  const total = roundCurrency(grandTotal);
  return {
    productSubtotal: total,
    grandTotal: total,
    sellerPayoutTotal: 0,
    adminProductCommissionTotal: 0,
    deliveryFee: 0,
    tipTotal: 0,
    walletAmount: 0,
    codCollectedAmount: total,
    codPendingAmount: 0,
    snapshots: {
      deliverySettings: {},
      categoryCommissionSettings: [],
      handlingFeeStrategy: null,
      handlingCategoryUsed: {},
    },
  };
}

function buildReceiptDto(order, partner) {
  const lines = (order.items || []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.price,
    lineTotal: roundCurrency(item.price * item.quantity),
  }));
  const grandTotal = roundCurrency(
    order.paymentBreakdown?.grandTotal ?? order.pricing?.total ?? 0,
  );
  return {
    orderId: order.orderId,
    soldAt: order.deliveredAt || order.createdAt,
    partner: {
      displayName: partner.displayName || "",
      referralCode: partner.referralCode || "",
      address: formatFranchiseAddress(partner),
      phone: partner.phone || "",
    },
    buyer: order.posBuyer || {},
    paymentMethod: order.posPaymentMethod,
    upiReference: order.posUpiReference || "",
    lines,
    grandTotal,
    footerNote: "Goods sold at franchise store — not for online delivery.",
  };
}

export async function lookupPosCustomerByPhone(rawQuery) {
  await assertPosEnabled();
  const q = String(rawQuery || "").trim();
  if (!q) {
    const err = new Error("Phone number or Customer ID is required");
    err.statusCode = 400;
    throw err;
  }

  const searchConditions = [];

  // Check Mongo ObjectId
  if (mongoose.Types.ObjectId.isValid(q)) {
    searchConditions.push({ _id: new mongoose.Types.ObjectId(q) });
  }

  // Check Customer ID / referralCode (case-insensitive)
  const codeRegex = new RegExp(`^${q}$`, "i");
  searchConditions.push({ userId: codeRegex });
  searchConditions.push({ referralCode: codeRegex });
  searchConditions.push({ "mlm.referralCode": codeRegex });

  // Check Phone number
  const phone = normalizePhoneNumber(q);
  if (phone) {
    const phoneDigits = phone.replace(/^\+91/, "");
    const phoneRegex = new RegExp(phoneDigits + "$");
    searchConditions.push({ phone: phoneRegex });
    searchConditions.push({ phone: phone });
    searchConditions.push({ phone: `+91${phoneDigits}` });
  } else if (q.replace(/\D/g, "").length >= 5) {
    const digits = q.replace(/\D/g, "");
    searchConditions.push({ phone: new RegExp(digits + "$") });
  }

  const user = await Customer.findOne({ $or: searchConditions })
    .select("_id name phone userId referralCode shoppingWallet earningWallet wallet")
    .lean();

  if (!user) {
    const err = new Error("No registered customer found for this Phone or Customer ID");
    err.statusCode = 404;
    throw err;
  }

  // Fetch balances from Wallet collection
  const walletDoc = await Wallet.findOne({ ownerId: user._id }).lean();

  const shoppingWallet = Number(
    walletDoc?.shoppingBalance !== undefined ? walletDoc.shoppingBalance : (user.shoppingWallet || 0)
  );
  const earningWallet = Number(
    walletDoc?.earningsBalance !== undefined ? walletDoc.earningsBalance : (user.earningWallet || user.wallet || 0)
  );

  return {
    id: user._id,
    name: user.name || "",
    phone: user.phone || q,
    userId: user.userId || "",
    shoppingWallet,
    earningWallet,
  };
}

async function resolveBuyerCustomerId(buyer) {
  const kind = String(buyer?.kind || "").toLowerCase();
  if (kind === FRANCHISE_POS_BUYER_KIND.REGISTERED) {
    const customerId = buyer?.customerId;
    if (!customerId) {
      const err = new Error("customerId is required for registered buyer");
      err.statusCode = 400;
      throw err;
    }
    const user = await Customer.findById(customerId).select("_id name phone").lean();
    if (!user) {
      const err = new Error("Registered customer not found");
      err.statusCode = 404;
      throw err;
    }
    return {
      orderCustomerId: user._id,
      posBuyer: {
        kind: FRANCHISE_POS_BUYER_KIND.REGISTERED,
        name: user.name || buyer.name || "",
        phone: user.phone || "",
        customerId: user._id,
      },
    };
  }

  const walkInId = await getFranchisePosWalkInUserId();
  return {
    orderCustomerId: walkInId,
    posBuyer: {
      kind: FRANCHISE_POS_BUYER_KIND.GUEST,
      name: String(buyer?.name || "").trim().slice(0, 120),
      phone: normalizePhoneNumber(buyer?.phone || ""),
      customerId: null,
    },
  };
}

function normalizeIdempotencyKey(franchisePartnerId, clientKey) {
  const key = String(clientKey || "").trim();
  if (!key) {
    const err = new Error("Idempotency-Key header is required");
    err.statusCode = 400;
    throw err;
  }
  return `${FRANCHISE_IDEMPOTENCY_PREFIX.POS_SALE}-${franchisePartnerId}-${key}`;
}

export async function createPosSale({
  franchisePartnerId,
  userId,
  items,
  buyer,
  payment,
  idempotencyKey: clientIdempotencyKey,
}) {
  await assertPosEnabled();
  const partner = await FranchisePartner.findById(franchisePartnerId);
  if (!partner || String(partner.userId) !== String(userId)) {
    const err = new Error("Franchise partner not found");
    err.statusCode = 404;
    throw err;
  }
  if (partner.status !== FRANCHISE_PARTNER_STATUS.ACTIVE) {
    const err = new Error("Franchise partner account is not active");
    err.statusCode = 403;
    throw err;
  }

  const idempotencyKey = normalizeIdempotencyKey(franchisePartnerId, clientIdempotencyKey);
  const existing = await Order.findOne({
    franchisePartnerId,
    isFranchisePosSale: true,
    "placement.idempotencyKey": idempotencyKey,
  }).lean();
  if (existing) {
    const full = await Order.findById(existing._id);
    return { order: full, receipt: buildReceiptDto(full, partner), duplicate: true };
  }

  const preview = await previewPosSale(franchisePartnerId, { items });
  const paymentMethod = String(payment?.method || "").toLowerCase();
  const selectedWalletType = String(payment?.walletType || "SHOPPING").toUpperCase();
  if (
    paymentMethod !== FRANCHISE_POS_PAYMENT_METHOD.CASH &&
    paymentMethod !== FRANCHISE_POS_PAYMENT_METHOD.UPI_PARTNER &&
    paymentMethod !== "wallet"
  ) {
    const err = new Error("Invalid POS payment method");
    err.statusCode = 400;
    throw err;
  }

  const { orderCustomerId, posBuyer } = await resolveBuyerCustomerId(buyer || { kind: "guest" });
  const upiRef =
    paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.UPI_PARTNER
      ? String(payment?.upiReference || "").trim().slice(0, 120)
      : "";

  const session = await mongoose.startSession();
  let createdOrder;

  try {
    await session.withTransaction(async () => {
      if (paymentMethod === "wallet") {
        if (!posBuyer || posBuyer.kind !== FRANCHISE_POS_BUYER_KIND.REGISTERED || !orderCustomerId) {
          const err = new Error("Registered customer is required for wallet payment");
          err.statusCode = 400;
          throw err;
        }

        const walletDoc = await Wallet.findOne({ ownerId: orderCustomerId }).session(session);
        const walletField = selectedWalletType === "EARNING" ? "earningsBalance" : "shoppingBalance";

        let currentBal = 0;
        if (walletDoc) {
          currentBal = Number(walletDoc[walletField] || 0);
        } else {
          const cust = await Customer.findById(orderCustomerId).session(session);
          if (cust) {
            currentBal = Number(cust[selectedWalletType === "EARNING" ? "earningWallet" : "shoppingWallet"] || 0);
          }
        }

        if (currentBal < preview.grandTotal) {
          const err = new Error(
            `Insufficient customer ${selectedWalletType === "EARNING" ? "Earning Wallet" : "Shopping Wallet"} balance (available: ₹${currentBal}, total: ₹${preview.grandTotal})`
          );
          err.statusCode = 422;
          throw err;
        }

        if (walletDoc) {
          walletDoc[walletField] = currentBal - preview.grandTotal;
          walletDoc.totalDebited = Number(walletDoc.totalDebited || 0) + preview.grandTotal;
          await walletDoc.save({ session });
        } else {
          const cust = await Customer.findById(orderCustomerId).session(session);
          if (cust) {
            const field = selectedWalletType === "EARNING" ? "earningWallet" : "shoppingWallet";
            cust[field] = Math.max(0, Number(cust[field] || 0) - preview.grandTotal);
            await cust.save({ session });
          }
        }
      }

      const publicOrderId = await generateUniquePublicOrderId({ session });
      const now = new Date();
      const storeAddress = formatFranchiseAddress(partner);

      const order = new Order({
        orderId: publicOrderId,
        customer: orderCustomerId,
        seller: partner.hubSellerId,
        items: preview.lineItems.map((line) => ({
          product: line.productId,
          name: line.name,
          quantity: line.quantity,
          price: line.unitPrice,
        })),
        address: {
          type: "Work",
          name: partner.displayName || "Franchise Store",
          address: storeAddress || "Franchise store",
        },
        paymentMode: "COD",
        paymentStatus: ORDER_PAYMENT_STATUS.PAID,
        payment: {
          method: "cash",
          status: "completed",
        },
        pricing: {
          total: preview.grandTotal,
          grandTotal: preview.grandTotal,
        },
        status: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
        orderStatus: legacyStatusFromWorkflow(WORKFLOW_STATUS.DELIVERED),
        workflowStatus: WORKFLOW_STATUS.DELIVERED,
        workflowVersion: 2,
        deliveredAt: now,
        franchisePartnerId: partner._id,
        franchiseStatus: FRANCHISE_ORDER_STATUS.FULFILLED,
        franchiseStockConsumed: false,
        isFranchisePosSale: true,
        isFranchiseStockOrder: false,
        posPaymentMethod: paymentMethod,
        posUpiReference: upiRef || null,
        posBuyer,
        placement: {
          idempotencyKey,
          createdFrom: "FRANCHISE_POS",
        },
        financeFlags: {
          deliveredSettlementApplied: true,
          posSaleNoPlatformSettlement: true,
        },
        settlementStatus: {
          overall: "COMPLETED",
          sellerPayout: "NOT_APPLICABLE",
          riderPayout: "NOT_APPLICABLE",
          adminEarningCredited: false,
        },
        mlmBonusesDisbursed: true,
      });

      freezeFinancialSnapshot(order, buildPosPaymentBreakdown(preview.grandTotal));
      await order.save({ session });

      for (const line of preview.lineItems) {
        await decrementFranchiseStock({
          franchisePartnerId: partner._id,
          productId: line.productId,
          quantity: line.quantity,
          session,
          type: FRANCHISE_STOCK_TYPES.POS_SALE,
          note: `POS sale #${publicOrderId}`,
          orderId: order._id,
          createdBy: userId,
        });
      }

      order.franchiseStockConsumed = true;
      await order.save({ session });
      createdOrder = order;
    });
  } finally {
    await session.endSession();
  }

  return {
    order: createdOrder,
    receipt: buildReceiptDto(createdOrder, partner),
    duplicate: false,
  };
}

export async function listPosSales(
  franchisePartnerId,
  { page = 1, limit = 25, startDate, endDate } = {},
) {
  await assertPosEnabled();
  const safePage = parsePositiveInt(page, 1);
  const safeLimit = Math.min(parsePositiveInt(limit, 25), 100);
  const skip = (safePage - 1) * safeLimit;
  const query = { franchisePartnerId, isFranchisePosSale: true };
  const createdAt = buildPosDateQuery(startDate, endDate);
  if (createdAt) query.createdAt = createdAt;

  const [items, total] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .select(
        "orderId createdAt deliveredAt posPaymentMethod posUpiReference posBuyer paymentBreakdown pricing items",
      )
      .lean(),
    Order.countDocuments(query),
  ]);

  const mapped = items.map((row) => ({
    orderId: row.orderId,
    createdAt: row.createdAt,
    paymentMethod: row.posPaymentMethod,
    buyer: row.posBuyer,
    grandTotal: roundCurrency(
      row.paymentBreakdown?.grandTotal ?? row.pricing?.total ?? 0,
    ),
    itemCount: (row.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0),
  }));

  return {
    items: mapped,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export async function getPosSaleReceipt(franchisePartnerId, orderLookupId) {
  await assertPosEnabled();
  const partner = await FranchisePartner.findById(franchisePartnerId).lean();
  if (!partner) {
    const err = new Error("Franchise partner not found");
    err.statusCode = 404;
    throw err;
  }

  const lookup = String(orderLookupId || "").trim();
  const query = {
    franchisePartnerId,
    isFranchisePosSale: true,
  };
  if (mongoose.Types.ObjectId.isValid(lookup) && String(new mongoose.Types.ObjectId(lookup)) === lookup) {
    query.$or = [{ orderId: lookup }, { _id: lookup }];
  } else {
    query.orderId = lookup;
  }
  const order = await Order.findOne(query)
    .populate("items.product", "name mainImage")
    .lean();
  if (!order) {
    const err = new Error("POS sale not found");
    err.statusCode = 404;
    throw err;
  }
  return buildReceiptDto(order, partner);
}

function paymentMethodLabel(method) {
  if (method === FRANCHISE_POS_PAYMENT_METHOD.UPI_PARTNER) return "UPI (partner)";
  if (method === FRANCHISE_POS_PAYMENT_METHOD.CASH) return "Cash";
  return method || "—";
}

function formatInr(amount) {
  return `INR ${Number(amount || 0).toFixed(2)}`;
}

/**
 * Downloadable PDF invoice for a single POS sale.
 */
export async function getPosSaleInvoicePdf(franchisePartnerId, orderLookupId) {
  const PDFDocument = (await import("pdfkit")).default;
  const receipt = await getPosSaleReceipt(franchisePartnerId, orderLookupId);
  const soldAt = receipt.soldAt
    ? new Date(receipt.soldAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks = [];

  const bufferPromise = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = 50;
  const pageWidth = doc.page.width - 100;

  doc.fontSize(18).font("Helvetica-Bold").text(receipt.partner?.displayName || "Franchise Store", left, 50, {
    width: pageWidth,
  });
  doc.moveDown(0.3);
  doc.fontSize(10).font("Helvetica").fillColor("#475569");
  if (receipt.partner?.address) {
    doc.text(receipt.partner.address, { width: pageWidth });
  }
  if (receipt.partner?.referralCode) {
    doc.text(`Partner code: ${receipt.partner.referralCode}`);
  }
  if (receipt.partner?.phone) {
    doc.text(`Phone: ${receipt.partner.phone}`);
  }

  doc.moveDown(1);
  doc.fillColor("#0f172a").fontSize(14).font("Helvetica-Bold").text("TAX INVOICE / BILL");
  doc.moveDown(0.4);
  doc.fontSize(10).font("Helvetica");
  doc.text(`Bill #: ${receipt.orderId}`);
  doc.text(`Date: ${soldAt}`);

  if (receipt.buyer?.name || receipt.buyer?.phone) {
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").text("Customer");
    doc.font("Helvetica");
    if (receipt.buyer?.name) doc.text(receipt.buyer.name);
    if (receipt.buyer?.phone) doc.text(receipt.buyer.phone);
  }

  doc.moveDown(1);
  const tableTop = doc.y;
  const colItem = left;
  const colQty = left + 250;
  const colRate = left + 310;
  const colAmt = left + 400;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#64748b");
  doc.text("ITEM", colItem, tableTop, { width: 240 });
  doc.text("QTY", colQty, tableTop, { width: 50, align: "center" });
  doc.text("RATE", colRate, tableTop, { width: 80, align: "right" });
  doc.text("AMOUNT", colAmt, tableTop, { width: 90, align: "right" });
  doc
    .moveTo(left, tableTop + 14)
    .lineTo(left + pageWidth, tableTop + 14)
    .strokeColor("#e2e8f0")
    .stroke();

  let y = tableTop + 22;
  doc.font("Helvetica").fontSize(10).fillColor("#0f172a");

  for (const line of receipt.lines || []) {
    const nameHeight = doc.heightOfString(String(line.name || "Item"), {
      width: 240,
    });
    const rowHeight = Math.max(16, nameHeight);

    if (y + rowHeight > doc.page.height - 100) {
      doc.addPage();
      y = 50;
    }

    doc.text(String(line.name || "Item"), colItem, y, { width: 240 });
    doc.text(String(Number(line.quantity) || 0), colQty, y, {
      width: 50,
      align: "center",
    });
    doc.text(formatInr(line.unitPrice), colRate, y, { width: 80, align: "right" });
    doc.text(formatInr(line.lineTotal), colAmt, y, { width: 90, align: "right" });
    y += rowHeight + 8;
  }

  doc
    .moveTo(left, y)
    .lineTo(left + pageWidth, y)
    .strokeColor("#e2e8f0")
    .stroke();
  y += 12;

  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("TOTAL", left, y, { width: 300 });
  doc.text(formatInr(receipt.grandTotal), colAmt, y, { width: 90, align: "right" });
  y += 24;

  doc.font("Helvetica").fontSize(10);
  let paymentLine = `Payment: ${paymentMethodLabel(receipt.paymentMethod)}`;
  if (receipt.upiReference) paymentLine += `  |  Ref: ${receipt.upiReference}`;
  doc.text(paymentLine, left, y, { width: pageWidth });
  y += 28;

  doc.fontSize(9).fillColor("#94a3b8").text(receipt.footerNote || "", left, y, {
    width: pageWidth,
    align: "center",
  });

  doc.end();
  const buffer = await bufferPromise;

  return {
    buffer,
    fileName: `pos-invoice-${receipt.orderId}.pdf`,
    orderId: receipt.orderId,
  };
}

function buildPosDateQuery(startDate, endDate) {
  if (!startDate && !endDate) return null;
  const createdAt = {};
  if (startDate) {
    const start = new Date(startDate);
    if (!Number.isNaN(start.getTime())) createdAt.$gte = start;
  }
  if (endDate) {
    const end = new Date(endDate);
    if (!Number.isNaN(end.getTime())) {
      // Include the full end calendar day when a date-only string is provided.
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(endDate).trim())) {
        end.setHours(23, 59, 59, 999);
      }
      createdAt.$lte = end;
    }
  }
  return Object.keys(createdAt).length ? createdAt : null;
}

/**
 * Excel workbook of all POS sales for a partner (optional date range).
 */
export async function exportPosSalesExcel(
  franchisePartnerId,
  { startDate, endDate } = {},
) {
  await assertPosEnabled();
  const ExcelJS = (await import("exceljs")).default;

  const query = { franchisePartnerId, isFranchisePosSale: true };
  const createdAt = buildPosDateQuery(startDate, endDate);
  if (createdAt) query.createdAt = createdAt;

  const orders = await Order.find(query)
    .sort({ createdAt: -1 })
    .select(
      "orderId createdAt deliveredAt posPaymentMethod posUpiReference posBuyer paymentBreakdown pricing items",
    )
    .lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Home Shoppy POS";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("POS Summary");
  summary.columns = [
    { header: "Bill #", key: "orderId", width: 16 },
    { header: "Date", key: "date", width: 22 },
    { header: "Buyer name", key: "buyerName", width: 22 },
    { header: "Buyer phone", key: "buyerPhone", width: 16 },
    { header: "Buyer type", key: "buyerKind", width: 12 },
    { header: "Payment", key: "payment", width: 14 },
    { header: "UPI ref", key: "upiRef", width: 18 },
    { header: "Items", key: "itemCount", width: 10 },
    { header: "Total (₹)", key: "total", width: 12 },
  ];
  summary.getRow(1).font = { bold: true };

  let revenue = 0;
  for (const order of orders) {
    const total = roundCurrency(
      order.paymentBreakdown?.grandTotal ?? order.pricing?.total ?? 0,
    );
    revenue += total;
    summary.addRow({
      orderId: order.orderId,
      date: order.deliveredAt || order.createdAt,
      buyerName: order.posBuyer?.name || "",
      buyerPhone: order.posBuyer?.phone || "",
      buyerKind: order.posBuyer?.kind || "guest",
      payment: paymentMethodLabel(order.posPaymentMethod),
      upiRef: order.posUpiReference || "",
      itemCount: (order.items || []).reduce(
        (sum, item) => sum + (Number(item.quantity) || 0),
        0,
      ),
      total,
    });
  }
  summary.getColumn("total").numFmt = "#,##0.00";
  summary.getColumn("date").numFmt = "dd-mmm-yyyy hh:mm";

  const linesSheet = workbook.addWorksheet("Line Items");
  linesSheet.columns = [
    { header: "Bill #", key: "orderId", width: 16 },
    { header: "Date", key: "date", width: 22 },
    { header: "Product", key: "product", width: 32 },
    { header: "Qty", key: "qty", width: 8 },
    { header: "Unit price (₹)", key: "unitPrice", width: 14 },
    { header: "Line total (₹)", key: "lineTotal", width: 14 },
    { header: "Payment", key: "payment", width: 14 },
  ];
  linesSheet.getRow(1).font = { bold: true };

  for (const order of orders) {
    for (const item of order.items || []) {
      const qty = Number(item.quantity) || 0;
      const unitPrice = Number(item.price) || 0;
      linesSheet.addRow({
        orderId: order.orderId,
        date: order.deliveredAt || order.createdAt,
        product: item.name || "",
        qty,
        unitPrice,
        lineTotal: roundCurrency(unitPrice * qty),
        payment: paymentMethodLabel(order.posPaymentMethod),
      });
    }
  }
  linesSheet.getColumn("unitPrice").numFmt = "#,##0.00";
  linesSheet.getColumn("lineTotal").numFmt = "#,##0.00";
  linesSheet.getColumn("date").numFmt = "dd-mmm-yyyy hh:mm";

  const meta = workbook.addWorksheet("Export Info");
  meta.addRow(["Exported at", new Date().toISOString()]);
  meta.addRow(["Total bills", orders.length]);
  meta.addRow(["Total revenue (₹)", Math.round(revenue * 100) / 100]);
  meta.addRow(["Start date", startDate || ""]);
  meta.addRow(["End date", endDate || ""]);

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    buffer,
    fileName: `pos-sales-report-${stamp}.xlsx`,
    totalSales: orders.length,
    totalRevenue: Math.round(revenue * 100) / 100,
  };
}

export async function assertPartnerCanUsePos(userId) {
  await assertPosEnabled();
  return loadActivePartnerForUser(userId);
}

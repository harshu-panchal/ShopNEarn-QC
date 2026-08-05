import mongoose from "mongoose";
import Order from "../../models/order.js";
import FranchisePartner from "../../models/franchisePartner.js";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import Product from "../../models/product.js";
import Customer from "../../models/customer.js";
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
import {
  ORDER_PAYMENT_STATUS,
  OWNER_TYPE,
  LEDGER_TRANSACTION_TYPE,
} from "../../constants/finance.js";
import { creditWallet, debitWallet, getOrCreateWallet } from "../finance/walletService.js";
import { listHubCatalogProducts, isHubProduct } from "./franchiseCatalogService.js";
import { getFranchiseConfig } from "./franchiseConfigService.js";
import { formatFranchiseAddress } from "./franchiseAddressUtils.js";
import { getFranchisePosWalkInUserId } from "./franchisePosGuestService.js";
import { generateUniquePublicOrderId } from "../orderIdService.js";
import {
  decrementFranchiseStock,
  incrementFranchiseStock,
} from "../inventory/inventoryMovementService.js";
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

  // 1. Fetch all stock ledger rows for this franchise partner with quantity > 0
  const stockRows = await FranchiseStockLedger.find({
    franchisePartnerId,
    quantity: { $gt: 0 },
  }).lean();

  const inStockQtyMap = new Map(
    stockRows.map((r) => [String(r.productId), Number(r.quantity) || 0]),
  );
  const inStockProductIds = Array.from(inStockQtyMap.keys());

  // 2. Hydrate full product details for all in-stock products
  let inStockProducts = [];
  if (inStockProductIds.length > 0) {
    const query = { _id: { $in: inStockProductIds } };
    if (q) {
      const rx = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ name: rx }, { description: rx }];
    }
    inStockProducts = await Product.find(query).lean();
  }

  // 3. Fetch hub catalog products for broader catalog browsing / search
  const catalog = await listHubCatalogProducts({ page: page || 1, limit: limit || 100, q });

  // 4. Also fetch stock levels for catalog items
  const catalogProductIds = catalog.items.map((p) => p._id);
  const catalogOnHand = await ledgerQtyMap(franchisePartnerId, catalogProductIds);

  for (const [pId, qty] of catalogOnHand.entries()) {
    if (!inStockQtyMap.has(pId)) {
      inStockQtyMap.set(pId, qty);
    }
  }

  // 5. Merge in-stock products and catalog items into a unique map by product ID
  const mergedMap = new Map();

  for (const prod of inStockProducts) {
    mergedMap.set(String(prod._id), prod);
  }

  for (const prod of catalog.items) {
    const id = String(prod._id);
    if (!mergedMap.has(id)) {
      mergedMap.set(id, prod);
    }
  }

  // 6. Format products with onHandQty, unitPrice, and canSell
  const items = Array.from(mergedMap.values())
    .map((product) => {
      const id = String(product._id);
      const onHandQty = inStockQtyMap.get(id) || 0;
      const unitPrice = resolveSellingPrice(product);
      return {
        ...product,
        onHandQty,
        unitPrice,
        canSell: onHandQty > 0,
      };
    })
    .sort((a, b) => {
      // In-stock (on hand) products first, then higher qty, then name.
      if (a.canSell !== b.canSell) return a.canSell ? -1 : 1;
      if (b.onHandQty !== a.onHandQty) return b.onHandQty - a.onHandQty;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  return { ...catalog, items, total: items.length };
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
    const available = onHand.get(line.productId) || 0;
    const hubOk = available > 0 || (await isHubProduct(line.productId));
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

export async function lookupPosCustomerByPhone(rawPhone) {
  await assertPosEnabled();
  const phone = normalizePhoneNumber(rawPhone);
  if (!phone || phone.length < 10) {
    const err = new Error("Valid phone number is required");
    err.statusCode = 400;
    throw err;
  }
  const user = await Customer.findOne({ phone }).select("_id name phone").lean();
  if (!user) {
    const err = new Error("No registered customer found for this phone");
    err.statusCode = 404;
    throw err;
  }
  const wallet = await getOrCreateWallet(OWNER_TYPE.CUSTOMER, user._id);
  return {
    id: user._id,
    name: user.name || "",
    phone: user.phone || phone,
    shoppingWalletBalance: wallet?.shoppingBalance || 0,
    earningsWalletBalance: wallet?.earningsBalance || 0,
    availableWalletBalance: wallet?.availableBalance || 0,
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
  const validMethods = Object.values(FRANCHISE_POS_PAYMENT_METHOD);
  if (!validMethods.includes(paymentMethod)) {
    const err = new Error("Invalid POS payment method");
    err.statusCode = 400;
    throw err;
  }

  const { orderCustomerId, posBuyer } = await resolveBuyerCustomerId(buyer || { kind: "guest" });

  if (
    (paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
      paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET) &&
    (posBuyer.kind !== FRANCHISE_POS_BUYER_KIND.REGISTERED || !posBuyer.customerId)
  ) {
    const err = new Error("Wallet payment requires selecting a registered customer");
    err.statusCode = 400;
    throw err;
  }

  const upiRef =
    paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.UPI_PARTNER
      ? String(payment?.upiReference || "").trim().slice(0, 120)
      : "";

  const session = await mongoose.startSession();
  let createdOrder;

  try {
    await session.withTransaction(async () => {
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
        paymentMode:
          paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
          paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET
            ? "WALLET"
            : "COD",
        paymentStatus: ORDER_PAYMENT_STATUS.PAID,
        payment: {
          method: paymentMethod,
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

      if (
        paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
        paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET
      ) {
        const bucket =
          paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET
            ? "shopping"
            : "earnings";
        await debitWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: posBuyer.customerId,
          amount: preview.grandTotal,
          bucket,
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,
          ledgerReference: publicOrderId,
          ledgerDescription: `POS sale #${publicOrderId} payment via ${bucket === "shopping" ? "Shopping" : "Earning"} Wallet`,
          orderId: order._id,
          idempotencyKey: `${idempotencyKey}-wallet-debit`,
        });
      }

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

export async function updatePosSale({
  franchisePartnerId,
  orderId,
  userId,
  items,
  buyer,
  payment,
  reason,
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

  const order = await Order.findOne({
    orderId,
    franchisePartnerId: partner._id,
    isFranchisePosSale: true,
  });

  if (!order) {
    const err = new Error("POS bill not found");
    err.statusCode = 404;
    throw err;
  }

  const paymentMethod = String(payment?.method || "").toLowerCase();
  const validMethods = Object.values(FRANCHISE_POS_PAYMENT_METHOD);
  if (!validMethods.includes(paymentMethod)) {
    const err = new Error("Invalid POS payment method");
    err.statusCode = 400;
    throw err;
  }

  const { orderCustomerId, posBuyer } = await resolveBuyerCustomerId(buyer || { kind: "guest" });

  if (
    (paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
      paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET) &&
    (posBuyer.kind !== FRANCHISE_POS_BUYER_KIND.REGISTERED || !posBuyer.customerId)
  ) {
    const err = new Error("Wallet payment requires selecting a registered customer");
    err.statusCode = 400;
    throw err;
  }

  const preview = await previewPosSale(partner._id, { items });

  // 1. Calculate stock deltas per product between old items and new items
  const oldItemMap = new Map();
  for (const oldLine of order.items || []) {
    const pId = String(oldLine.product || oldLine.productId);
    oldItemMap.set(pId, (oldItemMap.get(pId) || 0) + Number(oldLine.quantity || 0));
  }

  const newItemMap = new Map();
  for (const newLine of preview.lineItems) {
    const pId = String(newLine.productId);
    newItemMap.set(pId, (newItemMap.get(pId) || 0) + Number(newLine.quantity || 0));
  }

  const allProductIds = new Set([...oldItemMap.keys(), ...newItemMap.keys()]);
  const stockDeltas = [];
  for (const pId of allProductIds) {
    const oldQty = oldItemMap.get(pId) || 0;
    const newQty = newItemMap.get(pId) || 0;
    const delta = newQty - oldQty;
    if (delta !== 0) {
      stockDeltas.push({ productId: pId, delta, oldQty, newQty });
    }
  }

  // 2. Check available stock on hand for items with positive deltas (increased qty)
  const onHandMap = await ledgerQtyMap(partner._id, Array.from(allProductIds));
  for (const d of stockDeltas) {
    if (d.delta > 0) {
      const avail = onHandMap.get(d.productId) || 0;
      if (avail < d.delta) {
        const prod = preview.lineItems.find((l) => String(l.productId) === d.productId);
        const err = new Error(
          `Insufficient stock to increase ${prod?.name || "product"} by ${d.delta} unit(s) (on hand: ${avail})`,
        );
        err.statusCode = 422;
        err.code = "INSUFFICIENT_STOCK";
        throw err;
      }
    }
  }

  // 3. Financial & Wallet Reconciliation
  const oldGrandTotal = roundCurrency(order.pricing?.total ?? order.pricing?.grandTotal ?? 0);
  const newGrandTotal = preview.grandTotal;
  const oldPaymentMethod = order.posPaymentMethod || order.payment?.method;
  const oldCustomerId = order.posBuyer?.customerId ? String(order.posBuyer.customerId) : null;
  const newCustomerId = posBuyer.customerId ? String(posBuyer.customerId) : null;

  const upiRef =
    paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.UPI_PARTNER
      ? String(payment?.upiReference || "").trim().slice(0, 120)
      : "";

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      // Reconcile Franchise Stock Ledgers
      for (const d of stockDeltas) {
        if (d.delta > 0) {
          // Debit extra quantity
          await decrementFranchiseStock({
            franchisePartnerId: partner._id,
            productId: d.productId,
            quantity: d.delta,
            session,
            type: FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_DEBIT,
            note: `POS bill edit #${orderId} (+${d.delta} units)`,
            orderId: order._id,
            createdBy: userId,
          });
        } else if (d.delta < 0) {
          // Restore reduced quantity
          await incrementFranchiseStock({
            franchisePartnerId: partner._id,
            productId: d.productId,
            quantity: Math.abs(d.delta),
            session,
            type: FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_RESTORE,
            note: `POS bill edit #${orderId} (-${Math.abs(d.delta)} units)`,
            orderId: order._id,
            createdBy: userId,
          });
        }
      }

      // Reconcile Customer Wallet Payments
      const isOldWallet =
        oldPaymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
        oldPaymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET;
      const isNewWallet =
        paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET ||
        paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.EARNINGS_WALLET;

      if (
        isOldWallet &&
        (!isNewWallet || oldCustomerId !== newCustomerId || oldPaymentMethod !== paymentMethod)
      ) {
        // Refund full old amount to old customer's wallet
        const oldBucket =
          oldPaymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET
            ? "shopping"
            : "earnings";
        await creditWallet({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: oldCustomerId,
          amount: oldGrandTotal,
          bucket: oldBucket,
          session,
          ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
          ledgerReference: orderId,
          ledgerDescription: `POS bill edit #${orderId} refund (payment method change)`,
          orderId: order._id,
          idempotencyKey: `${orderId}-edit-refund-${Date.now()}`,
        });
      }

      if (isNewWallet) {
        const newBucket =
          paymentMethod === FRANCHISE_POS_PAYMENT_METHOD.SHOPPING_WALLET
            ? "shopping"
            : "earnings";
        if (isOldWallet && oldCustomerId === newCustomerId && oldPaymentMethod === paymentMethod) {
          // Same wallet payment method & customer: handle net delta
          const netDelta = roundCurrency(newGrandTotal - oldGrandTotal);
          if (netDelta > 0) {
            // Debit extra amount
            await debitWallet({
              ownerType: OWNER_TYPE.CUSTOMER,
              ownerId: newCustomerId,
              amount: netDelta,
              bucket: newBucket,
              session,
              ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,
              ledgerReference: orderId,
              ledgerDescription: `POS bill edit #${orderId} extra charge (+₹${netDelta})`,
              orderId: order._id,
              idempotencyKey: `${orderId}-edit-debit-${Date.now()}`,
            });
          } else if (netDelta < 0) {
            // Refund difference
            const refundAmt = Math.abs(netDelta);
            await creditWallet({
              ownerType: OWNER_TYPE.CUSTOMER,
              ownerId: newCustomerId,
              amount: refundAmt,
              bucket: newBucket,
              session,
              ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
              ledgerReference: orderId,
              ledgerDescription: `POS bill edit #${orderId} partial refund (-₹${refundAmt})`,
              orderId: order._id,
              idempotencyKey: `${orderId}-edit-refund-${Date.now()}`,
            });
          }
        } else {
          // New wallet payment or customer changed: debit full new amount
          await debitWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: newCustomerId,
            amount: newGrandTotal,
            bucket: newBucket,
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_PAYMENT,
            ledgerReference: orderId,
            ledgerDescription: `POS bill edit #${orderId} payment via ${newBucket === "shopping" ? "Shopping" : "Earning"} Wallet`,
            orderId: order._id,
            idempotencyKey: `${orderId}-edit-debit-${Date.now()}`,
          });
        }
      }

      // Update Order document fields
      const oldItemsBackup = (order.items || []).map((i) => ({
        product: i.product,
        name: i.name,
        quantity: i.quantity,
        price: i.price,
      }));

      order.customer = orderCustomerId;
      order.items = preview.lineItems.map((line) => ({
        product: line.productId,
        name: line.name,
        quantity: line.quantity,
        price: line.unitPrice,
      }));
      order.pricing = {
        total: preview.grandTotal,
        grandTotal: preview.grandTotal,
      };
      order.paymentMode = isNewWallet ? "WALLET" : "COD";
      order.payment = {
        method: paymentMethod,
        status: "completed",
      };
      order.posPaymentMethod = paymentMethod;
      order.posUpiReference = upiRef || null;
      order.posBuyer = posBuyer;

      if (!Array.isArray(order.editHistory)) {
        order.editHistory = [];
      }
      order.editHistory.push({
        editedAt: new Date(),
        editedBy: userId,
        oldGrandTotal,
        newGrandTotal,
        oldItems: oldItemsBackup,
        newItems: order.items,
        reason: String(reason || "").trim() || "POS bill edited by franchise",
      });

      freezeFinancialSnapshot(order, buildPosPaymentBreakdown(preview.grandTotal));
      await order.save({ session });
    });

    const updated = await Order.findById(order._id);
    return { order: updated, receipt: buildReceiptDto(updated, partner) };
  } finally {
    await session.endSession();
  }
}

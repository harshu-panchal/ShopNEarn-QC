import mongoose from "mongoose";
import FranchiseStockLedger from "../../models/franchiseStockLedger.js";
import FranchiseStockMovement from "../../models/franchiseStockMovement.js";
import FranchisePartner from "../../models/franchisePartner.js";
import Order from "../../models/order.js";
import Product from "../../models/product.js";
import { FRANCHISE_STOCK_TYPES } from "../../constants/inventory.js";

function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function buildDateFilter(startDate, endDate) {
  const filter = {};
  if (startDate) filter.$gte = new Date(startDate);
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filter.$lte = end;
  }
  return Object.keys(filter).length ? filter : null;
}

/**
 * Returns a full stock trace for every product held (or previously held) by a
 * franchise partner.  For each movement we enrich with:
 *   - product info
 *   - order info (orderId, customer name, phone, channel: 'online' | 'pos')
 *   - running balance before/after
 *
 * @param {string|ObjectId} franchisePartnerId
 * @param {object} options  - page, limit, productId, type, startDate, endDate, channel
 */
export async function getAdminFranchiseStockTrace(franchisePartnerId, options = {}) {
  const page = parsePositiveInt(options.page, 1);
  const limit = Math.min(parsePositiveInt(options.limit, 50), 200);
  const skip = (page - 1) * limit;

  const fid = new mongoose.Types.ObjectId(String(franchisePartnerId));

  const matchStage = { franchisePartnerId: fid };

  if (options.productId) {
    matchStage.productId = new mongoose.Types.ObjectId(String(options.productId));
  }

  // Filter by movement type
  if (options.type && options.type !== "ALL") {
    matchStage.type = options.type;
  }

  // Filter by channel:  incoming = TRANSFER_IN | RESTOCK | CORRECTION
  //                     online   = FULFILLMENT (online order)
  //                     pos      = POS_SALE
  if (options.channel === "incoming") {
    matchStage.type = { $in: [
      FRANCHISE_STOCK_TYPES.TRANSFER_IN,
      FRANCHISE_STOCK_TYPES.RESTOCK,
      FRANCHISE_STOCK_TYPES.RETURN_IN,
      FRANCHISE_STOCK_TYPES.CORRECTION,
    ]};
  } else if (options.channel === "online") {
    matchStage.type = FRANCHISE_STOCK_TYPES.FULFILLMENT;
  } else if (options.channel === "pos") {
    matchStage.type = { $in: [
      FRANCHISE_STOCK_TYPES.POS_SALE,
      FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_RESTORE,
      FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_DEBIT,
    ]};
  }

  const dateFilter = buildDateFilter(options.startDate, options.endDate);
  if (dateFilter) matchStage.createdAt = dateFilter;

  const [movements, total] = await Promise.all([
    FranchiseStockMovement.find(matchStage)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("productId", "name sku mainImage price salePrice variants")
      .populate("order", "orderId isFranchisePosSale posPaymentMethod posBuyer customer paymentMode status createdAt")
      .populate("createdBy", "name phone email")
      .lean(),
    FranchiseStockMovement.countDocuments(matchStage),
  ]);

  // Collect customer IDs from online orders to enrich with user info
  const customerIds = movements
    .filter((m) => m.order?.customer && !m.order?.isFranchisePosSale)
    .map((m) => m.order.customer);

  const uniqueCustomerIds = [...new Set(customerIds.map(String))];

  let customerMap = new Map();
  if (uniqueCustomerIds.length) {
    const User = (await import("../../models/customer.js")).default;
    const users = await User.find(
      { _id: { $in: uniqueCustomerIds } },
      { name: 1, phone: 1, email: 1 },
    ).lean();
    customerMap = new Map(users.map((u) => [String(u._id), u]));
  }

  const formatted = movements.map((m) => {
    const order = m.order || null;
    let channel = "system";
    let customerInfo = null;

    if (m.type === FRANCHISE_STOCK_TYPES.TRANSFER_IN || m.type === FRANCHISE_STOCK_TYPES.RESTOCK) {
      channel = "incoming"; // stock assigned to franchise
    } else if (m.type === FRANCHISE_STOCK_TYPES.FULFILLMENT) {
      channel = "online"; // sold to online customer
      if (order?.customer) {
        const uid = String(order.customer?._id || order.customer);
        const user = customerMap.get(uid);
        customerInfo = {
          name: user?.name || order.customer?.name || "Online Customer",
          phone: user?.phone || order.customer?.phone || "",
          email: user?.email || order.customer?.email || "",
          type: "online",
        };
      }
    } else if (
      m.type === FRANCHISE_STOCK_TYPES.POS_SALE ||
      m.type === FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_DEBIT
    ) {
      channel = "pos";
      if (order?.posBuyer?.name || order?.posBuyer?.phone) {
        customerInfo = {
          name: order.posBuyer?.name || "POS Customer",
          phone: order.posBuyer?.phone || "",
          email: "",
          type: "pos",
        };
      } else {
        customerInfo = { name: "Walk-in Customer", phone: "", email: "", type: "pos" };
      }
    } else if (m.type === FRANCHISE_STOCK_TYPES.POS_SALE_EDIT_RESTORE) {
      channel = "pos_restore";
    } else if (m.type === FRANCHISE_STOCK_TYPES.RETURN_IN) {
      channel = "return";
    } else if (m.type === FRANCHISE_STOCK_TYPES.DAMAGE) {
      channel = "damage";
    } else if (m.type === FRANCHISE_STOCK_TYPES.CORRECTION) {
      channel = "correction";
    }

    return {
      id: m._id,
      type: m.type,
      channel,
      direction: m.quantity > 0 ? "incoming" : "outgoing",
      quantity: m.quantity,
      quantityAbs: Math.abs(m.quantity),
      balanceAfter: m.balanceAfter,
      note: m.note || "",
      transferGroupId: m.transferGroupId || null,
      variantSku: m.variantSku || null,
      variantName: m.variantName || null,
      createdAt: m.createdAt,
      createdBy: m.createdBy
        ? { name: m.createdBy.name, phone: m.createdBy.phone }
        : null,
      product: m.productId
        ? {
            id: m.productId._id,
            name: m.productId.name,
            sku: m.productId.sku,
            image: m.productId.mainImage,
            price: m.productId.salePrice ?? m.productId.price,
          }
        : null,
      order: order
        ? {
            id: order._id,
            orderId: order.orderId,
            status: order.status,
            paymentMode: order.posPaymentMethod || order.paymentMode || null,
            isPos: Boolean(order.isFranchisePosSale),
            createdAt: order.createdAt,
          }
        : null,
      customer: customerInfo,
    };
  });

  // Build per-product summary for the ledger snapshot
  const rawLedgerRows = await FranchiseStockLedger.find({ franchisePartnerId: fid }).lean();
  const productIds = rawLedgerRows.map((r) => r.productId).filter(Boolean);
  const existingProducts = await Product.find(
    { _id: { $in: productIds } },
    "name sku mainImage price salePrice"
  ).lean();
  const prodMap = new Map(existingProducts.map((p) => [String(p._id), p]));

  const ledgerSummary = rawLedgerRows.map((row) => {
    const rawPid = row.productId ? String(row.productId) : null;
    const prod = rawPid ? prodMap.get(rawPid) : null;
    return {
      productId: rawPid,
      productName: prod?.name || (rawPid ? `Catalog Item (${rawPid.slice(-6)})` : "Unassigned Product"),
      sku: prod?.sku || row.variantSku || "",
      image: prod?.mainImage || null,
      currentStock: Number(row.quantity) || 0,
      variantSku: row.variantSku || null,
      variantName: row.variantName || null,
      isArchived: !prod && Boolean(rawPid),
      lastUpdated: row.updatedAt,
    };
  });

  // Aggregate stats
  const statsAgg = await FranchiseStockMovement.aggregate([
    { $match: { franchisePartnerId: fid } },
    {
      $group: {
        _id: "$type",
        totalQty: { $sum: { $abs: "$quantity" } },
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = {
    totalAssigned: 0,
    totalOnlineSold: 0,
    totalPosSold: 0,
    totalReturned: 0,
    totalDamage: 0,
  };

  for (const row of statsAgg) {
    if (row._id === FRANCHISE_STOCK_TYPES.TRANSFER_IN || row._id === FRANCHISE_STOCK_TYPES.RESTOCK) {
      stats.totalAssigned += row.totalQty;
    } else if (row._id === FRANCHISE_STOCK_TYPES.FULFILLMENT) {
      stats.totalOnlineSold += row.totalQty;
    } else if (row._id === FRANCHISE_STOCK_TYPES.POS_SALE) {
      stats.totalPosSold += row.totalQty;
    } else if (row._id === FRANCHISE_STOCK_TYPES.RETURN_IN) {
      stats.totalReturned += row.totalQty;
    } else if (row._id === FRANCHISE_STOCK_TYPES.DAMAGE) {
      stats.totalDamage += row.totalQty;
    }
  }

  return {
    ledger: ledgerSummary,
    stats,
    movements: {
      items: formatted,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Returns every product that a franchise has ever had in stock, grouped by product,
 * with the full trace of when each unit came in and where it went.
 * This is the "per-product drilldown" view.
 */
export async function getAdminFranchiseProductTrace(franchisePartnerId, productId) {
  const fid = new mongoose.Types.ObjectId(String(franchisePartnerId));
  const pid = new mongoose.Types.ObjectId(String(productId));

  const [ledger, movements, product] = await Promise.all([
    FranchiseStockLedger.findOne({ franchisePartnerId: fid, productId: pid }).lean(),
    FranchiseStockMovement.find({ franchisePartnerId: fid, productId: pid })
      .sort({ createdAt: 1 }) // chronological for trace
      .populate("order", "orderId isFranchisePosSale posPaymentMethod posBuyer customer paymentMode status createdAt")
      .populate("createdBy", "name phone")
      .lean(),
    Product.findById(pid, "name sku mainImage price salePrice variants").lean(),
  ]);

  const customerIds = movements
    .filter((m) => m.order?.customer && !m.order?.isFranchisePosSale)
    .map((m) => String(m.order.customer));
  const uniqueCustomerIds = [...new Set(customerIds)];

  let customerMap = new Map();
  if (uniqueCustomerIds.length) {
    const User = (await import("../../models/customer.js")).default;
    const users = await User.find({ _id: { $in: uniqueCustomerIds } }, { name: 1, phone: 1, email: 1 }).lean();
    customerMap = new Map(users.map((u) => [String(u._id), u]));
  }

  // Build running balance from oldest to newest
  let runningBalance = 0;
  const trace = movements.map((m) => {
    const qty = Number(m.quantity) || 0;
    const balanceBefore = runningBalance;
    runningBalance = m.balanceAfter ?? runningBalance + qty;

    const isPos = Boolean(m.order?.isFranchisePosSale);
    let customer = null;
    if (m.type === FRANCHISE_STOCK_TYPES.FULFILLMENT && m.order?.customer) {
      const uid = String(m.order.customer?._id || m.order.customer);
      const u = customerMap.get(uid);
      customer = { name: u?.name || "Online Customer", phone: u?.phone || "", type: "online" };
    } else if (isPos) {
      customer = {
        name: m.order?.posBuyer?.name || "Walk-in",
        phone: m.order?.posBuyer?.phone || "",
        type: "pos",
      };
    }

    return {
      id: m._id,
      type: m.type,
      qty,
      balanceBefore,
      balanceAfter: m.balanceAfter ?? runningBalance,
      note: m.note || "",
      variantSku: m.variantSku || null,
      orderId: m.order?.orderId || null,
      isPos,
      paymentMode: m.order?.posPaymentMethod || m.order?.paymentMode || null,
      customer,
      createdBy: m.createdBy ? { name: m.createdBy.name } : null,
      createdAt: m.createdAt,
    };
  });

  const totalIn = trace.filter((t) => t.qty > 0).reduce((s, t) => s + t.qty, 0);
  const totalOut = trace.filter((t) => t.qty < 0).reduce((s, t) => s + Math.abs(t.qty), 0);

  return {
    product: product
      ? {
          id: product._id,
          name: product.name,
          sku: product.sku,
          image: product.mainImage,
          price: product.salePrice ?? product.price,
          variants: product.variants || [],
        }
      : {
          id: pid,
          name: `Catalog Item (${String(productId).slice(-6)})`,
          sku: ledger?.variantSku || "",
          image: null,
          price: 0,
          variants: [],
          isArchived: true,
        },
    currentStock: ledger ? Number(ledger.quantity) || 0 : 0,
    totalIn,
    totalOut,
    trace,
  };
}

/**
 * Returns all stock orders and/or customer orders for a franchise partner —
 * showing what was ordered, when dispatched from hub/admin, when delivered to
 * the franchise/admin or customer, and the exact product line items per order
 * with datewise grouping and unit metrics.
 *
 * @param {string|ObjectId} franchisePartnerId
 * @param {object} options  - page, limit, scope (stock|customer|all), status, startDate, endDate
 */
export async function getAdminFranchiseStockOrders(franchisePartnerId, options = {}) {
  const page = parsePositiveInt(options.page, 1);
  const limit = Math.min(parsePositiveInt(options.limit, 50), 150);
  const skip = (page - 1) * limit;

  const fid = new mongoose.Types.ObjectId(String(franchisePartnerId));

  const query = { franchisePartnerId: fid };
  const scope = (options.scope || options.orderType || "stock").toLowerCase();

  if (scope === "stock") {
    query.isFranchiseStockOrder = true;
    if (options.status && options.status !== "ALL") {
      query.franchiseStockStatus = options.status;
    }
  } else if (scope === "customer") {
    query.isFranchiseStockOrder = { $ne: true };
    if (options.status && options.status !== "ALL") {
      query.status = options.status;
    }
  } else {
    // all
    if (options.status && options.status !== "ALL") {
      query.$or = [
        { franchiseStockStatus: options.status },
        { status: options.status },
      ];
    }
  }

  const dateFilter = buildDateFilter(options.startDate, options.endDate);
  if (dateFilter) {
    query.createdAt = dateFilter;
  }

  const [orders, total, allMatching] = await Promise.all([
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("items.product", "name sku mainImage price salePrice")
      .populate("customer", "name phone email")
      .lean(),
    Order.countDocuments(query),
    Order.find(query)
      .select("items isFranchiseStockOrder franchiseStockStatus status paymentBreakdown hubDispatchedAt franchiseReceivedAt deliveredAt createdAt")
      .lean(),
  ]);

  // Aggregate stats across allMatching
  let totalUnitsOrdered = 0;
  let totalUnitsDelivered = 0;
  let totalUnitsPending = 0;
  let totalValueSum = 0;
  let deliveredCount = 0;
  let pendingCount = 0;

  for (const o of allMatching) {
    const units = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const val =
      o.paymentBreakdown?.grandTotal ||
      (o.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);
    totalUnitsOrdered += units;
    totalValueSum += val;

    const isDelivered =
      o.franchiseStockStatus === "DELIVERED" ||
      o.status === "delivered" ||
      Boolean(o.franchiseReceivedAt);

    if (isDelivered) {
      deliveredCount += 1;
      totalUnitsDelivered += units;
    } else {
      pendingCount += 1;
      totalUnitsPending += units;
    }
  }

  const formatted = orders.map((o) => {
    const isStockOrder = Boolean(o.isFranchiseStockOrder);
    const totalUnits = (o.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const totalValue =
      o.paymentBreakdown?.grandTotal ||
      (o.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 0), 0);

    const orderedAt = o.createdAt;
    const dispatchedAt = o.hubDispatchedAt || o.franchiseRoutedAt || null;
    const deliveredAt =
      o.franchiseReceivedAt ||
      o.deliveredAt ||
      (o.status === "delivered" ? o.updatedAt : null);

    const isDelivered =
      (isStockOrder && o.franchiseStockStatus === "DELIVERED") ||
      o.status === "delivered" ||
      Boolean(o.franchiseReceivedAt);

    const buyerName =
      o.customer?.name ||
      o.posBuyer?.name ||
      (isStockOrder ? "Franchise Partner (Stock Order)" : "Walk-in Guest");
    const buyerPhone = o.customer?.phone || o.posBuyer?.phone || null;

    return {
      id: o._id,
      orderId: o.orderId,
      orderType: isStockOrder ? "stock" : o.isFranchisePosSale ? "pos" : "online",
      status: (isStockOrder ? o.franchiseStockStatus : o.status) || "UNKNOWN",
      isDelivered,
      paymentMode: o.paymentMode || o.posPaymentMethod || null,
      totalUnits,
      productsCount: (o.items || []).length,
      totalValue,
      orderedAt,
      dispatchedAt,
      deliveredAt,
      items: (o.items || []).map((item) => ({
        productId: item.product?._id || item.product,
        name: item.product?.name || item.name || "Product",
        sku: item.product?.sku || "",
        image: item.product?.mainImage || item.image || null,
        unitPrice: item.price || item.product?.salePrice || item.product?.price || 0,
        quantity: item.quantity || 0,
        lineTotal: (item.price || item.product?.salePrice || item.product?.price || 0) * (item.quantity || 0),
        variantSlot: item.variantSlot || null,
      })),
      buyer: {
        name: buyerName,
        phone: buyerPhone,
        type: isStockOrder ? "franchise" : o.isFranchisePosSale ? "pos" : "online",
      },
    };
  });

  // Datewise grouping by ordered date
  const byDate = {};
  for (const ord of formatted) {
    const day = new Date(ord.orderedAt).toISOString().slice(0, 10);
    if (!byDate[day]) {
      byDate[day] = {
        date: day,
        orderCount: 0,
        totalUnits: 0,
        deliveredUnits: 0,
        totalValue: 0,
        orders: [],
      };
    }
    byDate[day].orderCount += 1;
    byDate[day].totalUnits += ord.totalUnits;
    if (ord.isDelivered) {
      byDate[day].deliveredUnits += ord.totalUnits;
    }
    byDate[day].totalValue += ord.totalValue;
    byDate[day].orders.push(ord);
  }

  const groupedByDate = Object.values(byDate).sort((a, b) =>
    b.date.localeCompare(a.date)
  );

  return {
    orders: formatted,
    groupedByDate,
    stats: {
      totalOrders: total,
      totalUnitsOrdered,
      totalUnitsDelivered,
      totalUnitsPending,
      totalValue: totalValueSum,
      deliveredCount,
      pendingCount,
    },
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}


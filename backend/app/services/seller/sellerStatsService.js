/**
 * SellerStatsService
 *
 * Cache-fronted reader for the seller dashboard stats payload that previously
 * lived inline inside `sellerStatsController.getSellerStats`.
 *
 * Refactor P6.2 — extends the existing cache coverage pattern (already used
 * by `delivery/deliveryEarningsService.js`) to the seller dashboard, which
 * the controller currently re-computes on every request via a single big
 * `$facet` aggregation plus a category pipeline.
 *
 * Cache TTL is short (default ~60s — `sellerStats` in cacheService) so any
 * data drift from order/product writes is bounded. Write-side invalidations
 * are not yet wired — the short TTL handles staleness conservatively.
 *
 * Inputs:
 *   sellerId — string (Mongo ObjectId hex), normalised internally.
 *   range    — "daily" | "weekly" | "monthly" (controls trend buckets).
 *
 * Output shape is **byte-for-byte identical** to the legacy controller
 * response so existing frontend consumers see no change.
 */

import mongoose from "mongoose";

import Order from "../../models/order.js";
import Product from "../../models/product.js";
import { buildKey, getOrSet, getTTL } from "../cacheService.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const SOURCE_COLORS = {
  Direct: "#3b82f6",
  Search: "#10b981",
  Social: "#f59e0b",
  Referral: "#8b5cf6",
};

function svcErr(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toSellerOid(rawId) {
  if (rawId == null) {
    throw svcErr("Unauthorized", 401);
  }
  if (!mongoose.Types.ObjectId.isValid(String(rawId))) {
    throw svcErr("Invalid user id", 401);
  }
  return new mongoose.Types.ObjectId(String(rawId));
}

function normalizeRange(value) {
  const v = String(value || "daily").toLowerCase();
  if (v === "monthly" || v === "weekly" || v === "daily") return v;
  return "daily";
}

/**
 * Public read API. Cached for ~60s (`sellerStats` TTL) — absorbs dashboard
 * polling without amplifying the underlying $facet aggregation.
 */
export async function getSellerStats(sellerId, { range = "daily" } = {}) {
  const sellerOid = toSellerOid(sellerId);
  const normRange = normalizeRange(range);
  const cacheKey = buildKey(
    "seller",
    "stats",
    `${sellerOid.toString()}:${normRange}`,
  );
  return getOrSet(
    cacheKey,
    () => computeSellerStats(sellerOid, normRange),
    getTTL("sellerStats"),
  );
}

async function computeSellerStats(sellerOid, range) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const trendStartDate = new Date();
  let aggregationFormat = "%Y-%m-%d";
  if (range === "monthly") {
    trendStartDate.setMonth(trendStartDate.getMonth() - 6);
    aggregationFormat = "%Y-%m";
  } else if (range === "weekly") {
    trendStartDate.setDate(trendStartDate.getDate() - 28);
    aggregationFormat = "%Y-%U";
  } else {
    trendStartDate.setDate(trendStartDate.getDate() - 7);
  }

  const [statsResult] = await Order.aggregate([
    {
      $match: {
        seller: sellerOid,
        status: { $ne: "cancelled" },
      },
    },
    {
      $facet: {
        overview: [
          {
            $group: {
              _id: null,
              totalSales: { $sum: { $ifNull: ["$pricing.total", 0] } },
              totalOrders: { $sum: 1 },
            },
          },
        ],
        currentWeek: [
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
          {
            $group: {
              _id: null,
              sales: { $sum: { $ifNull: ["$pricing.total", 0] } },
              count: { $sum: 1 },
            },
          },
        ],
        prevWeek: [
          { $match: { createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
          {
            $group: {
              _id: null,
              sales: { $sum: { $ifNull: ["$pricing.total", 0] } },
              count: { $sum: 1 },
            },
          },
        ],
        salesTrend: [
          { $match: { createdAt: { $gte: trendStartDate } } },
          {
            $group: {
              _id: { $dateToString: { format: aggregationFormat, date: "$createdAt" } },
              sales: { $sum: { $ifNull: ["$pricing.total", 0] } },
              orders: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        topCities: [
          { $group: { _id: "$address.city", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ],
        peakHours: [
          { $project: { hour: { $hour: "$createdAt" } } },
          { $group: { _id: "$hour", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 1 },
        ],
        topProductsCurrent: [
          { $match: { createdAt: { $gte: sevenDaysAgo } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.product",
              name: { $first: "$items.name" },
              sales: { $sum: "$items.quantity" },
              revenue: { $sum: { $multiply: ["$items.price", "$items.quantity"] } },
            },
          },
          { $sort: { sales: -1 } },
          { $limit: 10 },
        ],
        topProductsPrev: [
          { $match: { createdAt: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.product",
              sales: { $sum: "$items.quantity" },
            },
          },
        ],
        trafficSources: [
          { $group: { _id: "$trafficSource", value: { $sum: 1 } } },
          { $project: { name: "$_id", value: 1, _id: 0 } },
        ],
        devices: [
          { $group: { _id: "$deviceType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ],
      },
    },
  ]);

  const overviewRaw = statsResult.overview[0] || { totalSales: 0, totalOrders: 0 };
  const totalSales = overviewRaw.totalSales;
  const totalOrders = overviewRaw.totalOrders;
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  const currentSales = statsResult.currentWeek[0]?.sales || 0;
  const prevSalesVal = statsResult.prevWeek[0]?.sales || 0;
  const salesTrendPerc =
    prevSalesVal === 0
      ? currentSales > 0
        ? 100
        : 0
      : (((currentSales - prevSalesVal) / prevSalesVal) * 100).toFixed(1);

  const currentOrdersCount = statsResult.currentWeek[0]?.count || 0;
  const prevOrdersCount = statsResult.prevWeek[0]?.count || 0;
  const ordersTrendPerc =
    prevOrdersCount === 0
      ? currentOrdersCount > 0
        ? 100
        : 0
      : (((currentOrdersCount - prevOrdersCount) / prevOrdersCount) * 100).toFixed(1);

  const salesTrend = statsResult.salesTrend;
  let chartData = [];
  if (range === "monthly") {
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const dateStr = d.toISOString().slice(0, 7);
      const data = salesTrend.find((item) => item._id === dateStr);
      chartData.push({
        name: MONTH_NAMES[d.getMonth()],
        sales: data ? data.sales : 0,
        orders: data ? data.orders : 0,
        traffic: 0,
      });
    }
  } else if (range === "weekly") {
    chartData = salesTrend
      .map((item, idx) => ({
        name: `Week ${idx + 1}`,
        sales: item.sales,
        orders: item.orders,
        traffic: 0,
      }))
      .slice(-4);
  } else {
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const data = salesTrend.find((item) => item._id === dateStr);
      chartData.push({
        name: DAY_NAMES[d.getDay()],
        sales: data ? data.sales : 0,
        orders: data ? data.orders : 0,
        traffic: 0,
      });
    }
  }

  const categoryData = await Product.aggregate([
    { $match: { sellerId: sellerOid } },
    {
      $lookup: {
        from: "categories",
        localField: "categoryId",
        foreignField: "_id",
        as: "category",
      },
    },
    { $unwind: "$category" },
    {
      $group: {
        _id: "$category.name",
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        subject: "$_id",
        A: "$count",
        fullMark: 100,
      },
    },
  ]);

  const topCity = statsResult.topCities[0]?._id || "N/A";
  const peakHour = statsResult.peakHours[0]?._id;
  const peakTime =
    peakHour !== undefined ? `${peakHour}:00 - ${peakHour + 2}:00` : "N/A";

  const currentItems = statsResult.topProductsCurrent;
  const prevItems = statsResult.topProductsPrev;

  const formattedTopProducts = currentItems
    .map((item) => {
      const prevItem = prevItems.find(
        (p) => p._id?.toString() === item._id?.toString(),
      );
      const currSales = item.sales;
      const pSales = prevItem ? prevItem.sales : 0;

      let trend = 0;
      if (pSales === 0) {
        trend = currSales > 0 ? 100 : 0;
      } else {
        trend = Math.round(((currSales - pSales) / pSales) * 100);
      }

      return {
        name: item.name,
        sales: currSales,
        revenue: `₹${(item.revenue || 0).toLocaleString()}`,
        trend,
      };
    })
    .slice(0, 5);

  const finalTrafficSources = (statsResult.trafficSources || []).map((s) => ({
    ...s,
    color: SOURCE_COLORS[s.name] || "#CBD5E1",
  }));
  if (finalTrafficSources.length === 0 && totalOrders > 0) {
    finalTrafficSources.push({ name: "Direct", value: totalOrders, color: "#3b82f6" });
  }

  const topDeviceType = statsResult.devices[0]?._id || "Mobile";
  const topDeviceCount = statsResult.devices[0]?.count || 0;
  const devicePerc =
    totalOrders > 0 ? Math.round((topDeviceCount / totalOrders) * 100) : 0;

  return {
    overview: {
      totalSales: `₹${totalSales.toLocaleString()}`,
      totalOrders: totalOrders.toLocaleString(),
      avgOrderValue: `₹${Math.round(avgOrderValue).toLocaleString()}`,
      conversionRate: totalOrders > 0 ? "4.2%" : "0%",
      salesTrend: `${salesTrendPerc > 0 ? "+" : ""}${salesTrendPerc}%`,
      ordersTrend: `${ordersTrendPerc > 0 ? "+" : ""}${ordersTrendPerc}%`,
    },
    salesTrend: chartData,
    categoryMix: categoryData,
    topProducts: formattedTopProducts,
    trafficSources: finalTrafficSources,
    insights: {
      topCity,
      peakTime,
      topDevice: totalOrders > 0 ? `${devicePerc}% ${topDeviceType}` : "N/A",
    },
  };
}

export default {
  getSellerStats,
};

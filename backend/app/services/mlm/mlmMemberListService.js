import ExcelJS from "exceljs";
import Customer from "../../models/customer.js";
import MlmMembership from "../../models/mlmMembership.js";
import Wallet from "../../models/wallet.js";
import { ALL_MLM_PLAN_TYPES } from "../../constants/mlm.js";
import { OWNER_TYPE } from "../../constants/finance.js";
import { resolveMemberRegistrationAt } from "../../utils/mlmMemberJoinedAt.js";

const EXPORT_MAX_ROWS = 50_000;

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatExportDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDisplayStatus(row) {
  if (row.customerOnly || row.status === "no_membership") {
    return "No MLM";
  }
  if (row.status === "active") {
    return row.planType === "B" ? "Plan B" : "Plan A";
  }
  if (row.status === "registered_unpaid") return "Member";
  if (row.status === "suspended") return "Suspended";
  if (row.status === "terminated") return "Terminated";
  return row.status || "";
}

function formatLeg(row) {
  if (row.customerOnly || row.status === "no_membership") return "";
  if (row.binaryPosition === "L") return "Left";
  if (row.binaryPosition === "R") return "Right";
  return "Root";
}

function shouldIncludeCustomerOnlyRows({ planType, status, q }) {
  // Customer-only accounts have no plan/membership status. Only surface
  // them when the admin is actively searching (or explicitly filtering
  // to this bucket) so the default members list stays membership-only.
  const rawNeedle = q ? String(q).trim() : "";
  if (status === "no_membership") return true;
  if (!rawNeedle) return false;
  if (planType && ALL_MLM_PLAN_TYPES.includes(planType)) return false;
  if (status && status !== "no_membership") return false;
  return true;
}

async function findCustomersMatchingSearch(q) {
  const rawNeedle = q ? String(q).trim() : "";
  if (!rawNeedle) return [];

  const rx = new RegExp(escapeRegex(rawNeedle), "i");
  return Customer.find({
    $or: [
      { name: rx },
      { phone: rx },
      { email: rx },
      { userId: rx },
    ],
  })
    .select("name phone email userId createdAt mlm isVerified")
    .lean();
}

function toCustomerOnlyRow(customer) {
  return {
    _id: `customer-only:${customer._id}`,
    customerOnly: true,
    customerId: String(customer._id),
    userId: {
      _id: customer._id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      userId: customer.userId,
      createdAt: customer.createdAt,
      mlm: customer.mlm,
    },
    referralCode: customer.userId || null,
    status: "no_membership",
    planType: null,
    binaryPosition: null,
    position: null,
    sponsorId: null,
    sponsor: null,
    directReferralsCount: 0,
    lifetimePlanAEarnings: 0,
    lifetimePlanBEarnings: 0,
    earningsWalletBalance: 0,
    shoppingWalletBalance: 0,
    joinedAt: customer.createdAt || null,
    activatedAt: null,
    isVerified: customer.isVerified !== false,
  };
}

/**
 * Customers who match the search but have no live MlmMembership row.
 * These are the "phone already registered" accounts that never completed
 * MLM enrollment (or whose membership creation failed after OTP verify).
 */
async function fetchCustomerOnlyRows({ q }) {
  const customers = await findCustomersMatchingSearch(q);
  if (!customers.length) return [];

  const customerIds = customers.map((customer) => customer._id);
  const memberships = await MlmMembership.find({
    userId: { $in: customerIds },
    deletedAt: null,
  })
    .select({ userId: 1 })
    .lean();
  const hasMembership = new Set(memberships.map((row) => String(row.userId)));

  return customers
    .filter((customer) => !hasMembership.has(String(customer._id)))
    .map(toCustomerOnlyRow);
}

/**
 * Paginated browse of verified customers with no live membership.
 */
async function queryCustomerOnlyAccounts({ page, limit, q }) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  if (q && String(q).trim()) {
    const rows = sortRowsByJoinedAtDesc(await fetchCustomerOnlyRows({ q }));
    return {
      items: rows.slice(skip, skip + safeLimit),
      page: safePage,
      limit: safeLimit,
      total: rows.length,
      totalPages: Math.ceil(rows.length / safeLimit) || 1,
    };
  }

  const membershipUserIds = await MlmMembership.distinct("userId", {
    deletedAt: null,
  });

  const filter = {
    isVerified: true,
    ...(membershipUserIds.length
      ? { _id: { $nin: membershipUserIds } }
      : {}),
  };

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .select("name phone email userId createdAt mlm isVerified")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  return {
    items: customers.map(toCustomerOnlyRow),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

export async function buildMlmMembersMatchQuery({ planType, status, q }) {
  const query = {};
  if (planType && ALL_MLM_PLAN_TYPES.includes(planType)) {
    query.planType = planType;
  }
  // `no_membership` is a synthetic UI status for customer-only rows —
  // memberships never carry it, so skip the membership status filter.
  if (status && status !== "no_membership") query.status = status;

  const rawNeedle = q ? String(q).trim() : "";
  if (rawNeedle) {
    const rx = new RegExp(escapeRegex(rawNeedle), "i");
    const matchingUserIds = await Customer.find({
      $or: [
        { name: rx },
        { phone: rx },
        { email: rx },
        { userId: rx },
      ],
    })
      .select({ _id: 1 })
      .lean()
      .then((users) => users.map((user) => user._id));

    query.$or = [
      { referralCode: rx },
      ...(matchingUserIds.length > 0
        ? [{ userId: { $in: matchingUserIds } }]
        : []),
    ];
  }

  return { ...query, deletedAt: null };
}

async function fetchOrderedMemberIds(matchQuery, { skip = 0, limit = null } = {}) {
  const pipeline = [
    { $match: matchQuery },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    {
      $addFields: {
        registrationAt: {
          $ifNull: [
            { $arrayElemAt: ["$userDoc.createdAt", 0] },
            "$createdAt",
          ],
        },
      },
    },
    { $sort: { registrationAt: -1, _id: -1 } },
  ];

  if (skip > 0) pipeline.push({ $skip: skip });
  if (limit != null) pipeline.push({ $limit: limit });
  pipeline.push({ $project: { _id: 1 } });

  const rows = await MlmMembership.aggregate(pipeline);
  return rows.map((row) => row._id);
}

async function enrichMlmMemberRows(items) {
  const sponsorIds = Array.from(
    new Set(
      items
        .map((member) => member.sponsorId)
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  );

  const customerIds = Array.from(
    new Set(
      items
        .map((member) => member.userId?._id)
        .filter(Boolean)
        .map((id) => String(id)),
    ),
  );

  const [sponsors, wallets] = await Promise.all([
    sponsorIds.length > 0
      ? MlmMembership.find({ userId: { $in: sponsorIds } })
          .select({ userId: 1, referralCode: 1, createdAt: 1 })
          .populate("userId", "name phone userId createdAt")
          .lean()
      : Promise.resolve([]),
    customerIds.length > 0
      ? Wallet.find({
          ownerType: OWNER_TYPE.CUSTOMER,
          ownerId: { $in: customerIds },
        })
          .select({ ownerId: 1, earningsBalance: 1, shoppingBalance: 1 })
          .lean()
      : Promise.resolve([]),
  ]);

  const sponsorMap = new Map(
    sponsors.map((sponsor) => [String(sponsor.userId?._id || sponsor.userId), sponsor]),
  );
  const walletMap = new Map(wallets.map((wallet) => [String(wallet.ownerId), wallet]));

  return items.map((row) => {
    const wallet = walletMap.get(String(row.userId?._id));
    return {
      ...row,
      joinedAt: resolveMemberRegistrationAt(row),
      activatedAt: row.planAJoinedAt || null,
      earningsWalletBalance: wallet?.earningsBalance || 0,
      shoppingWalletBalance: wallet?.shoppingBalance || 0,
      sponsor: row.sponsorId
        ? (() => {
            const sponsor = sponsorMap.get(String(row.sponsorId));
            if (!sponsor) return null;
            return {
              name: sponsor.userId?.name || null,
              phone: sponsor.userId?.phone || null,
              userId: sponsor.userId?.userId || null,
              referralCode: sponsor.referralCode || null,
              joinedAt: resolveMemberRegistrationAt(sponsor),
            };
          })()
        : null,
    };
  });
}

async function fetchMembersByOrderedIds(orderedIds) {
  if (!orderedIds.length) return [];

  const itemsById = new Map();
  const fetched = await MlmMembership.find({ _id: { $in: orderedIds } })
    .populate("userId", "name phone email mlm userId createdAt")
    .lean();

  for (const row of fetched) {
    itemsById.set(String(row._id), row);
  }

  const items = orderedIds
    .map((id) => itemsById.get(String(id)))
    .filter(Boolean);

  return enrichMlmMemberRows(items);
}

function sortRowsByJoinedAtDesc(rows) {
  return [...rows].sort((a, b) => {
    const aTime = new Date(a.joinedAt || 0).getTime();
    const bTime = new Date(b.joinedAt || 0).getTime();
    return bTime - aTime;
  });
}

async function collectFilteredMemberRows({ planType, status, q }) {
  const includeCustomerOnly = shouldIncludeCustomerOnlyRows({
    planType,
    status,
    q,
  });

  if (status === "no_membership") {
    if (q && String(q).trim()) {
      return sortRowsByJoinedAtDesc(await fetchCustomerOnlyRows({ q }));
    }
    // Export / full dump of orphan accounts (capped).
    const membershipUserIds = await MlmMembership.distinct("userId", {
      deletedAt: null,
    });
    const customers = await Customer.find({
      isVerified: true,
      ...(membershipUserIds.length
        ? { _id: { $nin: membershipUserIds } }
        : {}),
    })
      .select("name phone email userId createdAt mlm isVerified")
      .sort({ createdAt: -1 })
      .limit(EXPORT_MAX_ROWS)
      .lean();
    return customers.map(toCustomerOnlyRow);
  }

  const matchQuery = await buildMlmMembersMatchQuery({ planType, status, q });
  const orderedIds = await fetchOrderedMemberIds(matchQuery, {
    limit: EXPORT_MAX_ROWS,
  });
  const membershipRows = await fetchMembersByOrderedIds(orderedIds);

  if (!includeCustomerOnly) {
    return membershipRows;
  }

  const customerOnlyRows = await fetchCustomerOnlyRows({ q });
  return sortRowsByJoinedAtDesc([...membershipRows, ...customerOnlyRows]);
}

/**
 * Paginated member list with the same filters + sort as the admin table.
 * When searching, also includes verified Customer accounts that have no
 * MlmMembership yet (signup completed, MLM enrollment missing).
 */
export async function queryMlmMembersEnriched({
  planType,
  status,
  q,
  page = 1,
  limit = 25,
}) {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  if (status === "no_membership") {
    return queryCustomerOnlyAccounts({ page: safePage, limit: safeLimit, q });
  }

  const includeCustomerOnly = shouldIncludeCustomerOnlyRows({
    planType,
    status,
    q,
  });

  // Fast path: default browse (no search, no customer-only filter) keeps
  // the efficient membership-only pagination.
  if (!includeCustomerOnly) {
    const matchQuery = await buildMlmMembersMatchQuery({ planType, status, q });
    const [orderedIds, total] = await Promise.all([
      fetchOrderedMemberIds(matchQuery, { skip, limit: safeLimit }),
      MlmMembership.countDocuments(matchQuery),
    ]);
    const items = await fetchMembersByOrderedIds(orderedIds);

    return {
      items,
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  const allRows = await collectFilteredMemberRows({ planType, status, q });
  const total = allRows.length;
  const items = allRows.slice(skip, skip + safeLimit);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    totalPages: Math.ceil(total / safeLimit) || 1,
  };
}

/**
 * All members matching filters (capped) for Excel export.
 */
export async function fetchAllMlmMembersForExport({ planType, status, q }) {
  const items = await collectFilteredMemberRows({ planType, status, q });
  const total = items.length;

  if (total > EXPORT_MAX_ROWS) {
    const err = new Error(
      `Too many rows to export (${total.toLocaleString("en-IN")}). Narrow your filters — max ${EXPORT_MAX_ROWS.toLocaleString("en-IN")}.`,
    );
    err.statusCode = 413;
    throw err;
  }

  return { items, total };
}

function memberToExportRow(member) {
  const lifetime =
    Number(member.lifetimePlanAEarnings || 0) +
    Number(member.lifetimePlanBEarnings || 0);

  return {
    name: member.userId?.name || "",
    phone: member.userId?.phone || "",
    email: member.userId?.email || "",
    userId: member.userId?.userId || "",
    referralCode: member.referralCode || "",
    membershipStatus: member.status || "",
    planType: member.planType || "",
    displayStatus: formatDisplayStatus(member),
    leg: formatLeg(member),
    sponsorName: member.sponsor?.name || "",
    sponsorCode: member.sponsor?.referralCode || "",
    directReferrals: member.directReferralsCount || 0,
    lifetimeEarnings: lifetime,
    joinedAt: formatExportDate(member.joinedAt),
    activationDate: formatExportDate(member.activatedAt),
  };
}

export async function buildMlmMembersExcelBuffer({ planType, status, q }) {
  const { items, total } = await fetchAllMlmMembersForExport({
    planType,
    status,
    q,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ShopAndEarn Admin";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("MLM Members", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 28 },
    { header: "User ID", key: "userId", width: 14 },
    { header: "Referral Code", key: "referralCode", width: 14 },
    { header: "Display Status", key: "displayStatus", width: 14 },
    { header: "Membership Status", key: "membershipStatus", width: 18 },
    { header: "Plan", key: "planType", width: 8 },
    { header: "Leg", key: "leg", width: 10 },
    { header: "Sponsor Name", key: "sponsorName", width: 22 },
    { header: "Sponsor Code", key: "sponsorCode", width: 14 },
    { header: "Direct Referrals", key: "directReferrals", width: 16 },
    { header: "Lifetime Earnings", key: "lifetimeEarnings", width: 18 },
    { header: "Joined", key: "joinedAt", width: 22 },
    { header: "Activation Date", key: "activationDate", width: 22 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFF1F5F9" },
  };

  for (const member of items) {
    sheet.addRow(memberToExportRow(member));
  }

  sheet.getColumn("lifetimeEarnings").numFmt = "#,##0.00";
  sheet.getColumn("directReferrals").numFmt = "0";

  const meta = workbook.addWorksheet("Export Info");
  meta.addRow(["Exported at", new Date().toISOString()]);
  meta.addRow(["Total rows", total]);
  meta.addRow(["Status filter", status || "All"]);
  meta.addRow(["Plan filter", planType || "All"]);
  meta.addRow(["Search", q || ""]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

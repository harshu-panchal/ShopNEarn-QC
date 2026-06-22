import MlmCommissionEvent from "../../models/mlmCommissionEvent.js";
import MlmMembership from "../../models/mlmMembership.js";
import MlmWithdrawalRequest from "../../models/mlmWithdrawalRequest.js";
import MlmDailyPayoutReport, {
  MLM_DAILY_PAYOUT_REPORT_STATUS,
} from "../../models/mlmDailyPayoutReport.js";
import Customer from "../../models/customer.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
  MLM_MEMBERSHIP_STATUS,
  MLM_WITHDRAWAL_STATUS,
} from "../../constants/mlm.js";
import { istDayBounds } from "../../utils/mlmIstDate.js";
import { roundCurrency } from "../../utils/money.js";

const REPORT_GENERATION_VERSION = "1";

const REPORTABLE_STATUSES = [
  MLM_COMMISSION_EVENT_STATUS.CREDITED,
  MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER,
  MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
];

/**
 * Pure rollup of commission events into per-member line items + platform summary.
 * @param {Array<Object>} events
 * @returns {{ memberMap: Map<string, Object>, bonusBreakdown: Map<string, { eventCount: number, amount: number }>, summary: Object }}
 */
export function rollupCommissionEventsForReport(events) {
  const memberMap = new Map();
  const bonusBreakdown = new Map();

  let totalCredited = 0;
  let totalEvents = 0;
  let pairsMatched = 0;
  let pairIncomeTotal = 0;
  let cappedRolloverTotal = 0;
  let clawbackTotal = 0;

  for (const ev of events || []) {
    const recipientKey = String(ev.recipientId);
    const amount = roundCurrency(
      ev.status === MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK
        ? -(ev.clawbackAmount || ev.cappedAmount || ev.bonusAmount || 0)
        : ev.status === MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER
          ? ev.rolloverAmount || 0
          : ev.cappedAmount || ev.bonusAmount || 0,
    );

    if (ev.status === MLM_COMMISSION_EVENT_STATUS.CAPPED_ROLLOVER) {
      cappedRolloverTotal = roundCurrency(cappedRolloverTotal + Math.abs(amount));
    }
    if (ev.status === MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK) {
      clawbackTotal = roundCurrency(clawbackTotal + Math.abs(amount));
    }
    if (ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED) {
      totalCredited = roundCurrency(totalCredited + amount);
      totalEvents += 1;
    }

    if (
      ev.bonusType === MLM_BONUS_TYPE.BINARY_PAIR_MATCH
      && ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED
    ) {
      pairsMatched += 1;
      pairIncomeTotal = roundCurrency(pairIncomeTotal + amount);
    }

    const bonusKey = ev.bonusType || "UNKNOWN";
    const platformRow = bonusBreakdown.get(bonusKey) || { eventCount: 0, amount: 0 };
    if (ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED) {
      platformRow.eventCount += 1;
      platformRow.amount = roundCurrency(platformRow.amount + amount);
      bonusBreakdown.set(bonusKey, platformRow);
    }

    if (!memberMap.has(recipientKey)) {
      memberMap.set(recipientKey, {
        userId: ev.recipientId,
        membershipId: ev.recipientMembershipId || null,
        pairsMatched: 0,
        bonusByType: {},
        autoTotal: 0,
        sourceEventIds: [],
      });
    }
    const member = memberMap.get(recipientKey);
    member.sourceEventIds.push(ev._id);
    if (ev.recipientMembershipId && !member.membershipId) {
      member.membershipId = ev.recipientMembershipId;
    }

    if (ev.status === MLM_COMMISSION_EVENT_STATUS.CREDITED) {
      member.bonusByType[bonusKey] = roundCurrency(
        (member.bonusByType[bonusKey] || 0) + amount,
      );
      member.autoTotal = roundCurrency(member.autoTotal + amount);
      if (ev.bonusType === MLM_BONUS_TYPE.BINARY_PAIR_MATCH) {
        member.pairsMatched += 1;
      }
    }
  }

  return {
    memberMap,
    bonusBreakdown,
    summary: {
      totalCredited,
      totalEvents,
      pairsMatched,
      pairIncomeTotal,
      cappedRolloverTotal,
      clawbackTotal,
    },
  };
}

function mergePreservedLineItemEdits(existingLineItems, newLineItems, { force }) {
  if (force || !existingLineItems?.length) {
    return newLineItems;
  }
  const preservedByMembership = new Map();
  for (const row of existingLineItems) {
    if (row.membershipId) {
      preservedByMembership.set(String(row.membershipId), row);
    }
  }
  return newLineItems.map((row) => {
    const prev = preservedByMembership.get(String(row.membershipId));
    if (!prev) return row;
    return {
      ...row,
      correctedTotal: prev.correctedTotal ?? null,
      adminNote: prev.adminNote || "",
      adjustments: prev.adjustments || [],
    };
  });
}

/**
 * Generate or refresh the IST-day payout report (idempotent upsert).
 * @param {string} reportDate YYYY-MM-DD IST
 * @param {{ force?: boolean, session?: import('mongoose').ClientSession }} [opts]
 */
export async function generateDailyPayoutReport(reportDate, opts = {}) {
  const { force = false, session = null } = opts;
  const started = Date.now();
  const { startUtc, endUtc } = istDayBounds(reportDate);

  const existing = await MlmDailyPayoutReport.findOne({ reportDate }).session(
    session,
  );
  if (
    existing?.status === MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED
    && !force
  ) {
    return { skipped: "FINALIZED", report: existing };
  }

  const events = await MlmCommissionEvent.find({
    createdAt: { $gte: startUtc, $lt: endUtc },
    status: { $in: REPORTABLE_STATUSES },
  })
    .select(
      "_id recipientId recipientMembershipId bonusType status cappedAmount bonusAmount rolloverAmount clawbackAmount createdAt",
    )
    .lean()
    .session(session);

  const { memberMap, bonusBreakdown, summary: eventSummary } =
    rollupCommissionEventsForReport(events);

  const membershipIds = [
    ...new Set(
      [...memberMap.values()]
        .map((m) => m.membershipId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const userIds = [...memberMap.keys()];
  const usersMissingMembership = [...memberMap.values()]
    .filter((m) => !m.membershipId)
    .map((m) => m.userId);

  const [memberships, membershipsByUser, customers, newReferrals, newActivations, withdrawals] =
    await Promise.all([
      membershipIds.length
        ? MlmMembership.find({ _id: { $in: membershipIds } })
            .select("_id userId referralCode")
            .lean()
            .session(session)
        : [],
      usersMissingMembership.length
        ? MlmMembership.find({ userId: { $in: usersMissingMembership } })
            .select("_id userId referralCode")
            .lean()
            .session(session)
        : [],
      userIds.length
        ? Customer.find({ _id: { $in: userIds } })
            .select("_id name")
            .lean()
            .session(session)
        : [],
      MlmMembership.countDocuments({
        createdAt: { $gte: startUtc, $lt: endUtc },
      }).session(session),
      MlmMembership.countDocuments({
        status: MLM_MEMBERSHIP_STATUS.ACTIVE,
        planAJoinedAt: { $gte: startUtc, $lt: endUtc },
      }).session(session),
      MlmWithdrawalRequest.find({
        $or: [
          { processedAt: { $gte: startUtc, $lt: endUtc } },
          {
            status: MLM_WITHDRAWAL_STATUS.APPROVED,
            updatedAt: { $gte: startUtc, $lt: endUtc },
          },
        ],
      })
        .select("status netPayoutAmount processedAt")
        .lean()
        .session(session),
    ]);

  const membershipById = new Map(memberships.map((m) => [String(m._id), m]));
  const membershipByUserId = new Map(
    [...memberships, ...membershipsByUser].map((m) => [String(m.userId), m]),
  );
  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  let withdrawalsApproved = 0;
  let withdrawalsPaid = 0;
  let withdrawalsAmount = 0;
  for (const w of withdrawals) {
    if (w.status === MLM_WITHDRAWAL_STATUS.APPROVED) withdrawalsApproved += 1;
    if (w.status === MLM_WITHDRAWAL_STATUS.PAID) {
      withdrawalsPaid += 1;
      withdrawalsAmount = roundCurrency(
        withdrawalsAmount + (w.netPayoutAmount || 0),
      );
    }
  }

  const memberLineItems = [...memberMap.values()]
    .map((row) => {
      const mem = row.membershipId
        ? membershipById.get(String(row.membershipId))
        : membershipByUserId.get(String(row.userId));
      const cust = customerById.get(String(row.userId));
      return {
        membershipId: row.membershipId || mem?._id,
        userId: row.userId,
        referralCode: mem?.referralCode || "",
        memberName: cust?.name || "",
        pairsMatched: row.pairsMatched,
        bonusByType: row.bonusByType,
        autoTotal: row.autoTotal,
        correctedTotal: null,
        adminNote: "",
        sourceEventIds: row.sourceEventIds,
        adjustments: [],
      };
    })
    .filter((row) => row.membershipId)
    .sort((a, b) => b.autoTotal - a.autoTotal);

  const mergedLineItems = mergePreservedLineItemEdits(
    existing?.memberLineItems,
    memberLineItems,
    { force },
  );

  const payload = {
    reportDate,
    status:
      existing?.status === MLM_DAILY_PAYOUT_REPORT_STATUS.FINALIZED && force
        ? MLM_DAILY_PAYOUT_REPORT_STATUS.DRAFT
        : existing?.status || MLM_DAILY_PAYOUT_REPORT_STATUS.DRAFT,
    lastRegeneratedAt: new Date(),
    summary: {
      ...eventSummary,
      newReferrals,
      newActivations,
      withdrawalsApproved,
      withdrawalsPaid,
      withdrawalsAmount,
    },
    bonusBreakdown: [...bonusBreakdown.entries()]
      .map(([bonusType, row]) => ({
        bonusType,
        eventCount: row.eventCount,
        amount: row.amount,
      }))
      .sort((a, b) => b.amount - a.amount),
    memberLineItems: mergedLineItems,
    generationMeta: {
      version: REPORT_GENERATION_VERSION,
      eventCountScanned: events.length,
      durationMs: Date.now() - started,
    },
  };

  const report = await MlmDailyPayoutReport.findOneAndUpdate(
    { reportDate },
    { $set: payload, $setOnInsert: { generatedAt: new Date() } },
    { upsert: true, new: true, session },
  );

  return { skipped: null, report };
}

export async function listDailyPayoutReports({
  from = null,
  to = null,
  status = null,
  page = 1,
  limit = 30,
}) {
  const filter = {};
  if (from || to) {
    filter.reportDate = {};
    if (from) filter.reportDate.$gte = from;
    if (to) filter.reportDate.$lte = to;
  }
  if (status) filter.status = status;

  const skip = (Math.max(1, page) - 1) * limit;
  const [items, total] = await Promise.all([
    MlmDailyPayoutReport.find(filter)
      .select(
        "reportDate status summary generatedAt lastRegeneratedAt finalizedAt memberLineItems",
      )
      .sort({ reportDate: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MlmDailyPayoutReport.countDocuments(filter),
  ]);

  const slim = items.map((r) => ({
    ...r,
    memberCount: r.memberLineItems?.length || 0,
    memberLineItems: undefined,
  }));

  return { items: slim, total, page, limit };
}

export async function getDailyPayoutReportByDate(reportDate) {
  return MlmDailyPayoutReport.findOne({ reportDate }).lean();
}

export function serializeReportForExport(report) {
  const lines = [
    "MLM Daily Payout Report",
    `Date (IST),${report.reportDate}`,
    `Status,${report.status}`,
    "",
    "Summary",
    `Total Credited,${report.summary?.totalCredited || 0}`,
    `Pairs Matched,${report.summary?.pairsMatched || 0}`,
    `Pair Income,${report.summary?.pairIncomeTotal || 0}`,
    `New Referrals,${report.summary?.newReferrals || 0}`,
    `New Activations,${report.summary?.newActivations || 0}`,
    `Withdrawals Paid,${report.summary?.withdrawalsPaid || 0}`,
    `Withdrawals Amount,${report.summary?.withdrawalsAmount || 0}`,
    "",
    "Member,Referral Code,Pairs Matched,Auto Total,Corrected Total,Note",
  ];

  for (const row of report.memberLineItems || []) {
    const bonusTotal = row.correctedTotal ?? row.autoTotal;
    lines.push(
      [
        `"${(row.memberName || "").replace(/"/g, '""')}"`,
        row.referralCode || "",
        row.pairsMatched || 0,
        row.autoTotal || 0,
        row.correctedTotal ?? "",
        `"${(row.adminNote || "").replace(/"/g, '""')}"`,
      ].join(","),
    );
  }

  return lines.join("\n");
}

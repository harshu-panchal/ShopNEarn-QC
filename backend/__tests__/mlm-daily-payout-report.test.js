import { describe, expect, test } from "@jest/globals";
import {
  istDayBounds,
  todayIstDateString,
  yesterdayIstDateString,
} from "../app/utils/mlmIstDate.js";
import { rollupCommissionEventsForReport } from "../app/services/mlm/mlmDailyPayoutReportService.js";
import {
  MLM_BONUS_TYPE,
  MLM_COMMISSION_EVENT_STATUS,
} from "../app/constants/mlm.js";

describe("mlmIstDate", () => {
  test("istDayBounds covers 24h IST window", () => {
    const { startUtc, endUtc } = istDayBounds("2026-06-20");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  test("today and yesterday return YYYY-MM-DD", () => {
    expect(todayIstDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(yesterdayIstDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("ist midnight UTC boundary for 2026-06-20 IST", () => {
    const { startUtc } = istDayBounds("2026-06-20");
    // 2026-06-20 00:00 IST = 2026-06-19 18:30 UTC
    expect(startUtc.toISOString()).toBe("2026-06-19T18:30:00.000Z");
  });
});

describe("rollupCommissionEventsForReport", () => {
  const recipientId = "507f1f77bcf86cd799439011";

  test("aggregates pair match and per-member totals", () => {
    const events = [
      {
        _id: "e1",
        recipientId,
        recipientMembershipId: "m1",
        bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        cappedAmount: 200,
        bonusAmount: 200,
      },
      {
        _id: "e2",
        recipientId,
        recipientMembershipId: "m1",
        bonusType: MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        cappedAmount: 300,
        bonusAmount: 300,
      },
      {
        _id: "e3",
        recipientId,
        recipientMembershipId: "m1",
        bonusType: MLM_BONUS_TYPE.DIRECT_REFERRAL_ACTIVATION,
        status: MLM_COMMISSION_EVENT_STATUS.CREDITED,
        cappedAmount: 200,
        bonusAmount: 200,
      },
    ];

    const { memberMap, summary, bonusBreakdown } =
      rollupCommissionEventsForReport(events);

    expect(summary.pairsMatched).toBe(2);
    expect(summary.pairIncomeTotal).toBe(500);
    expect(summary.totalCredited).toBe(700);
    expect(summary.totalEvents).toBe(3);

    const member = memberMap.get(String(recipientId));
    expect(member.pairsMatched).toBe(2);
    expect(member.autoTotal).toBe(700);
    expect(member.bonusByType[MLM_BONUS_TYPE.BINARY_PAIR_MATCH]).toBe(500);

    const pairRow = [...bonusBreakdown.entries()].find(
      ([k]) => k === MLM_BONUS_TYPE.BINARY_PAIR_MATCH,
    );
    expect(pairRow?.[1].eventCount).toBe(2);
    expect(pairRow?.[1].amount).toBe(500);
  });

  test("clawback reduces clawback total in summary", () => {
    const events = [
      {
        _id: "e1",
        recipientId,
        bonusType: MLM_BONUS_TYPE.REPURCHASE_BONUS,
        status: MLM_COMMISSION_EVENT_STATUS.CLAWED_BACK,
        clawbackAmount: 50,
        cappedAmount: 50,
      },
    ];
    const { summary } = rollupCommissionEventsForReport(events);
    expect(summary.clawbackTotal).toBe(50);
    expect(summary.totalCredited).toBe(0);
  });
});

describe("mergePreservedLineItemEdits (via service export pattern)", () => {
  test("preserved edits concept — correctedTotal survives rollup shape", () => {
    const existing = [
      {
        membershipId: "m1",
        correctedTotal: 999,
        adminNote: "fixed",
        adjustments: [{ direction: "CREDIT", amount: 10 }],
      },
    ];
    const fresh = [
      {
        membershipId: "m1",
        autoTotal: 700,
        correctedTotal: null,
        adminNote: "",
        adjustments: [],
      },
    ];
    const preservedByMembership = new Map(
      existing.map((r) => [String(r.membershipId), r]),
    );
    const merged = fresh.map((row) => {
      const prev = preservedByMembership.get(String(row.membershipId));
      if (!prev) return row;
      return {
        ...row,
        correctedTotal: prev.correctedTotal ?? null,
        adminNote: prev.adminNote || "",
        adjustments: prev.adjustments || [],
      };
    });
    expect(merged[0].correctedTotal).toBe(999);
    expect(merged[0].adminNote).toBe("fixed");
    expect(merged[0].adjustments).toHaveLength(1);
  });
});

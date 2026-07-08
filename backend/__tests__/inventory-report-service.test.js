import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import * as reportService from "../app/services/inventory/inventoryReportService.js";
import Order from "../app/models/order.js";
import StockHistory from "../app/models/stockHistory.js";
import FranchiseStockMovement from "../app/models/franchiseStockMovement.js";

function makeQueryResult(rows) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
}

describe("inventoryReportService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("exportReportCsv returns movement csv headers", async () => {
    const csv = await reportService.exportReportCsv("movements", {
      items: [
        {
          productName: "Tea",
          sku: "TEA-1",
          type: "Restock",
          direction: "incoming",
          quantity: 12,
          date: "2026-07-08",
          transferGroupId: "TRF-1",
        },
      ],
    });
    expect(csv).toContain("productName,sku,type,direction,quantity,date,transferGroupId");
    expect(csv).toContain("Tea,TEA-1,Restock,incoming,12,2026-07-08,TRF-1");
  });

  test("getTransferReconciliationReport marks matched and unmatched rows", async () => {
    jest.spyOn(StockHistory, "find").mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: "h1",
          transferGroupId: "TRF-1",
          quantity: -5,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          _id: "h2",
          transferGroupId: "TRF-2",
          quantity: -3,
          createdAt: new Date("2026-07-01T01:00:00.000Z"),
        },
      ]),
    });
    jest.spyOn(FranchiseStockMovement, "find").mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        {
          _id: "f1",
          transferGroupId: "TRF-1",
          quantity: 5,
          createdAt: new Date("2026-07-01T00:05:00.000Z"),
        },
      ]),
    });

    const result = await reportService.getTransferReconciliationReport({});
    expect(result.summary.total).toBe(2);
    expect(result.summary.matched).toBe(1);
    expect(result.summary.unmatched).toBe(1);
  });

  test("getCustomerRetailPurchaseReport excludes B2B and calculates summary", async () => {
    const orderRows = [
      {
        orderId: "ORD-1",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        paymentBreakdown: { grandTotal: 240 },
        pricing: { total: 240 },
        items: [
          {
            name: "Rice",
            quantity: 2,
            price: 100,
            product: { _id: "p1", name: "Rice" },
          },
          {
            name: "Salt",
            quantity: 1,
            price: 40,
            product: { _id: "p2", name: "Salt" },
          },
        ],
      },
    ];

    const findMock = jest.spyOn(Order, "find").mockReturnValue(makeQueryResult(orderRows));
    const countMock = jest.spyOn(Order, "countDocuments").mockResolvedValue(1);

    const result = await reportService.getCustomerRetailPurchaseReport("customer-1", {
      page: 1,
      limit: 20,
    });

    expect(findMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "customer-1", isFranchiseStockOrder: { $ne: true } }),
    );
    expect(countMock).toHaveBeenCalled();
    expect(result.summary.totalOrders).toBe(1);
    expect(result.summary.totalSpend).toBe(240);
    expect(result.summary.totalItems).toBe(3);
    expect(result.topProducts[0].productName).toBe("Rice");
  });
});

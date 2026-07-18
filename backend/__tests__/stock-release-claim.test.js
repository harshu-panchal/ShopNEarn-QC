import { jest } from "@jest/globals";

const mockOrderFindOneAndUpdate = jest.fn();
const mockOrderFindById = jest.fn();
const mockProductUpdateOne = jest.fn();
const mockStockHistoryCreate = jest.fn();

jest.unstable_mockModule("../app/models/order.js", () => ({
  default: {
    findOneAndUpdate: mockOrderFindOneAndUpdate,
    findById: mockOrderFindById,
  },
}));

jest.unstable_mockModule("../app/models/product.js", () => ({
  default: {
    updateOne: mockProductUpdateOne,
    findOneAndUpdate: jest.fn(),
  },
}));

jest.unstable_mockModule("../app/models/stockHistory.js", () => ({
  default: {
    create: mockStockHistoryCreate,
  },
}));

jest.unstable_mockModule("../app/services/lowStockAlertService.js", () => ({
  createLowStockAlertCandidate: jest.fn().mockReturnValue(null),
}));

const { releaseReservedStockForOrder } = await import(
  "../app/services/stockService.js"
);

describe("releaseReservedStockForOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("restores stock once when claim succeeds", async () => {
    const order = {
      _id: "order-mongo-1",
      orderId: "AZ-1",
      seller: "seller-1",
      stockReservation: { status: "COMMITTED" },
      items: [
        { product: "prod-1", quantity: 2, variantSlot: "SKU-A" },
        { product: "prod-1", quantity: 1, variantSlot: "SKU-A" },
      ],
    };

    mockOrderFindOneAndUpdate.mockResolvedValue({
      ...order,
      stockReservation: { status: "RELEASED", releasedAt: new Date() },
    });
    mockProductUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mockStockHistoryCreate.mockResolvedValue([{}]);

    const result = await releaseReservedStockForOrder(order, {
      reason: "Cancelled",
    });

    expect(result.released).toBe(true);
    expect(mockProductUpdateOne).toHaveBeenCalledTimes(1);
    expect(mockProductUpdateOne.mock.calls[0][1].$inc.stock).toBe(3);
    expect(mockStockHistoryCreate).toHaveBeenCalledTimes(1);
    expect(mockStockHistoryCreate.mock.calls[0][0][0].idempotencyKey).toBe(
      "STOCK-RELEASE:order-mongo-1:0",
    );
  });

  it("is idempotent when reservation is already RELEASED", async () => {
    const order = {
      _id: "order-mongo-2",
      orderId: "AZ-2",
      seller: "seller-1",
      stockReservation: { status: "RELEASED" },
      items: [{ product: "prod-1", quantity: 1 }],
    };

    mockOrderFindOneAndUpdate.mockResolvedValue(null);
    mockOrderFindById.mockResolvedValue({
      ...order,
      stockReservation: { status: "RELEASED" },
    });

    const result = await releaseReservedStockForOrder(order, {
      reason: "Cancelled",
    });

    expect(result.released).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(mockProductUpdateOne).not.toHaveBeenCalled();
  });

  it("throws when product/variant update matches zero documents", async () => {
    const order = {
      _id: "order-mongo-3",
      orderId: "AZ-3",
      seller: "seller-1",
      stockReservation: { status: "RESERVED" },
      items: [{ product: "prod-missing", quantity: 1, variantSlot: "SKU-X" }],
    };

    mockOrderFindOneAndUpdate.mockResolvedValue({
      ...order,
      stockReservation: { status: "RELEASED", releasedAt: new Date() },
    });
    mockProductUpdateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    await expect(
      releaseReservedStockForOrder(order, { reason: "Cancelled" }),
    ).rejects.toThrow(/Failed to restore stock/);
  });
});

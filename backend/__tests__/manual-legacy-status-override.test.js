import { describe, expect, it } from "@jest/globals";
import {
  WORKFLOW_STATUS,
  applyManualLegacyStatusOverride,
  resolveLegacyStatusFromOrder,
} from "../app/constants/orderWorkflow.js";

describe("applyManualLegacyStatusOverride", () => {
  it("syncs workflowStatus for v2 retail orders", () => {
    const order = {
      workflowVersion: 2,
      workflowStatus: WORKFLOW_STATUS.SELLER_PENDING,
      status: "pending",
      orderStatus: "pending",
    };

    applyManualLegacyStatusOverride(order, "confirmed");

    expect(order.status).toBe("confirmed");
    expect(order.orderStatus).toBe("confirmed");
    expect(order.workflowStatus).toBe(WORKFLOW_STATUS.DELIVERY_SEARCH);
  });

  it("syncs franchise fields for hub-routed orders", () => {
    const order = {
      workflowVersion: 2,
      franchisePartnerId: "partner-1",
      isFranchiseStockOrder: false,
      franchiseStatus: "pending",
      shipmentStatus: "pending",
      workflowStatus: WORKFLOW_STATUS.FRANCHISE_PENDING,
      status: "pending",
      orderStatus: "pending",
    };

    applyManualLegacyStatusOverride(order, "confirmed");

    expect(order.status).toBe("confirmed");
    expect(order.franchiseStatus).toBe("accepted");
    expect(order.shipmentStatus).toBe("pending");
    expect(order.workflowStatus).toBe(WORKFLOW_STATUS.FRANCHISE_ACCEPTED);
  });

  it("syncs franchise partner order to out for delivery", () => {
    const order = {
      workflowVersion: 2,
      franchisePartnerId: "partner-1",
      isFranchiseStockOrder: false,
      franchiseStatus: "accepted",
      shipmentStatus: "created",
      workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
      status: "packed",
      orderStatus: "packed",
    };

    applyManualLegacyStatusOverride(order, "out_for_delivery");

    expect(order.status).toBe("out_for_delivery");
    expect(order.workflowStatus).toBe(WORKFLOW_STATUS.OUT_FOR_DELIVERY);
    expect(order.franchiseStatus).toBe("accepted");
    expect(order.shipmentStatus).toBe("created");
    expect(order.outForDeliveryAt).toBeInstanceOf(Date);
    expect(resolveLegacyStatusFromOrder(order)).toBe("out_for_delivery");
  });

  it("resolves franchise packed shipment before workflow out for delivery", () => {
    const packed = {
      workflowVersion: 2,
      franchisePartnerId: "partner-1",
      isFranchiseStockOrder: false,
      franchiseStatus: "accepted",
      shipmentStatus: "created",
      workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
      status: "packed",
    };
    expect(resolveLegacyStatusFromOrder(packed)).toBe("packed");

    const inTransit = {
      ...packed,
      workflowStatus: WORKFLOW_STATUS.OUT_FOR_DELIVERY,
      status: "out_for_delivery",
    };
    expect(resolveLegacyStatusFromOrder(inTransit)).toBe("out_for_delivery");
  });
});

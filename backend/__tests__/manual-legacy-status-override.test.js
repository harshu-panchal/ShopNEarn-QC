import { describe, expect, it } from "@jest/globals";
import {
  WORKFLOW_STATUS,
  applyManualLegacyStatusOverride,
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
});

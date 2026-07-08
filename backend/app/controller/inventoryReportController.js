import handleResponse from "../utils/helper.js";
import {
  exportReportCsv,
  getAdminB2BPurchaseRows,
  getAdminCustomerRetailRows,
  getAdminFranchiseRows,
  getAdminHubRows,
  getAdminInventoryReport,
  getAdminSellerRows,
  getCustomerRetailPurchaseReport,
  getCustomerReportRows,
  getFranchiseInventoryReport,
  getHubB2BTransferReport,
  getSellerInventoryReport,
  getTransferReconciliationReport,
} from "../services/inventory/inventoryReportService.js";
import { getFranchisePartnerByUserId } from "../services/franchise/franchiseActivationService.js";

function sendCsv(res, filename, csvContent) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csvContent || "");
}

export const getSellerInventoryReports = async (req, res) => {
  try {
    const result = await getSellerInventoryReport(req.user.id, req.query || {});
    return handleResponse(res, 200, "Seller inventory reports", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getSellerHubTransferReports = async (req, res) => {
  try {
    const result = await getHubB2BTransferReport(req.user.id, req.query || {});
    return handleResponse(res, 200, "Hub transfer reports", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getSellerTransferReconciliation = async (req, res) => {
  try {
    const result = await getTransferReconciliationReport({
      hubSellerId: req.user.id,
      transferGroupId: req.query.transferGroupId,
    });
    return handleResponse(res, 200, "Transfer reconciliation", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const exportSellerInventoryReports = async (req, res) => {
  try {
    const result = await getSellerInventoryReport(req.user.id, req.query || {});
    const csv = await exportReportCsv("seller-overview", result);
    return sendCsv(res, "seller-inventory-reports.csv", csv);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getFranchiseInventoryReports = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const result = await getFranchiseInventoryReport(partner._id, req.query || {});
    return handleResponse(res, 200, "Franchise inventory reports", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const exportFranchiseInventoryReports = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const result = await getFranchiseInventoryReport(partner._id, req.query || {});
    const csv = await exportReportCsv("movements", result.movements);
    return sendCsv(res, "franchise-inventory-reports.csv", csv);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getCustomerPurchaseReports = async (req, res) => {
  try {
    const result = await getCustomerRetailPurchaseReport(req.user.id, req.query || {});
    return handleResponse(res, 200, "Customer purchase reports", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const exportCustomerPurchaseReports = async (req, res) => {
  try {
    const result = await getCustomerRetailPurchaseReport(req.user.id, req.query || {});
    const csv = await exportReportCsv("orders", { rows: result.lines.items });
    return sendCsv(res, "customer-purchase-reports.csv", csv);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryOverviewReports = async (req, res) => {
  try {
    const data = await getAdminInventoryReport(req.query || {});
    return handleResponse(res, 200, "Admin inventory overview", data);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventorySellerReports = async (req, res) => {
  try {
    const rows = await getAdminSellerRows(req.query || {});
    return handleResponse(res, 200, "Admin seller inventory reports", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryFranchiseReports = async (req, res) => {
  try {
    const rows = await getAdminFranchiseRows(req.query || {});
    return handleResponse(res, 200, "Admin franchise inventory reports", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryHubReports = async (req, res) => {
  try {
    const rows = await getAdminHubRows(req.query || {});
    return handleResponse(res, 200, "Admin hub reports", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryB2bReports = async (req, res) => {
  try {
    const rows = await getAdminB2BPurchaseRows(req.query || {});
    return handleResponse(res, 200, "Admin B2B purchase reports", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryCustomerRetailReports = async (req, res) => {
  try {
    const rows = await getAdminCustomerRetailRows(req.query || {});
    return handleResponse(res, 200, "Admin customer retail reports", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryCustomerReports = async (req, res) => {
  try {
    const rows = await getCustomerReportRows(req.query || {});
    return handleResponse(res, 200, "Admin customer purchase summaries", { rows });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getAdminInventoryTransferReconciliation = async (req, res) => {
  try {
    const result = await getTransferReconciliationReport({
      transferGroupId: req.query.transferGroupId,
      hubSellerId: req.query.hubSellerId,
    });
    return handleResponse(res, 200, "Admin transfer reconciliation", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const exportAdminInventoryReports = async (req, res) => {
  try {
    const reportType = String(req.query.type || "sellers");
    let rows = [];
    if (reportType === "sellers") rows = await getAdminSellerRows(req.query || {});
    if (reportType === "franchise") rows = await getAdminFranchiseRows(req.query || {});
    if (reportType === "hub") rows = await getAdminHubRows(req.query || {});
    if (reportType === "b2b") rows = await getAdminB2BPurchaseRows(req.query || {});
    if (reportType === "customer-retail") rows = await getAdminCustomerRetailRows(req.query || {});
    if (reportType === "customer") rows = await getCustomerReportRows(req.query || {});
    if (reportType === "reconciliation") {
      const result = await getTransferReconciliationReport({
        transferGroupId: req.query.transferGroupId,
        hubSellerId: req.query.hubSellerId,
      });
      rows = result.items;
    }
    const csv = await exportReportCsv("orders", { rows });
    return sendCsv(res, `admin-inventory-${reportType}.csv`, csv);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

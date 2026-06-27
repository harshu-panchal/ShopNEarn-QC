import handleResponse from "../../utils/helper.js";
import Customer from "../../models/customer.js";
import FranchisePartner from "../../models/franchisePartner.js";
import {
  listFranchiseRegistrationReviews,
  approveFranchiseRegistrationPayment,
  rejectFranchiseRegistrationPayment,
} from "../../services/franchise/franchiseRegistrationPaymentService.js";
import {
  listFranchiseTopUps,
  approveFranchiseWalletTopUp,
  rejectFranchiseWalletTopUp,
  adjustFranchiseWallet,
  getFranchiseWalletBalance,
} from "../../services/franchise/franchiseWalletService.js";
import {
  listAllFranchisePartners,
  updateFranchisePartnerTerritory,
  setHubSellerFlags,
  listFranchiseOrdersForAdmin,
  assignFranchiseOrderDelivery,
} from "../../services/franchise/franchiseOrderService.js";
import { getFranchiseConfig, resolveHubSellerId } from "../../services/franchise/franchiseConfigService.js";
import Setting from "../../models/setting.js";
import { getFranchiseStockSummary } from "../../services/franchise/franchiseStockService.js";

export const getFranchiseAdminDashboard = async (req, res) => {
  try {
    const [partnerCount, pendingRegs, pendingTopUps, cfg] = await Promise.all([
      FranchisePartner.countDocuments({ status: "active" }),
      listFranchiseRegistrationReviews({ status: "PENDING_REVIEW", limit: 1 }),
      listFranchiseTopUps({ status: "pending_review", limit: 1 }),
      getFranchiseConfig(),
    ]);
    const hubSellerId = await resolveHubSellerId(cfg);
    return handleResponse(res, 200, "Franchise dashboard", {
      activePartners: partnerCount,
      pendingRegistrations: pendingRegs.total,
      pendingTopUps: pendingTopUps.total,
      hubSellerId: hubSellerId ? String(hubSellerId) : null,
      config: cfg,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const listRegistrationReviews = async (req, res) => {
  try {
    const result = await listFranchiseRegistrationReviews({
      status: req.query.status || "PENDING_REVIEW",
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
    });
    const customerIds = [...new Set(result.items.map((i) => String(i.customer)))];
    const customers = customerIds.length
      ? await Customer.find({ _id: { $in: customerIds } }, { name: 1, phone: 1, email: 1, createdAt: 1 }).lean()
      : [];
    const cmap = new Map(customers.map((c) => [String(c._id), c]));
    const enriched = result.items.map((row) => ({
      ...row,
      customerInfo: cmap.get(String(row.customer)) || null,
    }));
    return handleResponse(res, 200, "Registration reviews", { ...result, items: enriched });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const approveRegistration = async (req, res) => {
  try {
    const payment = await approveFranchiseRegistrationPayment({
      paymentId: req.params.id,
      adminId: req.user?.id,
      adminRemarks: req.body?.adminRemarks,
    });
    return handleResponse(res, 200, "Registration approved", { paymentId: String(payment._id) });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const rejectRegistration = async (req, res) => {
  try {
    const payment = await rejectFranchiseRegistrationPayment({
      paymentId: req.params.id,
      adminId: req.user?.id,
      reason: req.body?.reason,
    });
    return handleResponse(res, 200, "Registration rejected", { paymentId: String(payment._id) });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const listTopUpReviews = async (req, res) => {
  try {
    const result = await listFranchiseTopUps({
      status: req.query.status || "pending_review",
      page: req.query.page,
      limit: req.query.limit,
    });
    const partnerIds = [...new Set(result.items.map((i) => String(i.franchisePartnerId)))];
    const partners = partnerIds.length
      ? await FranchisePartner.find({ _id: { $in: partnerIds } })
          .populate("userId", "name phone email")
          .lean()
      : [];
    const pmap = new Map(partners.map((p) => [String(p._id), p]));
    const enriched = result.items.map((row) => ({
      ...row,
      partnerInfo: pmap.get(String(row.franchisePartnerId)) || null,
    }));
    return handleResponse(res, 200, "Top-up reviews", { ...result, items: enriched });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const approveTopUp = async (req, res) => {
  try {
    const result = await approveFranchiseWalletTopUp({
      topUpId: req.params.id,
      adminId: req.user?.id,
      adminRemarks: req.body?.adminRemarks,
    });
    return handleResponse(res, 200, "Top-up approved", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const rejectTopUp = async (req, res) => {
  try {
    const topUp = await rejectFranchiseWalletTopUp({
      topUpId: req.params.id,
      adminId: req.user?.id,
      reason: req.body?.reason,
    });
    return handleResponse(res, 200, "Top-up rejected", { topUpId: String(topUp._id) });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const listPartners = async (req, res) => {
  try {
    const result = await listAllFranchisePartners({
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
    });
    const withWallets = await Promise.all(
      result.items.map(async (row) => {
        const wallet = await getFranchiseWalletBalance(row._id);
        return { ...row, wallet };
      }),
    );
    return handleResponse(res, 200, "Franchise partners", { ...result, items: withWallets });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getPartnerDetail = async (req, res) => {
  try {
    const partner = await FranchisePartner.findById(req.params.id)
      .populate("userId", "name phone email")
      .lean();
    if (!partner) return handleResponse(res, 404, "Partner not found");
    const [wallet, stock] = await Promise.all([
      getFranchiseWalletBalance(partner._id),
      getFranchiseStockSummary(partner._id),
    ]);
    return handleResponse(res, 200, "Partner detail", { partner, wallet, stock });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const patchPartnerTerritory = async (req, res) => {
  try {
    const partner = await updateFranchisePartnerTerritory({
      franchisePartnerId: req.params.id,
      territoryPincodes: req.body?.territoryPincodes,
      adminId: req.user?.id,
    });
    return handleResponse(res, 200, "Territory updated", { partner });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const adjustWallet = async (req, res) => {
  try {
    const { amount, direction, reason } = req.body || {};
    if (!amount || !direction || !reason) {
      return handleResponse(res, 400, "amount, direction, and reason are required");
    }
    const result = await adjustFranchiseWallet({
      franchisePartnerId: req.params.id,
      amount,
      direction,
      reason,
      adminId: req.user?.id,
    });
    return handleResponse(res, 200, "Wallet adjusted", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const updateFranchiseSettings = async (req, res) => {
  try {
    const payload = req.body || {};
    const toSet = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) continue;
      toSet[`homeShoppy.${k}`] = v;
    }
    if (Object.keys(toSet).length === 0) {
      return handleResponse(res, 200, "No changes", await getFranchiseConfig());
    }
    await Setting.findOneAndUpdate(
      { $or: [{ tenantId: null }, { tenantId: { $exists: false } }] },
      { $set: toSet },
      { upsert: true },
    );
    if (payload.hubSellerId) {
      await setHubSellerFlags({ sellerId: payload.hubSellerId, isPlatformHub: true });
    }
    return handleResponse(res, 200, "Settings updated", await getFranchiseConfig());
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const getFranchiseSettings = async (req, res) => {
  try {
    const cfg = await getFranchiseConfig();
    return handleResponse(res, 200, "Franchise settings", cfg);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const markHubSeller = async (req, res) => {
  try {
    const seller = await setHubSellerFlags({
      sellerId: req.params.sellerId,
      isPlatformHub: true,
    });
    if (!seller) return handleResponse(res, 404, "Seller not found");
    return handleResponse(res, 200, "Hub seller updated", { sellerId: String(seller._id), shopName: seller.shopName });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const listFranchiseDispatchOrders = async (req, res) => {
  try {
    const result = await listFranchiseOrdersForAdmin({
      dispatchStatus: req.query.dispatchStatus || "awaiting_dispatch",
      page: req.query.page,
      limit: req.query.limit,
    });
    return handleResponse(res, 200, "Franchise dispatch orders", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const assignFranchiseDispatchDelivery = async (req, res) => {
  try {
    const { deliveryBoyId } = req.body || {};
    if (!deliveryBoyId) {
      return handleResponse(res, 400, "deliveryBoyId is required");
    }
    const order = await assignFranchiseOrderDelivery({
      orderId: req.params.orderId,
      deliveryBoyId,
      adminId: req.user?.id,
    });
    return handleResponse(res, 200, "Delivery partner assigned", { orderId: order.orderId });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

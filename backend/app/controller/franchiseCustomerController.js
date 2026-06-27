import handleResponse from "../utils/helper.js";
import { getFranchiseConfig } from "../services/franchise/franchiseConfigService.js";
import { formatFranchiseAddress } from "../services/franchise/franchiseAddressUtils.js";
import { getFranchisePartnerByUserId } from "../services/franchise/franchiseActivationService.js";
import { FRANCHISE_PARTNER_STATUS } from "../constants/franchise.js";
import {
  initiateFranchiseRegistrationPayment,
  submitFranchiseRegistrationProof,
  getFranchiseRegistrationPaymentForCustomer,
  getFranchiseRegistrationStateForCustomer,
} from "../services/franchise/franchiseRegistrationPaymentService.js";
import {
  getFranchiseWalletBalance,
  createFranchiseWalletTopUpRequest,
  submitFranchiseTopUpProof,
  listFranchiseTopUps,
} from "../services/franchise/franchiseWalletService.js";
import { listHubCatalogProducts } from "../services/franchise/franchiseCatalogService.js";
import { purchaseFranchiseStock, getFranchiseStockSummary } from "../services/franchise/franchiseStockService.js";
import {
  listFranchisePartnerOrders,
  acceptFranchiseOrder,
  rejectFranchiseOrder,
  fulfillFranchiseOrder,
} from "../services/franchise/franchiseOrderService.js";

export const getFranchiseMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const [cfg, partner, registration] = await Promise.all([
      getFranchiseConfig(),
      getFranchisePartnerByUserId(userId),
      getFranchiseRegistrationStateForCustomer(userId),
    ]);
    const isActivePartner =
      !!partner &&
      [FRANCHISE_PARTNER_STATUS.ACTIVE, FRANCHISE_PARTNER_STATUS.SUSPENDED].includes(
        partner.status,
      );
    let wallet = null;
    if (isActivePartner) {
      wallet = await getFranchiseWalletBalance(partner._id);
    }
    return handleResponse(res, 200, "Franchise profile", {
      enabled: !!cfg.enabled,
      config: {
        registrationPrice: cfg.registrationPrice,
        walletCreditMultiplier: cfg.walletCreditMultiplier,
        hubShopDisplayName: cfg.hubShopDisplayName,
      },
      isPartner: isActivePartner,
      registration,
      partner: isActivePartner
        ? {
            id: partner._id,
            referralCode: partner.referralCode,
            status: partner.status,
            territoryPincodes: partner.territoryPincodes || [],
            address: partner.address || formatFranchiseAddress(partner),
            locality: partner.locality || "",
            pincode: partner.pincode || "",
            city: partner.city || "",
            state: partner.state || "",
            registeredAt: partner.registeredAt,
            displayName: partner.displayName,
          }
        : null,
      wallet,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const initiateRegistration = async (req, res) => {
  try {
    const body = req.body || {};
    const result = await initiateFranchiseRegistrationPayment({
      userId: req.user.id,
      idempotencyKey: req.headers["idempotency-key"] || body.idempotencyKey,
      address: body.address,
      locality: body.locality,
      pincode: body.pincode,
      city: body.city,
      state: body.state,
      lat: body.lat,
      lng: body.lng,
    });
    return handleResponse(res, 200, "Registration payment initiated", result);
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
  }
};

export const submitRegistrationProof = async (req, res) => {
  try {
    const { paymentId, transactionId, screenshotUrl, paidAmount } = req.body || {};
    const payment = await submitFranchiseRegistrationProof({
      userId: req.user.id,
      paymentId,
      transactionId,
      screenshotUrl,
      paidAmount,
    });
    return handleResponse(res, 200, "Proof submitted", { paymentId: String(payment._id), status: payment.status });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const getRegistrationPayment = async (req, res) => {
  try {
    const payment = await getFranchiseRegistrationPaymentForCustomer(req.user.id, req.params.paymentId);
    if (!payment) return handleResponse(res, 404, "Payment not found");
    return handleResponse(res, 200, "Registration payment", payment);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const getCatalog = async (req, res) => {
  try {
    const result = await listHubCatalogProducts({
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
    });
    return handleResponse(res, 200, "Hub catalog", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const requestWalletTopUp = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const { amount } = req.body || {};
    const result = await createFranchiseWalletTopUpRequest({
      franchisePartnerId: partner._id,
      userId: req.user.id,
      amount,
    });
    return handleResponse(res, 201, "Top-up request created", {
      topUpId: String(result.topUp._id),
      amount: result.topUp.amount,
      manualQr: result.manualQr,
    });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const submitTopUpProof = async (req, res) => {
  try {
    const { topUpId, transactionId, screenshotUrl, paidAmount } = req.body || {};
    const topUp = await submitFranchiseTopUpProof({
      topUpId,
      userId: req.user.id,
      transactionId,
      screenshotUrl,
      paidAmount,
    });
    return handleResponse(res, 200, "Top-up proof submitted", { topUpId: String(topUp._id), status: topUp.status });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const listMyTopUps = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const items = await listFranchiseTopUps({ status: "ALL", limit: 50 });
    const mine = items.items.filter((t) => String(t.franchisePartnerId) === String(partner._id));
    return handleResponse(res, 200, "Top-up history", { items: mine });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const purchaseStock = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const result = await purchaseFranchiseStock({
      franchisePartnerId: partner._id,
      userId: req.user.id,
      items: req.body?.items || [],
    });
    return handleResponse(res, 200, "Stock purchased", result);
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 400,
      error.message,
      error.code ? { code: error.code } : undefined,
    );
  }
};

export const getStock = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const items = await getFranchiseStockSummary(partner._id);
    return handleResponse(res, 200, "Franchise stock", { items });
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const listOrders = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const result = await listFranchisePartnerOrders(partner._id, {
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return handleResponse(res, 200, "Franchise orders", result);
  } catch (error) {
    return handleResponse(res, error.statusCode || 500, error.message);
  }
};

export const acceptOrder = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const order = await acceptFranchiseOrder({
      franchisePartnerId: partner._id,
      orderId: req.params.orderId,
    });
    return handleResponse(res, 200, "Order accepted", { orderId: order.orderId, franchiseStatus: order.franchiseStatus });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const rejectOrder = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const order = await rejectFranchiseOrder({
      franchisePartnerId: partner._id,
      orderId: req.params.orderId,
      reason: req.body?.reason,
    });
    return handleResponse(res, 200, "Order rejected", { orderId: order.orderId, franchiseStatus: order.franchiseStatus });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

export const fulfillOrder = async (req, res) => {
  try {
    const partner = await getFranchisePartnerByUserId(req.user.id);
    if (!partner) return handleResponse(res, 404, "Not a franchise partner");
    const order = await fulfillFranchiseOrder({
      franchisePartnerId: partner._id,
      orderId: req.params.orderId,
    });
    return handleResponse(res, 200, "Order fulfilled", { orderId: order.orderId, franchiseStatus: order.franchiseStatus });
  } catch (error) {
    return handleResponse(res, error.statusCode || 400, error.message);
  }
};

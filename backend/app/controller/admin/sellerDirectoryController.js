import jwt from "jsonwebtoken";
import handleResponse from "../../utils/helper.js";
import getPagination from "../../utils/pagination.js";
import Seller from "../../models/seller.js";
import {
  getActiveSellersData,
  getSellerLocationsData,
  getSellerOptions,
} from "../../services/admin/sellerDirectoryService.js";

const SELLER_IMPERSONATION_TOKEN_TTL_SECONDS = 15 * 60;

export const getSellerLocations = async (req, res) => {
  try {
    const {
      q = "",
      category = "all",
      city = "all",
      lifecycle = "all",
      mapLimit: rawMapLimit = "500",
      sort = "orders_desc",
    } = req.query;

    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 25,
      maxLimit: 100,
    });

    const data = await getSellerLocationsData({
      q,
      category,
      city,
      lifecycle,
      mapLimit: rawMapLimit,
      sort,
      page,
      limit,
      skip,
    });

    return handleResponse(res, 200, "Seller locations fetched successfully", data);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getActiveSellers = async (req, res) => {
  try {
    const { q = "", category = "all", sort = "recent" } = req.query;
    const { page, limit, skip } = getPagination(req, {
      defaultLimit: 20,
      maxLimit: 100,
    });

    const data = await getActiveSellersData({
      q,
      category,
      sort,
      page,
      limit,
      skip,
    });

    return handleResponse(res, 200, "Active sellers fetched successfully", data);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getSellers = async (req, res) => {
  try {
    const sellers = await getSellerOptions();
    return handleResponse(res, 200, "Sellers fetched", sellers);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/**
 * POST /api/admin/sellers/:id/impersonation-token
 *
 * Admin support tool: mints a short-lived seller JWT so the admin
 * frontend can open the seller panel in a new tab pre-authenticated
 * as the chosen seller — same pattern as MLM member impersonation.
 */
export const issueSellerImpersonationToken = async (req, res) => {
  try {
    const seller = await Seller.findById(req.params.id).lean();
    if (!seller) {
      return handleResponse(res, 404, "Seller not found");
    }

    const applicationStatus =
      seller.applicationStatus || (seller.isVerified ? "approved" : "pending");
    const isApproved =
      seller.isVerified === true &&
      seller.isActive === true &&
      applicationStatus === "approved";

    if (!isApproved) {
      return handleResponse(
        res,
        403,
        "Cannot sign in — this seller account is not approved or active.",
      );
    }

    const adminId = req.user?.id || null;
    const shopName = seller.shopName || seller.name || "Seller";

    const token = jwt.sign(
      {
        id: seller._id,
        role: "seller",
        act: { id: adminId, type: "admin" },
        impersonated: true,
      },
      process.env.JWT_SECRET,
      { expiresIn: SELLER_IMPERSONATION_TOKEN_TTL_SECONDS },
    );

    console.warn(
      `[admin-impersonation] admin=${adminId} -> seller=${seller._id}`,
    );

    const { password: _password, ...safeSeller } = seller;

    return handleResponse(res, 200, "Seller impersonation token issued", {
      token,
      expiresInSeconds: SELLER_IMPERSONATION_TOKEN_TTL_SECONDS,
      redirect: "/seller",
      shopName,
      seller: safeSeller,
    });
  } catch (error) {
    return handleResponse(
      res,
      error.statusCode || 500,
      error.message || "Failed to issue seller impersonation token",
    );
  }
};

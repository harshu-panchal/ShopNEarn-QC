import handleResponse from "../utils/helper.js";
import { getAdminNavBadgeCounts } from "../services/admin/navBadgeService.js";
import { getSellerNavBadgeCounts } from "../services/seller/navBadgeService.js";

function parseSinceQuery(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

export const getAdminNavBadges = async (req, res) => {
  try {
    const sinceByKey = parseSinceQuery(req.query?.since);
    const result = await getAdminNavBadgeCounts(sinceByKey);
    return handleResponse(res, 200, "Admin nav badges", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getSellerNavBadges = async (req, res) => {
  try {
    const sinceByKey = parseSinceQuery(req.query?.since);
    const result = await getSellerNavBadgeCounts(req.user.id, sinceByKey);
    return handleResponse(res, 200, "Seller nav badges", result);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

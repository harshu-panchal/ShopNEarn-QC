import HeroConfig from "../models/heroConfig.js";
import Category from "../models/category.js";
import handleResponse from "../utils/helper.js";
import { buildKey, getOrSet, getTTL, invalidate } from "../services/cacheService.js";
import { uploadToCloudinary } from "../services/mediaService.js";

const normalizeUrl = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized || !/^https?:\/\//i.test(normalized)) {
    return "";
  }
  return normalized;
};

/* ===============================
   ADMIN: Upload banner image
================================ */
export const uploadBannerImage = async (req, res) => {
  try {
    if (req.file) {
      const uploadedUrl = await uploadToCloudinary(req.file.buffer, "banners", {
        mimeType: req.file.mimetype,
        resourceType: "image",
      });
      await invalidate("cache:experience:hero:*");
      return handleResponse(res, 200, "Banner image uploaded", { url: uploadedUrl });
    }

    const url = normalizeUrl(req.body?.url || req.body?.imageUrl);
    if (!url) {
      return handleResponse(res, 400, "A valid image URL is required");
    }
    await invalidate("cache:experience:hero:*");
    return handleResponse(res, 200, "Banner image uploaded", { url });
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   HERO CONFIG
   Public: get hero config for a page (with fallback to home)
   Admin: get one / list, upsert
================================ */

export const getPublicHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;

    if (!pageType) {
      return handleResponse(res, 400, "pageType is required");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    const cacheKey = buildKey(
      "experience",
      "hero",
      `${pageType}:${headerId || "root"}`,
    );
    const config = await getOrSet(
      cacheKey,
      async () => {
        let resolved = null;
        if (pageType === "header") {
          resolved = await HeroConfig.findOne({
            pageType: "header",
            headerId,
          }).lean();
        }
        if (!resolved && (pageType === "home" || pageType === "header")) {
          resolved = await HeroConfig.findOne({
            pageType: "home",
            headerId: null,
          }).lean();
        }
        return resolved || null;
      },
      getTTL("homepage"),
    );

    const payload = config
      ? {
          banners: config.banners || { items: [] },
          categoryIds: config.categoryIds || [],
        }
      : { banners: { items: [] }, categoryIds: [] };

    return handleResponse(res, 200, "Hero config fetched", payload);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const getAdminHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId } = req.query;

    if (!pageType) {
      return handleResponse(res, 400, "pageType is required");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    const config = await HeroConfig.findOne({
      pageType,
      headerId: pageType === "header" ? headerId : null,
    }).lean();

    return handleResponse(
      res,
      200,
      "Hero config fetched",
      config || { banners: { items: [] }, categoryIds: [] }
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const upsertHeroConfig = async (req, res) => {
  try {
    const { pageType, headerId, banners, categoryIds } = req.body;

    if (!["home", "header"].includes(pageType)) {
      return handleResponse(res, 400, "Invalid pageType");
    }

    if (pageType === "header" && !headerId) {
      return handleResponse(res, 400, "headerId is required for header pageType");
    }

    if (pageType === "header") {
      const header = await Category.findOne({ _id: headerId, type: "header" });
      if (!header) {
        return handleResponse(res, 400, "Invalid headerId");
      }
    }

    const bannerItems = Array.isArray(banners?.items)
      ? banners.items
        .filter((b) => b && b.imageUrl)
        .map((b) => ({
          imageUrl: b.imageUrl,
          title: b.title || "",
          subtitle: b.subtitle || "",
          linkType: b.linkType || "none",
          linkValue: b.linkValue || "",
          status: b.status || "active",
        }))
      : [];

    const ids = Array.isArray(categoryIds) ? categoryIds.filter(Boolean) : [];

    const filter = {
      pageType,
      headerId: pageType === "header" ? headerId : null,
    };

    const update = {
      banners: { items: bannerItems },
      categoryIds: ids,
    };

    const config = await HeroConfig.findOneAndUpdate(
      filter,
      { $set: update },
      { new: true, upsert: true, runValidators: true }
    ).lean();
    await invalidate("cache:experience:hero:*");

    return handleResponse(res, 200, "Hero config saved", config);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

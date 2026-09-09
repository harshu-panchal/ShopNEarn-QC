import Cart from "../models/cart.js";
import Product from "../models/product.js";
import User from "../models/customer.js";
import handleResponse from "../utils/helper.js";
import { getApprovedOrLegacyFilter } from "../services/productModerationService.js";
import {
  buildInsufficientStockMessage,
  resolveAvailableStock,
} from "../utils/productStockUtils.js";
import { resolveCatalogStockForProducts } from "../services/franchise/franchiseStockResolver.js";

async function resolveCustomerLocationParams(customerId, bodyLocation = {}) {
  let { lat, lng, pincode } = bodyLocation || {};

  const hasLat = Number.isFinite(Number(lat));
  const hasLng = Number.isFinite(Number(lng));
  const cleanPincode = String(pincode || "").trim();

  if ((hasLat && hasLng) || cleanPincode) {
    return { lat, lng, pincode: cleanPincode };
  }

  if (customerId) {
    try {
      const customer = await User.findById(customerId).select("addresses address pincode").lean();
      if (customer) {
        const primaryAddr = Array.isArray(customer.addresses) && customer.addresses.length > 0
          ? (customer.addresses.find((a) => a.isDefault || a.isCurrent) || customer.addresses[0])
          : null;

        const resolvedPincode = String(primaryAddr?.pincode || customer.pincode || "").trim();
        let resolvedLat = lat;
        let resolvedLng = lng;

        if (primaryAddr?.location && Number.isFinite(Number(primaryAddr.location.lat)) && Number.isFinite(Number(primaryAddr.location.lng))) {
          resolvedLat = primaryAddr.location.lat;
          resolvedLng = primaryAddr.location.lng;
        }

        return {
          lat: resolvedLat,
          lng: resolvedLng,
          pincode: resolvedPincode,
        };
      }
    } catch {}
  }

  return { lat, lng, pincode: cleanPincode };
}

const CART_POPULATE_FIELDS =
  "name slug price salePrice mainImage stock status headerId categoryId subcategoryId sellerId variants";

const CUSTOMER_VISIBLE_PRODUCT_MATCH = {
  status: "active",
  ...getApprovedOrLegacyFilter(),
};

function sanitizeCartItems(cart) {
  if (!cart || !Array.isArray(cart.items)) return cart;
  cart.items = cart.items.filter((item) => Boolean(item?.productId));
  return cart;
}

async function getCustomerVisibleProductById(productId, { select = "_id" } = {}) {
  if (!productId) return null;
  return Product.findOne({
    _id: productId,
    ...CUSTOMER_VISIBLE_PRODUCT_MATCH,
  })
    .select(select)
    .lean();
}

function findCartLineIndex(cart, productId, variantSku) {
  const normalizedVariantSku = String(variantSku || "").trim();
  return cart.items.findIndex(
    (item) =>
      item.productId.toString() === String(productId) &&
      String(item.variantSku || "").trim() === normalizedVariantSku,
  );
}

async function fetchPopulatedCart(cartId) {
  const cart = await Cart.findById(cartId)
    .populate({
      path: "items.productId",
      select: CART_POPULATE_FIELDS,
      match: CUSTOMER_VISIBLE_PRODUCT_MATCH,
    })
    .lean();

  return sanitizeCartItems(cart);
}

/* ===============================
   GET CUSTOMER CART
================================ */
export const getCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    let cart = await Cart.findOne({ customerId })
      .populate({
        path: "items.productId",
        select: CART_POPULATE_FIELDS,
        match: CUSTOMER_VISIBLE_PRODUCT_MATCH,
      })
      .lean();

    if (!cart) {
      const newCart = await Cart.create({ customerId, items: [] });
      return handleResponse(res, 200, "Cart fetched successfully", newCart);
    }

    return handleResponse(res, 200, "Cart fetched successfully", sanitizeCartItems(cart));
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADD TO CART
================================ */
export const addToCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity = 1, variantSku = "", lat, lng, pincode } = req.body;
    const normalizedVariantSku = String(variantSku || "").trim();
    const addQty = Math.max(1, Number(quantity) || 1);
    const customerVisibleProduct = await getCustomerVisibleProductById(productId, {
      select: "_id name stock variants",
    });
    if (!customerVisibleProduct) {
      return handleResponse(res, 404, "Product is not available for purchase");
    }

    // Stock shown to the customer while browsing is resolved against their
    // nearest franchise partner's own ledger (see `resolveCatalogStockForProducts`),
    // not this product's raw hub-level `stock` field. Re-resolve the same way
    // here so "add to cart" agrees with what they just saw in the catalog.
    const locParams = await resolveCustomerLocationParams(customerId, { lat, lng, pincode });
    await resolveCatalogStockForProducts([customerVisibleProduct], locParams);

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      cart = new Cart({ customerId, items: [] });
    }

    const itemIndex = findCartLineIndex(cart, productId, normalizedVariantSku);
    const currentQty = itemIndex > -1 ? Number(cart.items[itemIndex].quantity || 0) : 0;
    const available = resolveAvailableStock(customerVisibleProduct, normalizedVariantSku);
    const requestedTotal = currentQty + addQty;

    if (requestedTotal > available) {
      return handleResponse(
        res,
        422,
        buildInsufficientStockMessage(available, customerVisibleProduct.name, currentQty),
        { code: "INSUFFICIENT_STOCK" },
      );
    }

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += addQty;
    } else {
      cart.items.push({
        productId,
        variantSku: normalizedVariantSku,
        quantity: addQty,
      });
    }

    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Item added to cart", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   UPDATE QUANTITY
================================ */
export const updateQuantity = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity, variantSku = "", lat, lng, pincode } = req.body;
    const normalizedVariantSku = String(variantSku || "").trim();
    const nextQty = Math.max(0, Number(quantity) || 0);

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      return handleResponse(res, 404, "Cart not found");
    }

    const itemIndex = findCartLineIndex(cart, productId, normalizedVariantSku);

    if (itemIndex > -1) {
      if (nextQty <= 0) {
        cart.items.splice(itemIndex, 1);
      } else {
        const product = await getCustomerVisibleProductById(productId, {
          select: "_id name stock variants",
        });
        if (!product) {
          return handleResponse(res, 404, "Product is not available for purchase");
        }
        // See addToCart — re-resolve franchise-ledger stock so this agrees
        // with what the customer saw while browsing.
        const updateLocParams = await resolveCustomerLocationParams(customerId, { lat, lng, pincode });
        await resolveCatalogStockForProducts([product], updateLocParams);
        const available = resolveAvailableStock(product, normalizedVariantSku);
        if (nextQty > available) {
          const previousQty = Number(cart.items[itemIndex].quantity || 0);
          return handleResponse(
            res,
            422,
            buildInsufficientStockMessage(available, product.name, previousQty),
            { code: "INSUFFICIENT_STOCK" },
          );
        }
        cart.items[itemIndex].quantity = nextQty;
      }
    } else {
      return handleResponse(res, 404, "Product not in cart");
    }

    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Cart updated successfully", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   REMOVE FROM CART
================================ */
export const removeFromCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId } = req.params;
    const normalizedVariantSku = String(req.query?.variantSku || "").trim();

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      return handleResponse(res, 404, "Cart not found");
    }

    cart.items = cart.items.filter((item) => {
      if (item.productId.toString() !== productId) return true;
      // If variantSku is provided, remove only that variant line.
      if (normalizedVariantSku) {
        return String(item.variantSku || "").trim() !== normalizedVariantSku;
      }
      // If no variantSku is provided, keep legacy behavior: remove all lines for that product.
      return false;
    });

    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Item removed from cart", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CLEAR CART
================================ */
export const clearCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    let cart = await Cart.findOne({ customerId });

    if (cart) {
      cart.items = [];
      await cart.save();
    }

    return handleResponse(res, 200, "Cart cleared successfully");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

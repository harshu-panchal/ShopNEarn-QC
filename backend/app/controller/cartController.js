import Cart from "../models/cart.js";
import Product from "../models/product.js";
import handleResponse from "../utils/helper.js";
import { getApprovedOrLegacyFilter } from "../services/productModerationService.js";
import {
  buildInsufficientStockMessage,
  resolveAvailableStock,
} from "../utils/productStockUtils.js";

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
    const { productId, quantity = 1, variantSku = "" } = req.body;
    const normalizedVariantSku = String(variantSku || "").trim();
    const addQty = Math.max(1, Number(quantity) || 1);
    const customerVisibleProduct = await getCustomerVisibleProductById(productId, {
      select: "_id name stock variants",
    });
    if (!customerVisibleProduct) {
      return handleResponse(res, 404, "Product is not available for purchase");
    }

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
        buildInsufficientStockMessage(available, customerVisibleProduct.name),
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
    const { productId, quantity, variantSku = "" } = req.body;
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
        const available = resolveAvailableStock(product, normalizedVariantSku);
        if (nextQty > available) {
          return handleResponse(
            res,
            422,
            buildInsufficientStockMessage(available, product.name),
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

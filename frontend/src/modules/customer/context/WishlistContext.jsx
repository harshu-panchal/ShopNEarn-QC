import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { customerApi } from "../services/customerApi";
import { useAuth } from "../../../core/context/AuthContext";
import { getJSON, setJSON, remove as removeStorage, STORAGE_KEYS } from "@core/utils/storage";

const WishlistContext = createContext();

const loadGuestWishlist = () => {
  const parsed = getJSON(STORAGE_KEYS.WISHLIST, []);
  if (!Array.isArray(parsed)) {
    removeStorage(STORAGE_KEYS.WISHLIST);
    return [];
  }
  return parsed;
};

export const useWishlist = () => useContext(WishlistContext);

export const WishlistProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [wishlist, setWishlist] = useState(() => loadGuestWishlist());

  const [loading, setLoading] = useState(false);
  const [isFullDataFetched, setIsFullDataFetched] = useState(false);

  // Fetch wishlist from backend on mount or authentication change
  const fetchWishlistIds = async () => {
    if (isAuthenticated) {
      setLoading(true);
      try {
        const response = await customerApi.getWishlist({ idsOnly: true });
        // Handle both populated and unpopulated products for flexibility
        const products = response.data.result.products || [];
        const backendWishlist = products.map((product) => {
          if (typeof product === "string") {
            return { id: product, _id: product };
          }
          return {
            ...product,
            id: product._id,
            image: product.mainImage,
          };
        });
        setWishlist(backendWishlist);
        setIsFullDataFetched(false);
      } catch (error) {
        console.error("Failed to fetch wishlist from backend", error);
      } finally {
        setLoading(false);
      }
    }
  };

  const fetchFullWishlist = async () => {
    if (isAuthenticated) {
      setLoading(true);
      try {
        const response = await customerApi.getWishlist({ idsOnly: false });
        const products = response.data.result.products || [];
        const backendWishlist = products.map((product) => ({
          ...product,
          id: product._id,
          image: product.mainImage,
        }));
        setWishlist(backendWishlist);
        setIsFullDataFetched(true);
      } catch (error) {
        console.error("Failed to fetch full wishlist from backend", error);
      } finally {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      // Drop the guest blob — backend is now the source of truth and we
      // don't want stale state to resurface on logout for another user on
      // the same browser.
      removeStorage(STORAGE_KEYS.WISHLIST);
      fetchWishlistIds();
    } else {
      setWishlist(loadGuestWishlist());
      setIsFullDataFetched(true); // Local storage always has full data
    }
  }, [isAuthenticated]);

  // Save local wishlist to localStorage (fallback/guest mode)
  useEffect(() => {
    if (!isAuthenticated) {
      setJSON(STORAGE_KEYS.WISHLIST, wishlist);
    }
  }, [wishlist, isAuthenticated]);

  const addToWishlist = async (product) => {
    if (isAuthenticated) {
      try {
        const response = await customerApi.addToWishlist({
          productId: product.id || product._id,
        });
        const backendWishlist = response.data.result.products.map((p) => ({
          ...p,
          id: p._id,
          image: p.mainImage,
        }));
        setWishlist(backendWishlist);
        setIsFullDataFetched(true);
      } catch (error) {
        console.error("Error adding to wishlist on backend", error);
      }
    } else {
      setWishlist((prev) => {
        const id = product.id || product._id;
        if (prev.some((item) => (item.id || item._id) === id)) return prev;
        return [...prev, { ...product, id }];
      });
    }
  };

  const removeFromWishlist = async (productId) => {
    if (isAuthenticated) {
      try {
        const response = await customerApi.removeFromWishlist(productId);
        const backendWishlist = response.data.result.products.map((p) => ({
          ...p,
          id: p._id,
          image: p.mainImage,
        }));
        setWishlist(backendWishlist);
        setIsFullDataFetched(true);
      } catch (error) {
        console.error("Error removing from wishlist on backend", error);
      }
    } else {
      setWishlist((prev) =>
        prev.filter((item) => (item.id || item._id) !== productId),
      );
    }
  };

  const toggleWishlist = async (product) => {
    const id = product.id || product._id;
    if (isAuthenticated) {
      try {
        const response = await customerApi.toggleWishlist({ productId: id });
        const backendWishlist = response.data.result.products.map((p) => ({
          ...p,
          id: p._id,
          image: p.mainImage,
        }));
        setWishlist(backendWishlist);
        setIsFullDataFetched(true);
      } catch (error) {
        console.error("Error toggling wishlist on backend", error);
      }
    } else {
      if (isInWishlist(id)) {
        removeFromWishlist(id);
      } else {
        addToWishlist(product);
      }
    }
  };

  const isInWishlist = (productId) => {
    return wishlist.some((item) => (item.id || item._id) === productId);
  };

  const clearWishlist = async () => {
    // Clearing wishlist might not have a dedicated API, usually it's individual removes
    // or a clear endpoint. If no clear endpoint, we can't easily sync but let's assume local clearing first.
    setWishlist([]);
  };

  const wishlistValue = useMemo(() => ({
    wishlist,
    addToWishlist,
    removeFromWishlist,
    toggleWishlist,
    isInWishlist,
    clearWishlist,
    fetchFullWishlist,
    isFullDataFetched,
    count: wishlist.length,
    loading,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [wishlist, isFullDataFetched, loading]);

  return (
    <WishlistContext.Provider value={wishlistValue}>
      {children}
    </WishlistContext.Provider>
  );
};

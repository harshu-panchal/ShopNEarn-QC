import React, { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import ProductCard from "../shared/ProductCard";
import { customerApi } from "../../services/customerApi";

const PAGE_SIZE = 30;

const FALLBACK_PRODUCT_IMAGE =
  "https://images.unsplash.com/photo-1550989460-0adf9ea622e2?auto=format&fit=crop&q=80&w=400&h=400";

const normalizeRawProduct = (p) => ({
  ...p,
  id: p._id,
  image: p.mainImage || p.image || FALLBACK_PRODUCT_IMAGE,
  price: p.salePrice || p.price,
  originalPrice: p.price,
  weight: p.weight || "1 unit",
  deliveryTime: "8-15 mins",
});

const mergeProductsUnique = (existing = [], incoming = []) => {
  const merged = [...existing];
  const seen = new Set(merged.map((p) => String(p?._id || p?.id || "").trim()));
  incoming.forEach((p) => {
    const key = String(p?._id || p?.id || "").trim();
    if (!key || seen.has(key)) return;
    merged.push(p);
    seen.add(key);
  });
  return merged;
};

const extractProductList = (response) => {
  const rawResult = response?.data?.result;
  if (Array.isArray(response?.data?.results)) return response.data.results;
  if (Array.isArray(rawResult?.items)) return rawResult.items;
  if (Array.isArray(rawResult)) return rawResult;
  return [];
};

const extractPagination = (response) => {
  const rawResult = response?.data?.result;
  if (rawResult && typeof rawResult === "object" && !Array.isArray(rawResult)) {
    return {
      total: Number(rawResult.total) || 0,
      totalPages: Number(rawResult.totalPages) || 1,
      page: Number(rawResult.page) || 1,
    };
  }
  return { total: 0, totalPages: 1, page: 1 };
};

const CategoryProductFeed = ({ activeCategory, location }) => {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const buildParams = useCallback(
    (pageNum) => {
      const params = { page: pageNum, limit: PAGE_SIZE, sort: "newest" };
      const headerId = activeCategory?._id;
      if (headerId && headerId !== "all") {
        params.headerId = headerId;
      }
      if (
        Number.isFinite(location?.latitude) &&
        Number.isFinite(location?.longitude)
      ) {
        params.lat = location.latitude;
        params.lng = location.longitude;
      }
      return params;
    },
    [activeCategory?._id, location?.latitude, location?.longitude]
  );

  const fetchPage = useCallback(
    async (pageNum, { append = false } = {}) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }

      try {
        const res = await customerApi.getProducts(buildParams(pageNum), {
          forceRefresh: !append,
          ttl: append ? undefined : 0,
        });
        if (!res.data?.success) {
          if (!append) {
            setItems([]);
            setTotal(0);
            setTotalPages(1);
            setPage(1);
          }
          return;
        }

        const raw = extractProductList(res);
        const normalized = raw.map(normalizeRawProduct);
        const pagination = extractPagination(res);

        setItems((prev) =>
          append ? mergeProductsUnique(prev, normalized) : normalized
        );
        setTotal(pagination.total);
        setTotalPages(pagination.totalPages);
        setPage(pageNum);
      } catch (error) {
        console.error("Error fetching category products:", error);
        if (!append) {
          setItems([]);
          setTotal(0);
          setTotalPages(1);
          setPage(1);
        }
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [buildParams]
  );

  useEffect(() => {
    fetchPage(1, { append: false });
  }, [fetchPage]);

  const hasMore = page < totalPages;
  const remainingCount = Math.max(0, total - items.length);

  const handleLoadMore = () => {
    if (!hasMore || isLoadingMore) return;
    fetchPage(page + 1, { append: true });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 md:px-8 lg:px-[50px] py-10 md:py-16">
        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="aspect-3/4 rounded-2xl bg-slate-100 animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="container mx-auto px-4 md:px-8 lg:px-[50px] py-10 md:py-16 text-center">
        <p className="text-sm font-semibold text-slate-500">
          No products found
          {activeCategory?.name && activeCategory._id !== "all"
            ? ` in ${activeCategory.name}`
            : ""}
          .
        </p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-8 lg:px-[50px] py-10 md:py-16">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-black text-[#1A1A1A]">
          {activeCategory?._id === "all"
            ? "All Products"
            : activeCategory?.name || "Products"}
        </h2>
        <span className="text-[11px] font-semibold text-slate-400">
          {total} items
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
        {items.map((product) => (
          <div key={product._id || product.id}>
            <ProductCard product={product} compact neutralBg />
          </div>
        ))}
      </div>

      {hasMore && (
        <div className="mt-6">
          <button
            type="button"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
            className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 transition-all hover:border-primary/40 hover:bg-primary/10 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] active:scale-[0.99] disabled:opacity-60"
            aria-label="See more products"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex min-w-0 flex-col items-start text-left">
                <span className="text-[13px] font-extrabold leading-tight text-primary">
                  {isLoadingMore ? "Loading..." : "See more products"}
                </span>
                <span className="text-[11px] font-semibold text-primary/60">
                  {remainingCount} more available
                </span>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-1" />
          </button>
        </div>
      )}
    </div>
  );
};

export default CategoryProductFeed;

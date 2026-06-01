import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import ProductCard from "../shared/ProductCard";
import { cn } from "@/lib/utils";
import ExperienceBannerCarousel from "./ExperienceBannerCarousel";
import { setJSON, STORAGE_KEYS } from "@core/utils/storage";

const rememberExperienceReturn = (headerId, sectionId) =>
  setJSON(
    STORAGE_KEYS.EXPERIENCE_RETURN,
    { headerId: headerId || null, sectionId: sectionId || null },
    { storage: "session" },
  );

const LAZY_CHUNK_SIZE = 20;
const LAZY_ROOT_MARGIN = "260px 0px";

// Product grid sections reveal this many rows at a time. The customer sees
// the first page immediately; tapping "See more products" loads the next
// page (so on a 2-column section: 6 products at a time).
const PRODUCT_GRID_ROWS_PER_PAGE = 3;

const LazyLoadTrigger = ({ enabled, onVisible }) => {
  const ref = React.useRef(null);

  React.useEffect(() => {
    if (!enabled) return undefined;
    const node = ref.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      onVisible();
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) onVisible();
        });
      },
      { root: null, rootMargin: LAZY_ROOT_MARGIN, threshold: 0.01 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, onVisible]);

  return <div ref={ref} className="h-2 w-full" aria-hidden="true" />;
};

const SectionRenderer = ({ sections = [], productsById = {}, categoriesById = {}, subcategoriesById = {} }) => {
  const navigate = useNavigate();
  const [sectionVisibleCounts, setSectionVisibleCounts] = React.useState({});
  // For product grids we expand by *rows* (page = PRODUCT_GRID_ROWS_PER_PAGE
  // rows). This is intentionally separate from `sectionVisibleCounts` so
  // banner/category/subcategory rails keep their existing IO-based reveal.
  const [productRowPages, setProductRowPages] = React.useState({});

  const loadMoreForSection = React.useCallback((sectionKey, totalCount) => {
    if (!sectionKey || totalCount <= 0) return;
    setSectionVisibleCounts((prev) => {
      const current = prev[sectionKey] ?? LAZY_CHUNK_SIZE;
      if (current >= totalCount) return prev;
      return {
        ...prev,
        [sectionKey]: Math.min(totalCount, current + LAZY_CHUNK_SIZE),
      };
    });
  }, []);

  const resolveVisibleCount = React.useCallback(
    (sectionKey, totalCount) => {
      const current = sectionVisibleCounts[sectionKey] ?? LAZY_CHUNK_SIZE;
      return Math.min(totalCount, current);
    },
    [sectionVisibleCounts]
  );

  const getProductPageCount = React.useCallback(
    (sectionKey) => productRowPages[sectionKey] ?? 1,
    [productRowPages]
  );

  const revealNextProductPage = React.useCallback((sectionKey) => {
    if (!sectionKey) return;
    setProductRowPages((prev) => ({
      ...prev,
      [sectionKey]: (prev[sectionKey] ?? 1) + 1,
    }));
  }, []);

  return (
    <div className="space-y-8">
      {sections.map((section, sectionIndex) => {
        const sectionKey = String(
          section?._id || section?.id || `${section?.displayType || "section"}-${sectionIndex}`
        );
        const heading = section.title;

        if (section.displayType === "banners") {
          const items = section.config?.banners?.items || [];
          if (!items.length) return null;
          return (
            <div key={section._id || sectionKey} className="-mt-8 md:-mt-8">
              <ExperienceBannerCarousel section={section} items={items} slideGap={12} />
            </div>
          );
        }

        if (section.displayType === "categories") {
          const ids = section.config?.categories?.categoryIds || [];
          const rows = section.config?.categories?.rows || 1;
          const visibleCount = rows * 4;
          const allItems = ids
            .map((id) => categoriesById[id])
            .filter(Boolean)
            .slice(0, visibleCount);
          const visibleItems = allItems.slice(
            0,
            resolveVisibleCount(sectionKey, allItems.length)
          );
          const hasMore = visibleItems.length < allItems.length;

          if (!visibleItems.length) return null;

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-2 md:-mx-4 lg:-mx-6 px-2 md:px-4 lg:px-6"
            >
              {heading && (
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {allItems.length} categories
                  </span>
                </div>
              )}
              <div className="rounded-3xl bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] border border-slate-100 px-3.5 py-3">
                <div className="grid grid-cols-4 gap-3">
                  {visibleItems.map((cat) => (
                    <button
                      key={cat._id}
                      className="group flex flex-col items-center gap-1.5 focus:outline-none"
                      onClick={() => {
                        // Remember the header & section so back navigation can restore context
                        rememberExperienceReturn(section.headerId, section._id);
                        navigate(`/category/${cat._id}`);
                      }}
                    >
                      <div className="relative aspect-square w-full rounded-2xl bg-[#F8F9FA] border border-slate-100/80 flex items-center justify-center overflow-hidden p-1 transition-all duration-200 group-hover:border-primary/40 group-hover:bg-white group-hover:shadow-[0_10px_25px_rgba(15,23,42,0.08)]">
                        {cat.image ? (
                          <img
                            src={cat.image}
                            alt={cat.name}
                            className="w-full h-full object-contain object-center mix-blend-multiply transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-slate-100" />
                        )}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-700 text-center leading-snug line-clamp-2 group-hover:text-primary">
                        {cat.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <LazyLoadTrigger
                enabled={hasMore}
                onVisible={() => loadMoreForSection(sectionKey, allItems.length)}
              />
            </div>
          );
        }

        if (section.displayType === "subcategories") {
          const ids = section.config?.subcategories?.subcategoryIds || [];
          const rows = section.config?.subcategories?.rows || 1;
          const visibleCount = rows * 4;
          const allItems = ids
            .map((id) => subcategoriesById[id])
            .filter(Boolean)
            .slice(0, visibleCount);
          const visibleItems = allItems.slice(
            0,
            resolveVisibleCount(sectionKey, allItems.length)
          );
          const hasMore = visibleItems.length < allItems.length;
          if (!visibleItems.length) return null;

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-2 md:-mx-4 lg:-mx-6 px-2 md:px-4 lg:px-6"
            >
              {heading && (
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-base font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400">
                    {allItems.length} picks
                  </span>
                </div>
              )}
              <div className="rounded-3xl bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)] border border-slate-100 px-3.5 py-3">
                <div className="grid grid-cols-4 gap-3">
                  {visibleItems.map((cat) => (
                    <button
                      key={cat._id}
                      className="group flex flex-col items-center gap-1.5 focus:outline-none"
                      onClick={() => {
                        rememberExperienceReturn(section.headerId, section._id);
                        const parentId =
                          cat.parentId?._id ||
                          cat.parentId ||
                          cat.categoryId?._id ||
                          cat.categoryId ||
                          null;

                        if (parentId) {
                          navigate(`/category/${parentId}`, {
                            state: { activeSubcategoryId: cat._id },
                          });
                        } else {
                          // Fallback to previous behavior if we can't resolve parent
                          navigate(`/category/${cat._id}`);
                        }
                      }}
                    >
                      <div className="relative aspect-square w-full rounded-2xl bg-[#F8F9FA] border border-slate-100/80 flex items-center justify-center overflow-hidden p-1 transition-all duration-200 group-hover:border-primary/40 group-hover:bg-white group-hover:shadow-[0_10px_25px_rgba(15,23,42,0.08)]">
                        {cat.image ? (
                          <img
                            src={cat.image}
                            alt={cat.name}
                            className="w-full h-full object-contain object-center mix-blend-multiply transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-slate-100" />
                        )}
                      </div>
                      <div className="text-[11px] font-semibold text-slate-700 text-center leading-snug line-clamp-2 group-hover:text-primary">
                        {cat.name}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              <LazyLoadTrigger
                enabled={hasMore}
                onVisible={() => loadMoreForSection(sectionKey, allItems.length)}
              />
            </div>
          );
        }

        if (section.displayType === "products") {
          const productConfig = section.config?.products || {};
          const ids = productConfig.productIds || [];
          const columns = productConfig.columns || 2;
          const singleRowScrollable = !!productConfig.singleRowScrollable;

          let allProducts;

          // Prefer products hydrated by the backend for this section. The
          // backend already applied the section's category/subcategory/
          // productIds filter together with the customer-location filter,
          // so we just need to look them up by id in the global pool.
          const backendMatchedIds = Array.isArray(section.matchedProducts)
            ? section.matchedProducts
                .map((p) => String(p?._id || p?.id || "").trim())
                .filter(Boolean)
            : [];

          if (backendMatchedIds.length) {
            allProducts = backendMatchedIds
              .map((id) => productsById[id])
              .filter(Boolean);
          } else if (ids.length) {
            allProducts = ids.map((id) => productsById[id]).filter(Boolean);
          } else {
            // No backend hydration (e.g. legacy response) - fall back to
            // filtering whatever products are already in the global pool.
            const categoryFilter = productConfig.categoryIds || [];
            const subcategoryFilter = productConfig.subcategoryIds || [];
            const hasCategoryFilter = categoryFilter.length > 0;
            const hasSubcategoryFilter = subcategoryFilter.length > 0;

            const all = Object.values(productsById);
            allProducts = all.filter((p) => {
              const catId = p.categoryId?._id || p.categoryId;
              const subId = p.subcategoryId?._id || p.subcategoryId;

              const matchesCategory = hasCategoryFilter
                ? categoryFilter.includes(catId)
                : true;
              const matchesSubcategory = hasSubcategoryFilter
                ? subcategoryFilter.includes(subId)
                : true;

              return matchesCategory && matchesSubcategory;
            });
          }

          if (!allProducts.length) return null;

          if (singleRowScrollable) {
            const visibleCount = resolveVisibleCount(sectionKey, allProducts.length);
            const items = allProducts.slice(0, visibleCount);
            const hasMore = items.length < allProducts.length;

            return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-4 md:-mx-8 lg:-mx-[50px] px-1 sm:px-2 md:px-3 mt-6 mb-2"
            >
                <div className="flex items-center justify-between mb-3 px-3 md:px-5">
                  {heading && (
                    <h3 className="text-base font-black text-[#1A1A1A]">
                      {heading}
                    </h3>
                  )}
                  <span className="text-[11px] font-semibold text-slate-400">
                    {allProducts.length} items
                  </span>
                </div>
                <div
                  className="relative z-10 flex overflow-x-auto gap-1.5 pb-1.5 no-scrollbar"
                  onScroll={(e) => {
                    if (!hasMore) return;
                    const node = e.currentTarget;
                    const distanceToEnd =
                      node.scrollWidth - node.scrollLeft - node.clientWidth;
                    if (distanceToEnd < 220) {
                      loadMoreForSection(sectionKey, allProducts.length);
                    }
                  }}
                >
                  {items.map((product) => (
                    <div
                      key={product._id || product.id}
                      className="w-[138px] sm:w-[150px] md:w-[168px] shrink-0"
                    >
                      <ProductCard product={product} compact={true} neutralBg={true} />
                    </div>
                  ))}
                </div>
                <LazyLoadTrigger
                  enabled={hasMore}
                  onVisible={() => loadMoreForSection(sectionKey, allProducts.length)}
                />
              </div>
            );
          }

          // Reveal the grid in pages of PRODUCT_GRID_ROWS_PER_PAGE rows.
          // The first page renders eagerly; subsequent pages are revealed
          // only when the customer taps "See more products". `rows` /
          // `columns` from admin config control layout, not how much is
          // shown - the cap was removed so every matching product is
          // reachable via the CTA.
          const pageCount = getProductPageCount(sectionKey);
          const visibleRows = pageCount * PRODUCT_GRID_ROWS_PER_PAGE;
          const visibleCount = visibleRows * columns;
          const items = allProducts.slice(0, visibleCount);
          const hasMore = items.length < allProducts.length;
          const remainingCount = allProducts.length - items.length;
          // Show up to 3 upcoming product thumbnails in the CTA preview.
          const previewProducts = allProducts.slice(
            visibleCount,
            visibleCount + 3,
          );

          return (
            <div
              key={section._id || sectionKey}
              id={`section-${section._id}`}
              className="-mx-4 md:-mx-8 lg:-mx-[50px] px-1 sm:px-2 md:px-3 mt-6"
            >
              <div className="flex items-center justify-between mb-3 px-3 md:px-5">
                {heading && (
                  <h3 className="text-base font-black text-[#1A1A1A]">
                    {heading}
                  </h3>
                )}
                <span className="text-[11px] font-semibold text-slate-400">
                  {allProducts.length} items
                </span>
              </div>
              <div
                className={cn(
                  "grid gap-1.5 sm:gap-2.5",
                  columns === 1
                    ? "grid-cols-1"
                    : columns === 2
                    ? "grid-cols-2"
                    : columns === 3
                    ? "grid-cols-3"
                    : "grid-cols-2"
                )}
              >
                {items.map((product) => (
                  <div key={product._id || product.id}>
                    <ProductCard product={product} compact={columns >= 2} neutralBg={true} />
                  </div>
                ))}
              </div>

              {hasMore && (
                <div className="mt-4 px-3 md:px-5">
                  <button
                    type="button"
                    onClick={() => revealNextProductPage(sectionKey)}
                    className="group flex w-full items-center justify-between gap-3 rounded-2xl border border-primary/15 bg-primary/5 px-4 py-3 transition-all hover:border-primary/40 hover:bg-primary/10 hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)] active:scale-[0.99]"
                    aria-label={`See more products in ${heading || "this section"}`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {previewProducts.length > 0 && (
                        <div className="flex -space-x-3 shrink-0">
                          {previewProducts.map((p, i) => (
                            <div
                              key={p._id || p.id}
                              className="h-10 w-10 overflow-hidden rounded-full bg-white ring-2 ring-white shadow-sm flex items-center justify-center"
                              style={{ zIndex: previewProducts.length - i }}
                            >
                              {p.image ? (
                                <img
                                  src={p.image}
                                  alt=""
                                  loading="lazy"
                                  className="h-full w-full object-contain p-0.5"
                                />
                              ) : (
                                <div className="h-full w-full bg-slate-100" />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex min-w-0 flex-col items-start text-left">
                        <span className="text-[13px] font-extrabold leading-tight text-primary">
                          See more products
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
        }

        return null;
      })}
    </div>
  );
};

export default SectionRenderer;


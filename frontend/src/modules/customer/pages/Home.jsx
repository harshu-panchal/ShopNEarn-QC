import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useInViewAnimation } from "@/core/hooks/useInViewAnimation";
import { Sparkles, Heart, Snowflake, ChevronLeft, ChevronRight } from "lucide-react";

// MUI Icons (shared with admin & icon selector)
import HomeIcon from "@mui/icons-material/Home";
import DevicesIcon from "@mui/icons-material/Devices";
import LocalGroceryStoreIcon from "@mui/icons-material/LocalGroceryStore";
import KitchenIcon from "@mui/icons-material/Kitchen";
import ChildCareIcon from "@mui/icons-material/ChildCare";
import PetsIcon from "@mui/icons-material/Pets";
import SportsSoccerIcon from "@mui/icons-material/SportsSoccer";
import CardGiftcardIcon from "@mui/icons-material/CardGiftcard";
import VerifiedIcon from "@mui/icons-material/Verified";

import { motion, useScroll, useTransform } from "framer-motion";
import { isMobileOrWebView } from "@/core/utils/deviceUtils";
import { customerApi } from "../services/customerApi";
import { toast } from "sonner";
import ProductCard from "../components/shared/ProductCard";
import MainLocationHeader from "../components/shared/MainLocationHeader";
import { useProductDetail } from "../context/ProductDetailContext";
import { cn } from "@/lib/utils";
import CardBanner from "@/assets/CardBanner.jpg";
import SectionRenderer from "../components/experience/SectionRenderer";
import ExperienceBannerCarousel from "../components/experience/ExperienceBannerCarousel";
import { useLocation } from "../context/LocationContext";
import { useSettings } from "@core/context/SettingsContext";
import Lottie from "lottie-react";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";
import { getJSON, remove as removeStorage, STORAGE_KEYS } from "@core/utils/storage";

import {
  MARQUEE_MESSAGES,
  ICON_COMPONENTS,
} from "../constants/homeConstants";
import PromoMarquee from "../components/home/PromoMarquee";
import QuickCategorySlider from "../components/home/QuickCategorySlider";
import LowestPriceSection from "../components/home/LowestPriceSection";
import OfferSections from "../components/home/OfferSections";

const DEFAULT_CATEGORY_THEME = {
  gradient: "linear-gradient(to bottom, var(--primary), var(--brand-400))",
  shadow: "shadow-brand-500/20",
  accent: "text-[#1A1A1A]",
};

const CATEGORY_METADATA = {
  All: {
    icon: HomeIcon,
    theme: DEFAULT_CATEGORY_THEME,
    banner: {
      title: "HOUSEFULL",
      subtitle: "SALE",
      floatingElements: "sparkles",
    },
  },
  Grocery: {
    icon: LocalGroceryStoreIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #FF9F1C, #FFBF69)",
      shadow: "shadow-orange-500/20",
      accent: "text-orange-900",
    },
    banner: {
      title: "SUPERSAVER",
      subtitle: "FRESH & FAST",
      floatingElements: "leaves",
    },
  },
  Wedding: {
    icon: CardGiftcardIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #FF4D6D, #FF8FA3)",
      shadow: "shadow-rose-500/20",
      accent: "text-rose-900",
    },
    banner: { title: "WEDDING", subtitle: "BLISS", floatingElements: "hearts" },
  },
  "Home & Kitchen": {
    icon: KitchenIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #BC6C25, #DDA15E)",
      shadow: "shadow-amber-500/20",
      accent: "text-amber-900",
    },
    banner: { title: "HOME", subtitle: "KITCHEN", floatingElements: "smoke" },
  },
  Electronics: {
    icon: DevicesIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #7209B7, #B5179E)",
      shadow: "shadow-purple-500/20",
      accent: "text-purple-900",
    },
    banner: {
      title: "TECH FEST",
      subtitle: "GADGETS",
      floatingElements: "tech",
    },
  },
  Kids: {
    icon: ChildCareIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #4CC9F0, #A0E7E5)",
      shadow: "shadow-brand-500/20",
      accent: "text-brand-900",
    },
    banner: {
      title: "LITTLE ONE",
      subtitle: "CARE",
      floatingElements: "bubbles",
    },
  },
  "Pet Supplies": {
    icon: PetsIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #FB8500, #FFB703)",
      shadow: "shadow-yellow-500/20",
      accent: "text-yellow-900",
    },
    banner: { title: "PAWSOME", subtitle: "DEALS", floatingElements: "bones" },
  },
  Sports: {
    icon: SportsSoccerIcon,
    theme: {
      gradient: "linear-gradient(to bottom, #4361EE, #4895EF)",
      shadow: "shadow-brand-500/20",
      accent: "text-brand-900",
    },
    banner: { title: "SPORTS", subtitle: "GEAR", floatingElements: "confetti" },
  },
};

const ALL_CATEGORY = {
  id: "all",
  _id: "all",
  name: "All",
  icon: HomeIcon,
  theme: DEFAULT_CATEGORY_THEME,
  headerColor: "#0e7490",
  headerFontColor: "#111111",
  headerIconColor: "#111111",
  banner: {
    title: "HOUSEFULL",
    subtitle: "SALE",
    floatingElements: "sparkles",
    textColor: "text-white",
  },
};

const EMPTY_HERO_CONFIG = {
  banners: { items: [] },
  categoryIds: [],
};

const homePageDataCache = new Map();
const headerSectionsMemoryCache = {};
const heroConfigMemoryCache = {};

const getHomePageDataCacheKey = (location) => {
  const lat = Number(location?.latitude);
  const lng = Number(location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "home:no-location";
  return `home:${lat.toFixed(5)}:${lng.toFixed(5)}`;
};

const getCachedHomePageData = (location) =>
  homePageDataCache.get(getHomePageDataCacheKey(location)) || null;

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

// When sections are first fetched (before the Home component's `setProducts`
// state machine is wired up), we still need to seed `nextHomeData.products`
// with the backend-hydrated matched products so the initial render of
// product-driven sections has everything it needs.
const mergeSectionMatchedProducts = (nextHomeData, sections) => {
  const matched = sections.flatMap((s) =>
    s?.displayType === "products" && Array.isArray(s?.matchedProducts)
      ? s.matchedProducts
      : []
  );
  if (!matched.length) return;
  nextHomeData.products = mergeProductsUnique(
    nextHomeData.products,
    matched.map(normalizeRawProduct)
  );
};

const Home = () => {
  const { scrollY } = useScroll();
  const { isOpen: isProductDetailOpen } = useProductDetail();
  const { currentLocation } = useLocation();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const quickCatsRef = useRef(null);
  const cachedHomePageData = getCachedHomePageData(currentLocation);

  const { ref: particleContainerRef, isVisible: particlesVisible } = useInViewAnimation();
  const heroRef = useRef(null);
  const [heroVisible, setHeroVisible] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setHeroVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), { rootMargin: "0px" });
    const el = heroRef.current;
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [categories, setCategories] = useState(() => cachedHomePageData?.categories || [ALL_CATEGORY]);
  const [activeCategory, setActiveCategory] = useState(() => cachedHomePageData?.activeCategory || ALL_CATEGORY);
  const [products, setProducts] = useState(() => cachedHomePageData?.products || []);
  const productsRef = useRef(cachedHomePageData?.products || []);
  const [quickCategories, setQuickCategories] = useState(() => cachedHomePageData?.quickCategories || []);
  const [isLoading, setIsLoading] = useState(() => !cachedHomePageData);
  const [experienceSections, setExperienceSections] = useState(() => cachedHomePageData?.experienceSections || []);
  const [headerSections, setHeaderSections] = useState([]);
  const [heroConfig, setHeroConfig] = useState(() => cachedHomePageData?.heroConfig || heroConfigMemoryCache.__home__ || EMPTY_HERO_CONFIG);
  const [mobileBannerIndex, setMobileBannerIndex] = useState(0);
  const [isInstantBannerJump, setIsInstantBannerJump] = useState(false);
  const [categoryMap, setCategoryMap] = useState(() => cachedHomePageData?.categoryMap || {});
  const [subcategoryMap, setSubcategoryMap] = useState(() => cachedHomePageData?.subcategoryMap || {});
  const [pendingReturn, setPendingReturn] = useState(null);
  const [offerSections, setOfferSections] = useState(() => cachedHomePageData?.offerSections || []);
  const [noServiceData, setNoServiceData] = useState(null);

  useEffect(() => {
    productsRef.current = products || [];
  }, [products]);

  useEffect(() => {
    if (products.length === 0 && !isLoading) {
      import("@/assets/lottie/animation.json").then((m) => setNoServiceData(m.default)).catch(() => {});
    }
  }, [products.length, isLoading]);

  const applyHomePageData = (data, { cacheKey, persist = true } = {}) => {
    if (!data) return;
    setCategoryMap(data.categoryMap || {});
    setSubcategoryMap(data.subcategoryMap || {});
    setCategories(data.categories || [ALL_CATEGORY]);
    setQuickCategories(data.quickCategories || []);
    setProducts(data.products || []);
    setExperienceSections(data.experienceSections || []);
    setOfferSections(data.offerSections || []);
    if (data.heroConfig) setHeroConfig(data.heroConfig);
    setActiveCategory((prev) => {
      const parsed = getJSON(STORAGE_KEYS.EXPERIENCE_RETURN, null, { storage: "session" });
      if (parsed?.headerId) {
        const match = (data.formattedHeaders || []).find((h) => h._id === parsed.headerId);
        if (match) return match;
      }
      if (!prev || prev._id === "all") return data.activeCategory || data.categories?.[0] || ALL_CATEGORY;
      return (data.categories || []).find((cat) => cat._id === prev._id) || data.activeCategory || prev;
    });
    if (persist && cacheKey) homePageDataCache.set(cacheKey, data);
  };

  const fetchData = async ({ forceRefresh = false } = {}) => {
    const cacheKey = getHomePageDataCacheKey(currentLocation);
    if (!forceRefresh) {
      const cached = homePageDataCache.get(cacheKey);
      if (cached) {
        applyHomePageData(cached, { cacheKey, persist: false });
        setIsLoading(false);
        return;
      }
    }
    setIsLoading(true);
    try {
      const hasValidLocation = Number.isFinite(currentLocation?.latitude) && Number.isFinite(currentLocation?.longitude);
      const productParams = { limit: 20 };
      if (hasValidLocation) {
        productParams.lat = currentLocation.latitude;
        productParams.lng = currentLocation.longitude;
      }
      const expParams = { pageType: "home" };
      if (hasValidLocation) {
        expParams.lat = currentLocation.latitude;
        expParams.lng = currentLocation.longitude;
      }
      const offerParams = {};
      if (hasValidLocation) {
        offerParams.lat = currentLocation.latitude;
        offerParams.lng = currentLocation.longitude;
      }
      const [catRes, prodRes, expRes, sectionsRes] = await Promise.all([
        customerApi.getCategories(),
        customerApi.getProducts(productParams),
        customerApi.getExperienceSections(expParams).catch(() => null),
        customerApi.getOfferSections(offerParams).catch(() => ({ data: {} })),
      ]);
      const nextHomeData = {
        categories: [ALL_CATEGORY],
        activeCategory: ALL_CATEGORY,
        products: [],
        quickCategories: [],
        experienceSections: [],
        offerSections: [],
        categoryMap: {},
        subcategoryMap: {},
        formattedHeaders: [],
        heroConfig: heroConfigMemoryCache.__home__ || EMPTY_HERO_CONFIG,
      };
      if (catRes.data.success) {
        const dbCats = catRes.data.results || catRes.data.result || [];
        const catMap = {};
        const subMap = {};
        dbCats.forEach((c) => { if (c.type === "category") catMap[c._id] = c; else if (c.type === "subcategory") subMap[c._id] = c; });
        nextHomeData.categoryMap = catMap;
        nextHomeData.subcategoryMap = subMap;
        const formattedHeaders = dbCats.filter((cat) => cat.type === "header").map((cat) => {
          const catName = cat.name;
          const meta = CATEGORY_METADATA[catName] || CATEGORY_METADATA[catName.toUpperCase()] || { icon: Sparkles, theme: DEFAULT_CATEGORY_THEME, banner: { title: catName.toUpperCase(), subtitle: "TOP PICKS", floatingElements: "sparkles" } };
          const IconComp = (cat.iconId && ICON_COMPONENTS[cat.iconId]) || meta.icon || Sparkles;
          return { ...cat, id: cat._id, icon: IconComp, theme: meta.theme, banner: { ...meta.banner, textColor: "text-white" } };
        });
        nextHomeData.formattedHeaders = formattedHeaders;
        const allHeaderFromAdmin = formattedHeaders.find((h) => (h.slug?.toLowerCase() === "all") || (h.name?.toLowerCase() === "all"));
        const mergedAllCategory = allHeaderFromAdmin ? { ...ALL_CATEGORY, headerColor: allHeaderFromAdmin.headerColor || ALL_CATEGORY.headerColor, headerFontColor: allHeaderFromAdmin.headerFontColor || ALL_CATEGORY.headerFontColor, headerIconColor: allHeaderFromAdmin.headerIconColor || ALL_CATEGORY.headerIconColor, icon: allHeaderFromAdmin.icon || ALL_CATEGORY.icon } : ALL_CATEGORY;
        nextHomeData.categories = [mergedAllCategory, ...formattedHeaders.filter((h) => !((h.slug?.toLowerCase() === "all") || (h.name?.toLowerCase() === "all")))];
        nextHomeData.activeCategory = mergedAllCategory;
        nextHomeData.quickCategories = dbCats.filter((cat) => cat.type === "category").map((cat) => ({ id: cat._id, name: cat.name, image: cat.image || "https://cdn-icons-png.flaticon.com/128/2321/2321831.png" }));
      }
      if (prodRes.data.success) {
        const rawResult = prodRes.data.result;
        const dbProds = Array.isArray(prodRes.data.results) ? prodRes.data.results : Array.isArray(rawResult?.items) ? rawResult.items : Array.isArray(rawResult) ? rawResult : [];
        nextHomeData.products = dbProds.map(normalizeRawProduct);
      }
      if (expRes?.data?.success) {
        const fetchedSections = Array.isArray(expRes.data.result || expRes.data.results) ? (expRes.data.result || expRes.data.results) : [];
        nextHomeData.experienceSections = fetchedSections;
        mergeSectionMatchedProducts(nextHomeData, fetchedSections);
      }
      const sectionsList = sectionsRes?.data?.results || sectionsRes?.data?.result || sectionsRes?.data;
      nextHomeData.offerSections = Array.isArray(sectionsList) ? sectionsList : [];
      applyHomePageData(nextHomeData, { cacheKey });
    } catch (error) { console.error("Error:", error); } finally { setIsLoading(false); }
  };

  // Merge any products the backend hydrated into each experience section
  // (`matchedProducts`) into the global product pool so the renderer's
  // `productsById` lookup naturally resolves them. Falls back to fetching by
  // id for any explicit productIds still missing.
  const hydrateSelectedSectionProducts = async (sections = []) => {
    if (!Array.isArray(sections) || !sections.length) return;

    const matchedFromBackend = sections.flatMap((s) =>
      s?.displayType === "products" && Array.isArray(s?.matchedProducts)
        ? s.matchedProducts
        : []
    );

    if (matchedFromBackend.length) {
      const normalized = matchedFromBackend.map(normalizeRawProduct);
      setProducts((prev) => mergeProductsUnique(prev, normalized));
    }

    // For sections where the admin pinned explicit productIds, the backend
    // hydration already returns them as `matchedProducts`. Keep the legacy
    // by-id fetch as a safety net only for ids missing from both the
    // hydrated pool and the existing pool.
    const selectedProductIds = Array.from(
      new Set(
        sections
          .flatMap((s) =>
            s?.displayType === "products"
              ? s?.config?.products?.productIds || []
              : []
          )
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    );
    if (!selectedProductIds.length) return;

    const knownIds = new Set([
      ...productsRef.current.map((p) => String(p?._id || p?.id || "").trim()),
      ...matchedFromBackend.map((p) => String(p?._id || p?.id || "").trim()),
    ]);
    const missingIds = selectedProductIds.filter((id) => !knownIds.has(id));
    if (!missingIds.length) return;

    try {
      const locationParams = Number.isFinite(currentLocation?.latitude)
        ? { lat: currentLocation.latitude, lng: currentLocation.longitude }
        : undefined;
      const missingResults = await Promise.allSettled(
        missingIds.map((id) => customerApi.getProductById(id, locationParams))
      );
      const fetchedMissing = missingResults
        .filter((r) => r.status === "fulfilled")
        .flatMap((r) => {
          const p = r.value?.data?.result || r.value?.data?.results;
          return Array.isArray(p) ? p : p ? [p] : [];
        })
        .map(normalizeRawProduct);
      if (fetchedMissing.length) {
        setProducts((prev) => mergeProductsUnique(prev, fetchedMissing));
      }
    } catch (e) { /* swallow: hydration is best-effort */ }
  };

  useEffect(() => { fetchData(); }, [currentLocation?.latitude, currentLocation?.longitude]);
  const headerSectionsCache = useRef(headerSectionsMemoryCache);
  const heroConfigCache = useRef(heroConfigMemoryCache);

  useEffect(() => {
    const fetchHeaderSections = async () => {
      if (!activeCategory || activeCategory._id === "all") { setHeaderSections([]); return; }
      const cacheKey = activeCategory._id;
      if (headerSectionsCache.current[cacheKey]) { setHeaderSections(headerSectionsCache.current[cacheKey]); return; }
      try {
        const headerParams = { pageType: "header", headerId: activeCategory._id };
        if (Number.isFinite(currentLocation?.latitude) && Number.isFinite(currentLocation?.longitude)) {
          headerParams.lat = currentLocation.latitude;
          headerParams.lng = currentLocation.longitude;
        }
        const res = await customerApi.getExperienceSections(headerParams);
        if (res.data.success) { const sections = Array.isArray(res.data.result || res.data.results) ? (res.data.result || res.data.results) : []; headerSectionsCache.current[cacheKey] = sections; setHeaderSections(sections); await hydrateSelectedSectionProducts(sections); }
        else setHeaderSections([]);
      } catch (e) { setHeaderSections([]); }
    };
    fetchHeaderSections();
  }, [activeCategory]);

  useEffect(() => {
    const fetchHeroConfig = async () => {
      try {
        const isHeader = activeCategory && activeCategory._id !== "all";
        const cacheKey = isHeader ? activeCategory._id : "__home__";
        if (heroConfigCache.current[cacheKey]) { setHeroConfig(heroConfigCache.current[cacheKey]); return; }
        let payload = null;
        if (isHeader) { const res = await customerApi.getHeroConfig({ pageType: "header", headerId: activeCategory._id }); if (res.data?.success && res.data?.result) payload = res.data.result; }
        if (!payload || (payload.banners?.items?.length === 0 && !payload.categoryIds?.length)) { const homeRes = await customerApi.getHeroConfig({ pageType: "home" }); if (homeRes.data?.success && homeRes.data?.result) payload = homeRes.data.result; }
        const resolved = payload && (payload.banners?.items?.length > 0 || payload.categoryIds?.length > 0) ? { banners: payload.banners || { items: [] }, categoryIds: payload.categoryIds || [] } : { banners: { items: [] }, categoryIds: [] };
        heroConfigCache.current[cacheKey] = resolved;
        if (cacheKey === "__home__") { const homeCacheKey = getHomePageDataCacheKey(currentLocation); const cachedHomeData = homePageDataCache.get(homeCacheKey); if (cachedHomeData) homePageDataCache.set(homeCacheKey, { ...cachedHomeData, heroConfig: resolved }); }
        setHeroConfig(resolved);
      } catch (e) { setHeroConfig(EMPTY_HERO_CONFIG); }
    };
    fetchHeroConfig();
  }, [activeCategory, currentLocation?.latitude, currentLocation?.longitude]);

  useEffect(() => {
    const firstUrl = heroConfig?.banners?.items?.[0]?.imageUrl;
    if (!firstUrl) return;
    const link = document.createElement("link");
    link.rel = "preload"; link.as = "image"; link.href = applyCloudinaryTransform(firstUrl, "f_auto,q_auto,c_fill,g_auto,w_824,h_380");
    link.setAttribute("fetchpriority", "high"); document.head.appendChild(link);
    return () => { if (link.parentNode) link.parentNode.removeChild(link); };
  }, [heroConfig?.banners?.items?.[0]?.imageUrl]);

  useEffect(() => {
    const totalSlides = 3;
    const intervalId = setInterval(() => { setMobileBannerIndex((prev) => prev >= totalSlides - 1 ? prev : prev + 1); }, 3500);
    return () => clearInterval(intervalId);
  }, []);

  const handleBannerTransitionEnd = () => { if (mobileBannerIndex === 2) { setIsInstantBannerJump(true); setMobileBannerIndex(0); } };
  useEffect(() => { if (!isInstantBannerJump) return; const id = requestAnimationFrame(() => setIsInstantBannerJump(false)); return () => cancelAnimationFrame(id); }, [isInstantBannerJump]);

  const productsById = useMemo(() => { const map = {}; products.forEach((p) => { map[p._id || p.id] = p; }); return map; }, [products]);
  const effectiveQuickCategories = useMemo(() => {
    const ids = heroConfig.categoryIds || [];
    if (ids.length > 0) { const resolved = ids.map((id) => categoryMap[id]).filter(Boolean).map((c) => ({ id: c._id, name: c.name, image: c.image || "https://cdn-icons-png.flaticon.com/128/2321/2321831.png" })); if (resolved.length > 0) return resolved; }
    return quickCategories;
  }, [heroConfig.categoryIds, categoryMap, quickCategories]);

  const sectionsForRenderer = headerSections.length ? headerSections : experienceSections;
  const isMobile = useMemo(() => isMobileOrWebView(), []);
  const opacity = useTransform(scrollY, (heroVisible && !isMobile) ? [0, 300] : [0, 0], [1, 0.6]);
  const y = useTransform(scrollY, (heroVisible && !isMobile) ? [0, 300] : [0, 0], [0, 80]);
  const scale = useTransform(scrollY, (heroVisible && !isMobile) ? [0, 300] : [0, 0], [1, 0.95]);
  const pointerEvents = useTransform(scrollY, (heroVisible && !isMobile) ? [0, 100] : [0, 0], ["auto", "none"]);

  useEffect(() => {
    if (!pendingReturn?.sectionId) return;
    const allSections = headerSections.length ? headerSections : experienceSections;
    if (!allSections.length) return;
    if (allSections.some((s) => s._id === pendingReturn.sectionId)) { const el = document.getElementById(`section-${pendingReturn.sectionId}`); if (el) { el.scrollIntoView({ behavior: "instant", block: "start" }); removeStorage(STORAGE_KEYS.EXPERIENCE_RETURN, { storage: "session" }); setPendingReturn(null); } }
  }, [headerSections, experienceSections, pendingReturn]);

  const renderFloatingElements = (type, isVisible = true) => {
    if (isMobile) return null;
    return null; // Particles were already simplified out earlier
  };

  return (
    <div className={`min-h-screen pt-[190px] md:pt-[250px] ${products.length === 0 && !isLoading ? "bg-white" : "bg-[#F5F7F8]"}`}>
      <div className={cn("contents", isProductDetailOpen && "hidden md:contents")}>
        <MainLocationHeader categories={categories} activeCategory={activeCategory} onCategorySelect={setActiveCategory} />
      </div>

      {products.length === 0 && !isLoading ? (
        <div className="flex flex-col items-center justify-center pt-24 pb-48">
          <div className="w-64 h-64 md:w-96 md:h-96 mb-8">{noServiceData && <Lottie animationData={noServiceData} loop={true} />}</div>
          <h3 className="text-3xl md:text-5xl font-black text-slate-800 text-center uppercase">Service <span className="text-primary">Unavailable</span></h3>
          <p className="text-slate-500 font-bold max-w-md text-center px-10 text-sm md:text-lg opacity-80">Ah! We haven't reached your neighborhood yet.</p>
          <button onClick={() => window.location.reload()} className="mt-12 px-10 py-4 bg-primary text-white font-black rounded-[24px] uppercase text-[13px] tracking-widest transition-all active:scale-95">Check Again</button>
        </div>
      ) : (
        <>
          <motion.div ref={heroRef} className="block md:hidden will-change-transform" style={isMobile ? { opacity: 1 } : { opacity, y, scale, pointerEvents }}>
            <div className="relative w-full overflow-hidden">
              {heroConfig.banners?.items?.length ? (
                <ExperienceBannerCarousel section={{ title: "" }} items={heroConfig.banners.items} fullWidth edgeToEdge />
              ) : (
                <div className="w-full h-[190px] bg-[#ecfeff] p-6 relative overflow-hidden flex items-center border-y border-primary/10 shadow-sm">
                  <div className="relative z-10 w-3/5 flex flex-col items-start gap-2">
                    <h4 className="text-2xl font-black text-[#1A1A1A] tracking-tight">Get <span className="text-primary">Products</span></h4>
                    <button className="bg-[#FF1E56] text-white px-6 py-2.5 rounded-2xl font-black text-xs tracking-wide">Order now</button>
                  </div>
                  <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mt-12 -mr-12" />
                </div>
              )}
            </div>
          </motion.div>

          <PromoMarquee />
          <QuickCategorySlider categories={effectiveQuickCategories} onCategoryClick={(id) => navigate(`/category/${id}`)} />
          <LowestPriceSection products={products} onSeeAll={() => navigate("/category/all")} />
          <OfferSections sections={offerSections} noServiceData={noServiceData} />

          {sectionsForRenderer.length > 0 && (
            <div className="container mx-auto px-4 md:px-8 lg:px-[50px] py-10 md:py-16">
              <SectionRenderer sections={sectionsForRenderer} productsById={productsById} categoriesById={categoryMap} subcategoriesById={subcategoryMap} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Home;

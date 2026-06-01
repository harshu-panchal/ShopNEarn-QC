import React from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import Lottie from "lottie-react";
import ProductCard from "../shared/ProductCard";
import {
  getBackgroundColorByValue,
  getBackgroundGradientByValue,
} from "@/shared/constants/offerSectionOptions";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

const OfferSections = ({ sections, noServiceData }) => {
  if (!sections || sections.length === 0) return null;

  return (
    <div className="w-full px-0 pt-0 pb-2 md:pb-4">
      {[...sections]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((section) => {
          const bgColor = getBackgroundColorByValue(section.backgroundColor);
          const sectionProducts = (section.productIds || [])
            .filter((p) => typeof p === "object" && p !== null)
            .map((p) => ({
              id: p._id,
              _id: p._id,
              name: p.name,
              image: p.mainImage || p.image || "",
              price: p.salePrice ?? p.price,
              originalPrice: p.price ?? p.salePrice,
              weight: p.weight,
              deliveryTime: p.deliveryTime,
            }));

          return (
            <motion.div
              key={section._id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.25 }}
              transition={{ duration: 0.4 }}
              className="mb-4 rounded-none overflow-hidden shadow-[0_18px_35px_rgba(15,23,42,0.16)] bg-white border-y border-slate-100/70 border-x-0 md:border-x">
              <div
                className="relative flex items-center justify-between px-5 md:px-8 py-5 md:py-6 text-black"
                style={{
                  backgroundColor: bgColor,
                  backgroundImage: getBackgroundGradientByValue(section.backgroundColor),
                }}>
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div className="absolute -top-10 -left-10 w-40 h-40 md:w-56 md:h-56 bg-white/20 rounded-full blur-3xl" />
                  <div className="absolute -bottom-10 right-0 w-44 h-44 bg-white/10 rounded-full blur-3xl" />
                </div>
                <div className="flex-1 pr-4">
                  <p className="text-[10px] md:text-[11px] font-bold uppercase tracking-wider text-black/60 mb-1">
                    Trending right now
                  </p>
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight leading-tight drop-shadow-sm">
                    {section.title}
                  </h3>
                  {((section.categoryIds || [])
                    .map((c) => (typeof c === "object" && c?.name ? c.name : null))
                    .filter(Boolean)
                    .join(", ") || section.categoryId?.name) && (
                    <p className="text-[11px] md:text-xs font-semibold text-black/75 mt-1">
                      {(section.categoryIds || [])
                        .map((c) => (typeof c === "object" && c?.name ? c.name : null))
                        .filter(Boolean)
                        .join(", ") || section.categoryId?.name}
                    </p>
                  )}
                </div>
                <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl flex-shrink-0 shadow-[0_16px_30px_rgba(0,0,0,0.25)] border border-black/10 overflow-hidden relative bg-black/10 transition-transform hover:-translate-y-1 hover:rotate-[-4deg] hover:scale-105">
                  {sectionProducts[0]?.image ? (
                    <>
                      <img
                        src={applyCloudinaryTransform(sectionProducts[0].image, "f_auto,q_auto,w_150")}
                        alt={section.title}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-cover scale-110"
                      />
                      <div className="absolute inset-0 bg-gradient-to-tr from-black/60 via-black/20 to-transparent" />
                      <div className="absolute -bottom-6 -right-6 w-16 h-16 rounded-full bg-amber-400/60 blur-xl mix-blend-screen" />
                    </>
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500" />
                  )}

                  {sectionProducts.length > 0 && (
                    <div className="absolute top-1 left-1 px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-semibold text-white/90 tracking-wide flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400" />
                      {sectionProducts.length} items
                    </div>
                  )}

                  <div className="relative z-10 flex items-center justify-center h-full">
                    <Sparkles
                      className="text-amber-200 drop-shadow-[0_0_12px_rgba(251,191,36,0.9)]"
                      size={30}
                    />
                  </div>
                </div>
              </div>
              <div className="px-4 pt-4 md:px-5 md:pt-5 pb-1">
                <div className="flex overflow-x-auto gap-3 md:gap-4 pb-0 no-scrollbar snap-x snap-mandatory">
                  {sectionProducts.length === 0 ? (
                    <div className="w-full py-10 flex flex-col items-center justify-center text-center">
                      <div className="w-32 h-32 mb-3">
                        {noServiceData ? (
                          <Lottie animationData={noServiceData} loop={true} />
                        ) : (
                          <div className="w-32 h-32" />
                        )}
                      </div>
                      <p className="text-sm md:text-base text-slate-400 font-bold">
                        Looking for the best items in this category...
                      </p>
                    </div>
                  ) : (
                    sectionProducts.map((product) => (
                      <div key={product.id} className="w-[126px] sm:w-[136px] md:w-[148px] flex-shrink-0 snap-start">
                        <ProductCard
                          product={product}
                          className="bg-white border border-slate-100 shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
                          compact
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
    </div>
  );
};

export default React.memo(OfferSections);

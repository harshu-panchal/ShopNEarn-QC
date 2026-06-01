import React from "react";
import { ChevronRight } from "lucide-react";
import ProductCard from "../shared/ProductCard";

const LowestPriceSection = ({ products, onSeeAll }) => {
  if (!products || products.length === 0) return null;

  return (
    <div className="-mt-[40px] mb-4 md:-mt-[40px] md:mb-8">
      <div className="relative overflow-hidden bg-linear-to-br from-primary/10 via-primary/5 to-transparent pt-7 pb-2 md:pt-16 md:pb-4 border-y border-primary/10 shadow-sm md:shadow-[inset_0_-10px_40px_rgba(0,0,0,0.02)]">
        {/* Background Decoration */}
        <div className="absolute -top-10 -right-10 h-40 w-40 md:h-80 md:w-80 bg-primary/10 rounded-full blur-3xl opacity-60" />
        <div className="absolute -bottom-10 -left-10 h-40 w-40 md:h-80 md:w-80 bg-yellow-400/10 rounded-full blur-3xl opacity-60" />

        <div className="container mx-auto px-4 md:px-8 lg:px-[50px] relative z-10">
          <div className="flex justify-between items-center mb-6 md:mb-10 px-1">
            <div className="flex flex-col">
              <h3 className="text-base md:text-xl font-black text-[#1A1A1A] tracking-tight uppercase leading-none pt-[25px]">
                Lowest Price <span className="text-primary">ever</span>
              </h3>
              <div className="flex items-center gap-1.5 md:gap-2 mt-1.5 md:mt-3">
                <div className="h-1 w-1 md:h-2 md:w-2 bg-primary rounded-full animate-pulse shadow-[0_0_8px_rgba(12,131,31,0.5)]" />
                <span className="text-[10px] md:text-xs font-bold text-primary uppercase tracking-wide opacity-80">
                  Unbeatable Savings • Updated hourly
                </span>
              </div>
            </div>
            <button
              onClick={onSeeAll}
              className="flex items-center gap-1 bg-white px-2.5 py-1 md:px-4 md:py-2 rounded-full text-primary font-bold text-[11px] md:text-sm cursor-pointer shadow-[0_4px_12px_rgba(0,0,0,0.05)] md:shadow-md border border-primary/10 transition-all whitespace-nowrap active:scale-95">
              See all
              <ChevronRight size={12} className="ml-0.5" strokeWidth={3} />
            </button>
          </div>

          <div className="relative z-10 flex overflow-x-auto gap-3 md:gap-6 pb-2 md:pb-3 no-scrollbar -mx-4 px-4 md:mx-0 md:px-0 snap-x snap-mandatory scroll-smooth">
            {products.slice(0, 12).map((product) => (
              <div key={product.id} className="w-[126px] sm:w-[136px] md:w-[148px] shrink-0 snap-start smooth-transform">
                <ProductCard
                  product={product}
                  className="bg-white shadow-[0_8px_20px_-8px_rgba(0,0,0,0.1)] md:shadow-[0_15px_30px_rgba(0,0,0,0.05)] border-brand-50/50 md:border-slate-100 transition-all"
                  compact={true}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(LowestPriceSection);

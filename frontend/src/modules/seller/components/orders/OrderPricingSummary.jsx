import React from "react";
import {
  formatINR,
  normalizeOrderPricing,
} from "@shared/utils/orderPricingSummary";

/**
 * Seller order-summary panel backed by the frozen order pricing snapshot.
 */
export default function OrderPricingSummary({ order, className = "" }) {
  const pricing = normalizeOrderPricing(order);

  return (
    <div
      className={
        className ||
        "bg-primary/5 p-3 sm:p-4 rounded-3xl border border-primary/10"
      }
    >
      <h4 className="text-xs font-black text-primary uppercase tracking-widest mb-3">
        Order Summary
      </h4>
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="font-bold text-slate-600">Subtotal</span>
          <span className="font-black text-slate-900">
            {formatINR(pricing.productSubtotal)}
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="font-bold text-slate-600">Delivery Fee</span>
          <span
            className={`font-black ${
              pricing.deliveryFee === 0 ? "text-brand-600" : "text-slate-900"
            }`}
          >
            {pricing.deliveryFee === 0 ? "FREE" : formatINR(pricing.deliveryFee)}
          </span>
        </div>
        {pricing.handlingFee > 0 && (
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-600">Handling Fee</span>
            <span className="font-black text-slate-900">
              {formatINR(pricing.handlingFee)}
            </span>
          </div>
        )}
        {pricing.discountTotal > 0 && (
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-600">Discount</span>
            <span className="font-black text-brand-600">
              -{formatINR(pricing.discountTotal)}
            </span>
          </div>
        )}
        {pricing.taxTotal > 0 && (
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-600">Tax</span>
            <span className="font-black text-slate-900">
              {formatINR(pricing.taxTotal)}
            </span>
          </div>
        )}
        {pricing.tipTotal > 0 && (
          <div className="flex justify-between text-xs">
            <span className="font-bold text-slate-600">Tip</span>
            <span className="font-black text-slate-900">
              {formatINR(pricing.tipTotal)}
            </span>
          </div>
        )}
        <div className="h-px bg-primary/10 my-2" />
        <div className="flex justify-between text-sm">
          <span className="font-black text-slate-900">Total</span>
          <span className="font-black text-primary">
            {formatINR(pricing.grandTotal)}
          </span>
        </div>
      </div>
    </div>
  );
}

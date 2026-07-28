import React from "react";
import { formatINR } from "./franchiseCustomerShared";

const paymentLabel = (method) => {
  if (method === "upi_partner") return "UPI (partner)";
  if (method === "cash") return "Cash";
  return method || "—";
};

export const PosReceiptPrint = ({ receipt, printRef }) => {
  if (!receipt) return null;
  const soldAt = receipt.soldAt
    ? new Date(receipt.soldAt).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div ref={printRef} className="p-6 max-w-md mx-auto text-slate-900 bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .pos-receipt-print, .pos-receipt-print * { visibility: visible; }
          .pos-receipt-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
      <div className="pos-receipt-print space-y-3 text-sm">
        <div className="text-center border-b border-slate-200 pb-3">
          <p className="font-black text-lg">{receipt.partner?.displayName || "Franchise Store"}</p>
          <p className="text-xs text-slate-600">{receipt.partner?.address}</p>
          {receipt.partner?.referralCode && (
            <p className="text-xs text-slate-500 mt-1">Code: {receipt.partner.referralCode}</p>
          )}
        </div>
        <div className="flex justify-between text-xs">
          <span>Bill # {receipt.orderId}</span>
          <span>{soldAt}</span>
        </div>
        {(receipt.buyer?.name || receipt.buyer?.phone) && (
          <div className="text-xs border border-slate-100 rounded-lg p-2">
            <p className="font-semibold">Customer</p>
            {receipt.buyer.name && <p>{receipt.buyer.name}</p>}
            {receipt.buyer.phone && <p>{receipt.buyer.phone}</p>}
          </div>
        )}
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1">Item</th>
              <th className="py-1 text-center">Qty</th>
              <th className="py-1 text-right">Amt</th>
            </tr>
          </thead>
          <tbody>
            {(receipt.lines || []).map((line, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="py-1.5 pr-2">{line.name}</td>
                <td className="py-1.5 text-center">{line.quantity}</td>
                <td className="py-1.5 text-right">{formatINR(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between font-black text-base pt-2">
          <span>Total</span>
          <span>{formatINR(receipt.grandTotal)}</span>
        </div>
        <p className="text-xs text-slate-600">
          Paid via: {paymentLabel(receipt.paymentMethod)}
          {receipt.upiReference ? ` · Ref: ${receipt.upiReference}` : ""}
        </p>
        <p className="text-[10px] text-slate-400 text-center pt-2">{receipt.footerNote}</p>
      </div>
    </div>
  );
};

export default PosReceiptPrint;

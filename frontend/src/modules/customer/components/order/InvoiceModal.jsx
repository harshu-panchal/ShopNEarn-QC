import React, { useMemo, useRef, useState } from "react";
import { X, Printer, Download } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@core/context/SettingsContext";
import {
  buildInvoiceFilename,
  normalizeInvoiceOrder,
} from "@shared/utils/invoiceOrderAdapter";
import { downloadInvoicePdf } from "@shared/utils/invoicePdf";
import { formatINR } from "@shared/utils/orderPricingSummary";

const InvoiceModal = ({ isOpen, onClose, order }) => {
  const { settings } = useSettings();
  const appName = settings?.appName || "App";
  const primaryColor = settings?.primaryColor || "var(--primary)";
  const invoiceRef = useRef(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");

  const invoice = useMemo(() => normalizeInvoiceOrder(order), [order]);

  if (!invoice) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = async () => {
    if (!invoice.hasLineItems || isDownloading) return;
    setError("");
    setIsDownloading(true);
    try {
      await downloadInvoicePdf(
        invoiceRef.current,
        buildInvoiceFilename(invoice.orderId),
      );
    } catch (err) {
      console.error("Invoice PDF generation failed:", err);
      setError("Failed to generate PDF. Please try Print instead.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl relative"
            >
              <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black text-slate-800">Invoice</h2>
                  <p className="text-xs text-slate-500 font-medium">
                    #{invoice.orderId || "—"}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 bg-white rounded-full hover:bg-slate-200 transition-colors shadow-sm border border-slate-100"
                >
                  <X size={20} className="text-slate-500" />
                </button>
              </div>

              <div className="p-8 space-y-6" id="printable-invoice" ref={invoiceRef}>
                <div className="flex justify-between items-start">
                  <div>
                    <h1
                      className="text-2xl font-black tracking-tight"
                      style={{ color: primaryColor }}
                    >
                      {appName}
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                      {settings?.companyName || "Quick Commerce"}
                      <br />
                      {settings?.address || "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-800">Bill To:</p>
                    <p className="text-xs text-slate-500 mt-1">
                      {invoice.customerName}
                      <br />
                      {invoice.customerPhone || "—"}
                      {invoice.addressLine ? (
                        <>
                          <br />
                          {invoice.addressLine}
                        </>
                      ) : null}
                    </p>
                    {invoice.createdAt && (
                      <p className="text-[11px] text-slate-400 mt-2 font-medium">
                        {new Date(invoice.createdAt).toLocaleString("en-IN")}
                      </p>
                    )}
                  </div>
                </div>

                {!invoice.hasLineItems ? (
                  <p className="text-sm text-slate-500 font-medium">
                    Invoice is unavailable for this order summary.
                  </p>
                ) : (
                  <>
                    <div className="border rounded-xl overflow-hidden border-slate-100">
                      <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                          <tr>
                            <th className="px-4 py-3">Item</th>
                            <th className="px-4 py-3 text-right">Qty</th>
                            <th className="px-4 py-3 text-right">Price</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {invoice.items.map((item, idx) => (
                            <tr key={idx}>
                              <td className="px-4 py-3 text-slate-700 font-medium">
                                {item.name}
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-right">
                                {item.quantity}
                              </td>
                              <td className="px-4 py-3 text-slate-800 font-bold text-right">
                                {formatINR(item.price)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>Subtotal</span>
                        <span>{formatINR(invoice.pricing.productSubtotal)}</span>
                      </div>
                      <div className="flex justify-between text-sm text-slate-500">
                        <span>Delivery Fee</span>
                        <span>
                          {invoice.pricing.deliveryFee === 0
                            ? "FREE"
                            : formatINR(invoice.pricing.deliveryFee)}
                        </span>
                      </div>
                      {invoice.pricing.handlingFee > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>Handling Fee</span>
                          <span>{formatINR(invoice.pricing.handlingFee)}</span>
                        </div>
                      )}
                      {invoice.pricing.discountTotal > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>Discount</span>
                          <span>-{formatINR(invoice.pricing.discountTotal)}</span>
                        </div>
                      )}
                      {invoice.pricing.taxTotal > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>Tax</span>
                          <span>{formatINR(invoice.pricing.taxTotal)}</span>
                        </div>
                      )}
                      {invoice.pricing.tipTotal > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>Tip</span>
                          <span>{formatINR(invoice.pricing.tipTotal)}</span>
                        </div>
                      )}
                      {invoice.pricing.walletAmount > 0 && (
                        <div className="flex justify-between text-sm text-slate-500">
                          <span>Wallet</span>
                          <span>-{formatINR(invoice.pricing.walletAmount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-black text-slate-800 pt-2 border-t border-slate-100">
                        <span>Total Paid</span>
                        <span>{formatINR(invoice.pricing.grandTotal)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-400 pt-1">
                        <span>{invoice.paymentMethod}</span>
                        <span>{invoice.paymentStatus || ""}</span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-3">
                {error ? (
                  <p className="text-xs font-semibold text-rose-600">{error}</p>
                ) : null}
                <div className="flex gap-3">
                  <button
                    onClick={handlePrint}
                    className="flex-1 py-3 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors shadow-lg"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <Printer size={18} /> Print
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!invoice.hasLineItems || isDownloading}
                    className="flex-1 py-3 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Download size={18} />
                    {isDownloading ? "Saving..." : "Save PDF"}
                  </button>
                </div>
              </div>

              <style>
                {`
                  @media print {
                    body * { visibility: hidden; }
                    #printable-invoice, #printable-invoice * { visibility: visible; }
                    #printable-invoice { position: absolute; left: 0; top: 0; width: 100%; }
                  }
                `}
              </style>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default InvoiceModal;

import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Wallet, QrCode, X, Crown } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../services/mlmApi";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Modal for opt-in Plan B upgrade — wallet or manual QR.
 */
const UpgradePlanBModal = ({
  open,
  onClose,
  payAmount,
  shoppingCredit,
  canPayViaWallet,
  earningsBalance,
  onSuccess,
  navigate,
}) => {
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleWalletPay = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await mlmApi.initiateUpgrade({ paymentMethod: "wallet" });
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      if (payload?.upgraded) {
        toast.success("Welcome to Plan B! Your upgrade is complete.");
        onSuccess?.();
        onClose?.();
      }
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to upgrade from wallet",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleQrPay = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await mlmApi.initiateUpgrade({ paymentMethod: "manual_qr" });
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      const paymentId = payload?.paymentId;
      if (paymentId) {
        onClose?.();
        navigate(`/mlm/upgrade-payment/${paymentId}`);
        return;
      }
      toast.error("Could not start QR payment");
    } catch (err) {
      toast.error(
        err?.response?.data?.message || "Failed to start QR payment",
      );
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
              <Crown size={20} />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">
                Upgrade to Plan B
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Pay {formatINR(payAmount)} · get {formatINR(shoppingCredit)}{" "}
                shopping credit + ₹550/pair matching income
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <button
          type="button"
          disabled={loading || !canPayViaWallet}
          onClick={handleWalletPay}
          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-violet-200 bg-violet-50 text-left hover:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          <Wallet size={22} className="text-violet-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">
              Pay from earning wallet
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              Balance: {formatINR(earningsBalance)}
              {!canPayViaWallet ? " — insufficient" : ""}
            </p>
          </div>
          {loading && <Loader2 size={18} className="animate-spin text-violet-600" />}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={handleQrPay}
          className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-slate-200 bg-white text-left hover:border-indigo-400 transition-colors">
          <QrCode size={22} className="text-indigo-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Pay via QR / UPI</p>
            <p className="text-xs text-slate-600 mt-0.5">
              Scan, pay, and submit proof for admin review
            </p>
          </div>
        </button>
      </div>
    </div>,
    document.body,
  );
};

export default UpgradePlanBModal;

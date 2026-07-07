import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ChevronLeft,
  Copy,
  Loader2,
  Upload,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ImageOff,
} from "lucide-react";
import { toast } from "sonner";
import axiosInstance from "@core/api/axios";
import { mlmApi } from "../../services/mlmApi";
import bundledQrFallback from "../../../../assets/payment_QR.jpeg";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * UpgradePaymentPage — Plan B upgrade via manual UPI QR.
 *
 * Renders the admin-uploaded QR (or a bundled fallback), captures the
 * customer's transaction id + screenshot, and submits proof. Once
 * submitted (or if the row already terminal/under review), the form
 * is replaced with a status card. The page never reads admin
 * settings directly — the manual-QR config is snapshotted on the
 * payment row at intent time.
 */
const UpgradePaymentPage = () => {
  const { paymentId } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState(null);

  const [transactionId, setTransactionId] = useState("");
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotPreview, setScreenshotPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef(null);

  const fetchPayment = useCallback(async () => {
    if (!paymentId) return;
    try {
      const res = await mlmApi.getUpgradePayment(paymentId);
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      setPayment(payload);
    } catch (err) {
      const code = err?.response?.data?.result?.code;
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to load payment";
      setError({ code, message });
    } finally {
      setLoading(false);
    }
  }, [paymentId]);

  useEffect(() => {
    fetchPayment();
  }, [fetchPayment]);

  // Poll while the row is under review so the UI flips to success/
  // rejection without a manual refresh.
  useEffect(() => {
    if (!payment) return;
    if (payment.status !== "PENDING_REVIEW") return;
    const t = setInterval(() => {
      fetchPayment();
    }, 8000);
    return () => clearInterval(t);
  }, [payment, fetchPayment]);

  const handleCopy = (text, label) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    toast.success(`${label} copied`);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error("Please select an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be 10 MB or smaller.");
      return;
    }
    setScreenshotFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setScreenshotPreview(ev.target?.result || null);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    if (submitting || uploading) return;
    const trimmedTxn = transactionId.trim().toUpperCase();
    if (!trimmedTxn || trimmedTxn.length < 4) {
      toast.error("Please enter a valid transaction ID.");
      return;
    }
    if (!screenshotFile) {
      toast.error("Please attach the payment screenshot.");
      return;
    }

    setUploading(true);
    let screenshotUrl = "";
    try {
      const fd = new FormData();
      fd.append("file", screenshotFile);
      const uploadRes = await axiosInstance.post("/media/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      screenshotUrl =
        uploadRes.data?.result?.url ||
        uploadRes.data?.data?.url ||
        uploadRes.data?.url ||
        "";
      if (!screenshotUrl) throw new Error("Upload returned no URL");
    } catch (err) {
      setUploading(false);
      toast.error(
        err?.response?.data?.message ||
          err?.message ||
          "Failed to upload screenshot",
      );
      return;
    }
    setUploading(false);

    setSubmitting(true);
    try {
      await mlmApi.submitUpgradeProof({
        paymentId,
        transactionId: trimmedTxn,
        screenshotUrl,
      });
      toast.success("Proof submitted. Admin review within 24 hours.");
      await fetchPayment();
    } catch (err) {
      toast.error(
        err?.response?.data?.message ||
          err?.message ||
          "Failed to submit proof",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 size={28} className="text-slate-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 pb-24">
        <Header navigate={navigate} />
        <div className="max-w-xl mx-auto px-4 py-8 text-center">
          <XCircle size={48} className="mx-auto text-rose-500 mb-3" />
          <h2 className="text-lg font-bold text-slate-900">
            We couldn't open this payment
          </h2>
          <p className="text-sm text-slate-600 mt-2">{error.message}</p>
          <button
            onClick={() => navigate("/mlm")}
            className="mt-5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold">
            Go to Rewards
          </button>
        </div>
      </div>
    );
  }

  if (!payment) return null;

  const manualQr = payment.manualQr || {};
  const qrSrc = manualQr.imageUrl || bundledQrFallback;
  const isFormState = payment.status === "CREATED";

  return (
    <div className="min-h-screen bg-slate-50 pb-32">
      <Header navigate={navigate} />
      <div className="max-w-xl mx-auto px-4 space-y-4">
        {/* Amount summary */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 text-white shadow-lg">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">
            Amount to pay
          </p>
          <p className="text-3xl font-black mt-1">{formatINR(payment.amount)}</p>
          <p className="text-xs opacity-90 mt-2">
            Plan B upgrade fee · {formatINR(payment.shoppingCredit)}{" "}
            shopping credit on approval
          </p>
        </div>

        {/* Status state machine */}
        {payment.status === "PENDING_REVIEW" && (
          <StatusCard
            tone="blue"
            icon={<Clock size={22} className="text-blue-600" />}
            title="Your request is under review"
            description={
              <>
                We've received your payment proof
                {payment.transactionId ? (
                  <>
                    {" "}
                    (txn:{" "}
                    <code className="font-mono text-blue-900">
                      {payment.transactionId}
                    </code>
                    )
                  </>
                ) : null}
                . An admin will verify and apply your Plan B upgrade within
                24 hours. We'll notify you the moment it's approved.
              </>
            }
            footer={
              <button
                onClick={() => navigate("/mlm")}
                className="text-xs font-bold text-blue-700 underline">
                Back to Rewards
              </button>
            }
          />
        )}

        {payment.status === "CAPTURED" && (
          <StatusCard
            tone="emerald"
            icon={<CheckCircle2 size={22} className="text-emerald-600" />}
            title="Upgrade approved"
            description={
              <>
                You are now on Plan B with ₹550 per pair matching income.
                Visit the Rewards dashboard to see your updated plan.
              </>
            }
            footer={
              <button
                onClick={() => navigate("/mlm")}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold">
                Go to Rewards
              </button>
            }
          />
        )}

        {payment.status === "FAILED" && (
          <StatusCard
            tone="rose"
            icon={<AlertTriangle size={22} className="text-rose-600" />}
            title="Payment was not approved"
            description={
              <>
                {payment.rejectionReason ? (
                  <>Reason: {payment.rejectionReason}</>
                ) : (
                  <>An admin rejected this submission.</>
                )}{" "}
                You can retry with a fresh payment from the Rewards page.
              </>
            }
            footer={
              <button
                onClick={() => navigate("/mlm")}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold">
                Back to Rewards
              </button>
            }
          />
        )}

        {/* QR + UPI details — visible while form is open */}
        {isFormState && (
          <>
            <QrCard qrSrc={qrSrc} />
            <DetailsCard manualQr={manualQr} onCopy={handleCopy} />
            {manualQr.instructions && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  Instructions
                </p>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">
                  {manualQr.instructions}
                </p>
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  Transaction ID *
                </label>
                <input
                  type="text"
                  value={transactionId}
                  onChange={(e) =>
                    setTransactionId(e.target.value.toUpperCase().trim())
                  }
                  placeholder="e.g. T2305021234567890"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-300 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  maxLength={64}
                  required
                />
                <p className="text-[11px] text-slate-500 mt-1.5">
                  Find this in your UPI app's transaction history right after
                  the successful payment.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                  Payment Screenshot *
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                {screenshotPreview ? (
                  <div className="relative">
                    <img
                      src={screenshotPreview}
                      alt="Payment screenshot preview"
                      className="w-full max-h-72 object-contain rounded-lg border border-slate-200 bg-slate-50"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshotFile(null);
                        setScreenshotPreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="absolute top-2 right-2 px-2 py-1 rounded-md bg-white/90 text-rose-600 text-[11px] font-bold border border-slate-200 hover:bg-white">
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-slate-300 rounded-lg py-8 px-4 flex flex-col items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                    <Upload size={24} className="text-slate-400" />
                    <span className="text-sm font-bold text-slate-700">
                      Upload screenshot
                    </span>
                    <span className="text-[11px] text-slate-500">
                      JPG, PNG, or WebP · up to 10 MB
                    </span>
                  </button>
                )}
              </div>

              <button
                type="submit"
                disabled={
                  submitting ||
                  uploading ||
                  !screenshotFile ||
                  transactionId.length < 4
                }
                className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 text-sm hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {uploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Uploading screenshot…
                  </>
                ) : submitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>Submit for Review</>
                )}
              </button>
              <p className="text-[11px] text-slate-500 text-center">
                Admin reviews are typically completed within 24 hours.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

const Header = ({ navigate }) => (
  <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
    <button
      onClick={() => navigate(-1)}
      className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1">
      <ChevronLeft size={22} className="text-slate-800" />
    </button>
    <h1 className="text-xl font-semibold text-slate-900 tracking-tight flex-1">
      Complete Plan B Payment
    </h1>
  </div>
);

const QrCard = ({ qrSrc }) => {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-3 text-center">
        Scan to pay via UPI
      </p>
      <div className="bg-white border-2 border-slate-200 rounded-xl p-4 mx-auto max-w-[280px] flex items-center justify-center">
        {imgError ? (
          <div className="aspect-square w-full flex flex-col items-center justify-center text-slate-400">
            <ImageOff size={32} />
            <p className="text-xs mt-2 text-center">QR unavailable</p>
          </div>
        ) : (
          <img
            src={qrSrc}
            alt="Payment QR"
            className="w-full h-auto"
            onError={() => setImgError(true)}
          />
        )}
      </div>
      <p className="text-[11px] text-slate-500 text-center mt-3 leading-relaxed">
        Open any UPI app (PhonePe, Google Pay, Paytm, BHIM) and scan this QR
        code to pay.
      </p>
    </div>
  );
};

const DetailsCard = ({ manualQr, onCopy }) => {
  const upiId = manualQr.upiId || "";
  const merchantName = manualQr.merchantName || "";
  if (!upiId && !merchantName) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
        Or pay using UPI ID
      </p>
      {merchantName && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-slate-500">Merchant</p>
            <p className="text-sm font-semibold text-slate-900">
              {merchantName}
            </p>
          </div>
        </div>
      )}
      {upiId && (
        <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-200">
          <div className="min-w-0">
            <p className="text-[11px] text-slate-500">UPI ID</p>
            <p className="text-sm font-mono text-slate-900 truncate">
              {upiId}
            </p>
          </div>
          <button
            onClick={() => onCopy(upiId, "UPI ID")}
            className="ml-3 px-2.5 py-1.5 rounded-md bg-indigo-600 text-white text-[11px] font-bold inline-flex items-center gap-1 hover:bg-indigo-700">
            <Copy size={12} /> Copy
          </button>
        </div>
      )}
    </div>
  );
};

const StatusCard = ({ tone, icon, title, description, footer }) => {
  const toneClasses =
    tone === "emerald"
      ? "bg-emerald-50 border-emerald-200"
      : tone === "rose"
        ? "bg-rose-50 border-rose-200"
        : "bg-blue-50 border-blue-200";
  const titleClass =
    tone === "emerald"
      ? "text-emerald-900"
      : tone === "rose"
        ? "text-rose-900"
        : "text-blue-900";
  const descClass =
    tone === "emerald"
      ? "text-emerald-800"
      : tone === "rose"
        ? "text-rose-800"
        : "text-blue-800";
  return (
    <div className={`rounded-2xl border p-5 ${toneClasses}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1">
          <h3 className={`text-base font-bold ${titleClass}`}>{title}</h3>
          <p className={`text-sm ${descClass} mt-1.5 leading-relaxed`}>
            {description}
          </p>
          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </div>
    </div>
  );
};

export default UpgradePaymentPage;

import React, { useEffect, useState } from "react";
import { Copy, Upload, Wallet, TrendingUp, RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import axiosInstance from "@core/api/axios";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import bundledQrFallback from "../../../../assets/payment_QR.jpeg";
import {
  FranchisePageShell,
  FranchiseStatCard,
  SectionCard,
  PaymentStatusPill,
  formatINR,
  formatDate,
} from "./franchiseCustomerShared";

const FranchiseWalletPage = () => {
  const [profile, setProfile] = useState(null);
  const [topUps, setTopUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [topUpId, setTopUpId] = useState(null);
  const [manualQr, setManualQr] = useState(null);
  const [transactionId, setTransactionId] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const multiplier = profile?.config?.walletCreditMultiplier || 2;
  const balance = profile?.wallet?.availableBalance || 0;
  const depositAmount = Number(amount) || 0;
  const expectedCredit = depositAmount * multiplier;

  const load = async () => {
    setLoading(true);
    try {
      const [meRes, topRes] = await Promise.all([
        franchiseApi.getMe(),
        franchiseApi.listTopUps(),
      ]);
      setProfile(meRes.data?.result ?? meRes.data?.data);
      setTopUps(topRes.data?.result?.items ?? topRes.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load wallet");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startTopUp = async () => {
    if (!depositAmount || depositAmount <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    try {
      const res = await franchiseApi.requestTopUp({ amount: depositAmount });
      const data = res.data?.result ?? res.data?.data;
      setTopUpId(data.topUpId);
      setManualQr(data.manualQr);
      toast.success("Top-up started — pay via UPI and submit proof");
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to start top-up");
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await axiosInstance.post("/media/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setScreenshotUrl(res.data?.result?.url ?? res.data?.data?.url ?? res.data?.url);
      toast.success("Screenshot uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!transactionId.trim() || !screenshotUrl) {
      toast.error("Transaction ID and screenshot are required");
      return;
    }
    setSubmitting(true);
    try {
      await franchiseApi.submitTopUpProof({ topUpId, transactionId, screenshotUrl });
      toast.success("Submitted for admin review");
      setTopUpId(null);
      setAmount("");
      setTransactionId("");
      setScreenshotUrl("");
      setManualQr(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  const copyText = (text, label) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const qrImage = manualQr?.imageUrl || bundledQrFallback;
  const pendingCount = topUps.filter((t) => t.status === "pending_review").length;

  return (
    <>
      <FranchiseMlmHeader title="Wallet Top-up" />
      <FranchisePageShell
        title="Franchise wallet"
        subtitle={`Deposit via UPI — admin credits ${multiplier}× product value after approval.`}
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg"
          >
            <RefreshCcw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FranchiseStatCard label="Available balance" value={formatINR(balance)} tone="indigo" />
          <FranchiseStatCard
            label="Credit multiplier"
            value={`${multiplier}×`}
            hint="Stock purchasing power after approval"
            tone="emerald"
          />
          <FranchiseStatCard
            label="Pending top-ups"
            value={loading ? "…" : pendingCount}
            hint="Awaiting admin verification"
            tone="amber"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SectionCard title={topUpId ? "Step 2 — Submit payment proof" : "Step 1 — Request top-up"}>
            <div className="p-4 sm:p-5 space-y-4">
              {!topUpId ? (
                <>
                  <label className="block text-sm font-semibold text-slate-700">
                    Deposit amount (₹)
                    <input
                      type="number"
                      min={1}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 5000"
                      className="mt-1.5 w-full border border-slate-200 rounded-xl px-4 py-3 text-lg font-bold"
                    />
                  </label>
                  {!profile?.partner?.hasCompletedFirstTopup && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900 flex items-start gap-2">
                      <TrendingUp className="text-purple-600 shrink-0 mt-0.5" size={16} />
                      <div>
                        <p className="font-bold text-purple-950">1st Top-Up Direct Product Allocation</p>
                        <p className="text-purple-800 mt-0.5">
                          For your first top-up, Admin will directly select & dispatch products to you equal to your 2× credit value instead of cash wallet credit.
                        </p>
                      </div>
                    </div>
                  )}
                  {depositAmount > 0 && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                      <TrendingUp className="text-emerald-600 shrink-0" size={20} />
                      <div>
                        <p className="text-xs text-emerald-800 font-semibold uppercase tracking-wide">
                          Expected product value / credit after approval
                        </p>
                        <p className="text-xl font-black text-emerald-900">{formatINR(expectedCredit)}</p>
                      </div>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={startTopUp}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl"
                  >
                    Continue to payment
                  </button>
                </>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                    <p className="text-sm font-bold text-slate-900">Pay {formatINR(depositAmount)}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      You will receive {formatINR(expectedCredit)} in stock value
                    </p>
                    <img
                      src={qrImage}
                      alt="UPI QR"
                      className="w-full max-w-xs mx-auto mt-4 rounded-xl border border-slate-200"
                    />
                    {manualQr?.upiId && (
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <span className="font-mono text-sm">{manualQr.upiId}</span>
                        <button
                          type="button"
                          onClick={() => copyText(manualQr.upiId, "UPI ID")}
                          className="p-1.5 rounded-lg bg-white border border-slate-200"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  <label className="block text-sm font-semibold text-slate-700">
                    UPI transaction ID
                    <input
                      value={transactionId}
                      onChange={(e) => setTransactionId(e.target.value)}
                      placeholder="Paste transaction reference"
                      className="mt-1.5 w-full border border-slate-200 rounded-xl px-4 py-2.5 font-mono text-sm"
                    />
                  </label>

                  <label className="block text-sm font-semibold text-slate-700">
                    Payment screenshot
                    <div className="mt-1.5 border-2 border-dashed border-slate-200 rounded-xl p-4 text-center">
                      <input type="file" accept="image/*" onChange={upload} className="hidden" id="topup-proof" />
                      <label htmlFor="topup-proof" className="cursor-pointer inline-flex flex-col items-center gap-2">
                        <Upload size={24} className="text-slate-400" />
                        <span className="text-xs text-slate-500">
                          {uploading ? "Uploading…" : screenshotUrl ? "Change screenshot" : "Tap to upload"}
                        </span>
                      </label>
                      {screenshotUrl && (
                        <img src={screenshotUrl} alt="Proof" className="mt-3 max-h-40 mx-auto rounded-lg border" />
                      )}
                    </div>
                  </label>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTopUpId(null);
                        setManualQr(null);
                        setTransactionId("");
                        setScreenshotUrl("");
                      }}
                      className="flex-1 py-3 rounded-xl border border-slate-200 font-semibold text-slate-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submit}
                      disabled={submitting || !transactionId || !screenshotUrl}
                      className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
                    >
                      {submitting ? "Submitting…" : "Submit proof"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </SectionCard>

          <SectionCard title="How wallet top-up works">
            <div className="p-4 sm:p-5 space-y-4 text-sm text-slate-600">
              <div className="flex gap-3">
                <Wallet className="text-indigo-600 shrink-0" size={18} />
                <p>
                  Your franchise wallet is used only to <strong>buy stock</strong> from{" "}
                  {profile?.config?.hubShopDisplayName || "Harsh's Hub"}.
                </p>
              </div>
              <ol className="space-y-2 list-decimal list-inside text-xs leading-relaxed">
                <li>Enter deposit amount and scan the UPI QR</li>
                <li>Submit transaction ID + payment screenshot</li>
                <li>Admin verifies and credits {multiplier}× product value</li>
                <li>Use wallet balance in Buy Stock catalog</li>
              </ol>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Top-up history">
          {topUps.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">No top-ups yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="text-left px-4 py-3">Date</th>
                    <th className="text-right px-4 py-3">Deposit</th>
                    <th className="text-right px-4 py-3">Credit</th>
                    <th className="text-left px-4 py-3">Txn ID</th>
                    <th className="text-left px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {topUps.map((row) => (
                    <tr key={row._id} className="border-t border-slate-100">
                      <td className="px-4 py-3 text-xs">{formatDate(row.updatedAt)}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatINR(row.amount)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700 font-bold">
                        {formatINR(row.amount * (row.creditMultiplierSnapshot || multiplier))}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs truncate max-w-[120px]">
                        {row.manualPaymentDetails?.transactionId || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <PaymentStatusPill status={row.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </FranchisePageShell>
    </>
  );
};

export default FranchiseWalletPage;

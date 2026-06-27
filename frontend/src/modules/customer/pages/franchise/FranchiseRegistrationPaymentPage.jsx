import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import axiosInstance from "@core/api/axios";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import bundledQrFallback from "../../../../assets/payment_QR.jpeg";

const FranchiseRegistrationPaymentPage = () => {
  const { paymentId } = useParams();
  const navigate = useNavigate();
  const [payment, setPayment] = useState(null);
  const [transactionId, setTransactionId] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    franchiseApi.getRegistrationPayment(paymentId).then((res) => {
      setPayment(res.data?.result ?? res.data?.data);
    }).catch(() => toast.error("Failed to load payment"));
  }, [paymentId]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await axiosInstance.post("/media/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = res.data?.result?.url ?? res.data?.data?.url ?? res.data?.url;
      setScreenshotUrl(url);
      toast.success("Screenshot uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await franchiseApi.submitRegistrationProof({ paymentId, transactionId, screenshotUrl });
      toast.success("Submitted for admin review");
      await franchiseApi.getRegistrationPayment(paymentId).then((res) => {
        setPayment(res.data?.result ?? res.data?.data);
      });
    } catch (err) {
      toast.error(err?.response?.data?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!payment) {
    return (
      <>
        <FranchiseMlmHeader title="Registration Payment" />
        <div className="p-6 text-center">Loading...</div>
      </>
    );
  }

  const qr = payment.rawGatewayResponse?.manualQrSnapshot;
  const qrImage = qr?.imageUrl || bundledQrFallback;
  const isUnderReview = payment.status === "PENDING_REVIEW";
  const isTerminal =
    payment.status === "CAPTURED" || payment.status === "FAILED" || payment.status === "CANCELLED";

  return (
    <>
      <FranchiseMlmHeader title="Registration Payment" />
      <div className="max-w-lg mx-auto p-6 space-y-4">
      {isUnderReview || isTerminal ? (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center space-y-3">
          <h1 className="text-xl font-bold text-slate-900">
            {payment.status === "CAPTURED" ? "Registration approved" : "Payment submitted"}
          </h1>
          <p className="text-sm text-slate-600">
            {payment.status === "CAPTURED"
              ? "Your franchise is active. Open Home Shoppy from the sidebar."
              : payment.status === "FAILED" || payment.status === "CANCELLED"
                ? payment.adminRemarks || payment.failureReason || "Payment was not approved."
                : "Admin is reviewing your payment proof. You will be notified once activated."}
          </p>
          <button
            onClick={() => navigate("/mlm/franchise")}
            className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl"
          >
            Back to Home Shoppy
          </button>
        </div>
      ) : (
        <>
      <h1 className="text-xl font-bold">Pay ₹{payment.registrationPriceSnapshot?.toLocaleString("en-IN")}</h1>
      <img src={qrImage} alt="UPI QR" className="w-full max-w-xs mx-auto rounded-xl border" />
      <p className="text-sm text-slate-600 text-center">UPI: {qr?.upiId || "—"}</p>
      <input
        value={transactionId}
        onChange={(e) => setTransactionId(e.target.value)}
        placeholder="Transaction ID"
        className="w-full border rounded-lg px-3 py-2"
      />
      <input type="file" accept="image/*" onChange={handleUpload} disabled={uploading} />
      <button
        onClick={handleSubmit}
        disabled={submitting || !transactionId || !screenshotUrl}
        className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl disabled:opacity-50"
      >
        {submitting ? "Submitting..." : "Submit Proof"}
      </button>
        </>
      )}
    </div>
    </>
  );
};

export default FranchiseRegistrationPaymentPage;

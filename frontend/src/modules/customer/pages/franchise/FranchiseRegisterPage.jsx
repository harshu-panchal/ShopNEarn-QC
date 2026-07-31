import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, CheckCircle } from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import { customerApi } from "../../services/customerApi";
import { openRazorpayCheckout } from "@/shared/payments/openRazorpayCheckout";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import MapPicker from "@shared/components/MapPicker";

const INITIAL_FORM = {
  locality: "",
  pincode: "",
  city: "",
  state: "",
  address: "",
  lat: null,
  lng: null,
};

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const FranchiseRegisterPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [registrationPrice, setRegistrationPrice] = useState(10000);

  useEffect(() => {
    let cancelled = false;
    franchiseApi
      .getMe()
      .then((res) => {
        if (cancelled) return;
        const profile = res.data?.result ?? res.data?.data;
        setRegistrationPrice(profile?.config?.registrationPrice || 10000);
        if (profile?.isPartner) {
          navigate("/mlm/franchise", { replace: true });
          return;
        }
        const phase = profile?.registration?.phase;
        const paymentId = profile?.registration?.payment?.paymentId;
        if (phase === "pending_payment" && paymentId) {
          navigate(`/mlm/franchise/register/payment/${paymentId}`, { replace: true });
          return;
        }
        if (phase === "pending_review" || phase === "activating") {
          navigate("/mlm/franchise", { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCheckingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "city" || name === "state") {
      setFormData((prev) => ({
        ...prev,
        [name]: value.replace(/[^a-zA-Z\s]/g, ""),
      }));
      return;
    }
    if (name === "pincode") {
      setFormData((prev) => ({
        ...prev,
        [name]: value.replace(/[^0-9]/g, "").slice(0, 6),
      }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleLocationSelect = (location) => {
    setFormData((prev) => ({
      ...prev,
      lat: location.lat,
      lng: location.lng,
      address: location.address || prev.address,
      locality: location.locality || prev.locality,
      pincode: location.pincode || prev.pincode,
      city: location.city || prev.city,
      state: location.state || prev.state,
    }));
  };

  const validate = () => {
    if (!formData.locality?.trim()) {
      toast.error("Locality / area is required.");
      return false;
    }
    if (!/^\d{6}$/.test(formData.pincode || "")) {
      toast.error("Enter a valid 6-digit pincode.");
      return false;
    }
    if (!formData.city?.trim() || !formData.state?.trim()) {
      toast.error("City and state are required.");
      return false;
    }
    if (!formData.address?.trim()) {
      toast.error("Full address is required.");
      return false;
    }
    return true;
  };

  const handleRegister = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await franchiseApi.initiateRegistration({
        address: formData.address.trim(),
        locality: formData.locality.trim(),
        pincode: formData.pincode.trim(),
        city: formData.city.trim(),
        state: formData.state.trim(),
        lat: formData.lat,
        lng: formData.lng,
      });
      const payload = res.data?.result ?? res.data?.data ?? res.data;
      const paymentId = payload?.paymentId;
      const redirectUrl = payload?.redirectUrl;
      const checkout = payload?.checkout;
      const merchantOrderId = payload?.merchantOrderId;
      const paymentMode = payload?.paymentMode;

      if (paymentMode === "manual_qr" || redirectUrl?.includes("/register/payment/")) {
        if (redirectUrl?.includes("/register/payment/")) {
          const path = redirectUrl.replace(window.location.origin, "");
          navigate(path.startsWith("/") ? path : `/${path}`);
        } else if (paymentId) {
          navigate(`/mlm/franchise/register/payment/${paymentId}`);
        } else {
          toast.error("Could not start payment. Please try again.");
        }
        return;
      }

      if (checkout?.orderId) {
        await openRazorpayCheckout({
          checkout,
          merchantOrderId,
          onSuccess: async (rzpResponse) => {
            await customerApi.verifyPaymentCallback({
              merchantOrderId,
              razorpay_order_id: rzpResponse.razorpay_order_id,
              razorpay_payment_id: rzpResponse.razorpay_payment_id,
              razorpay_signature: rzpResponse.razorpay_signature,
            });
            navigate(
              `/payment-status?merchantOrderId=${encodeURIComponent(merchantOrderId)}`,
              { replace: true },
            );
          },
        });
        return;
      }

      if (redirectUrl) {
        window.location.assign(redirectUrl);
      } else {
        toast.error("Could not start payment. Please try again.");
      }
    } catch (err) {
      if (err?.code === "PAYMENT_DISMISSED") return;
      toast.error(err?.response?.data?.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (checkingStatus) {
    return (
      <>
        <FranchiseMlmHeader title="Register" />
        <div className="p-6 text-center text-slate-500">Loading...</div>
      </>
    );
  }

  return (
    <>
      <FranchiseMlmHeader title="Register" />
      <div className="max-w-lg mx-auto p-6 space-y-4">
        <h1 className="text-2xl font-bold text-slate-900 hidden md:block">
          Franchise Registration
        </h1>
        <p className="text-sm text-slate-600">
          Pay {formatINR(registrationPrice)} to register. Customer orders are routed to the nearest
          franchise partner — no service radius needed.
        </p>

        <div>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
            Franchise Location
          </p>
          <button
            type="button"
            onClick={() => setIsMapOpen(true)}
            className={`w-full flex items-center justify-between p-4 rounded-xl border-2 border-dashed transition-all ${
              formData.lat
                ? "border-indigo-200 bg-indigo-50/50"
                : "border-slate-200 bg-slate-50 hover:border-slate-300"
            }`}
          >
            <div className="flex items-center gap-3 text-left">
              <div
                className={`p-2 rounded-lg ${
                  formData.lat ? "bg-indigo-100 text-indigo-600" : "bg-white text-slate-500"
                }`}
              >
                {formData.lat ? <CheckCircle size={18} /> : <MapPin size={18} />}
              </div>
              <div>
                <p className={`text-sm font-bold ${formData.lat ? "text-indigo-700" : "text-slate-600"}`}>
                  {formData.lat ? "Location selected" : "Pin location on map"}
                </p>
                <p className="text-xs text-slate-500 truncate max-w-[220px]">
                  {formData.lat
                    ? formData.address || "Address filled from map"
                    : "Mark your franchise address precisely"}
                </p>
              </div>
            </div>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm font-semibold text-slate-700">
            Locality / Area
            <input
              name="locality"
              value={formData.locality}
              onChange={handleChange}
              placeholder="e.g. Satellite"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Pincode
            <input
              name="pincode"
              value={formData.pincode}
              onChange={handleChange}
              placeholder="6-digit pincode"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            City
            <input
              name="city"
              value={formData.city}
              onChange={handleChange}
              placeholder="City"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal"
              required
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            State
            <input
              name="state"
              value={formData.state}
              onChange={handleChange}
              placeholder="State"
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal"
              required
            />
          </label>
        </div>

        <label className="block text-sm font-semibold text-slate-700">
          Full address
          <textarea
            name="address"
            rows={3}
            value={formData.address}
            onChange={handleChange}
            placeholder="House / shop no., street, landmark"
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 font-normal resize-none"
            required
          />
        </label>

        <button
          type="button"
          onClick={handleRegister}
          disabled={loading}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl disabled:opacity-50"
        >
          {loading ? "Starting..." : `Pay ${formatINR(registrationPrice)} & Register`}
        </button>
      </div>

      {isMapOpen && (
        <MapPicker
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          onConfirm={handleLocationSelect}
          preferCurrentLocationOnOpen
          showRadius={false}
          title="Select Franchise Location"
          searchPlaceholder="Search for your franchise area..."
          initialLocation={
            formData.lat ? { lat: formData.lat, lng: formData.lng } : null
          }
        />
      )}
    </>
  );
};

export default FranchiseRegisterPage;

import React, { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import {
  describePushSupport,
  ensureFcmTokenRegistered,
  hasRegisteredFcmToken,
} from "@core/firebase/pushClient";
import { primeFranchiseOrderAlertSound } from "./franchiseOrderAlertSound";

const DISMISS_KEY = "franchise_push_banner_dismissed";

export default function FranchisePushEnableBanner() {
  const [visible, setVisible] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    if (hasRegisteredFcmToken("customer")) return;
    const support = describePushSupport();
    if (!support.supported) return;
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const enable = async () => {
    setEnabling(true);
    primeFranchiseOrderAlertSound();
    try {
      await ensureFcmTokenRegistered({ role: "customer", platform: "web" });
      toast.success("Notifications enabled — you'll get alerts for new orders");
      setVisible(false);
    } catch (error) {
      toast.error(error?.message || "Could not enable notifications");
    } finally {
      setEnabling(false);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  };

  return (
    <div className="mx-4 sm:mx-6 mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-wrap items-center gap-3">
      <Bell size={18} className="text-indigo-600 shrink-0" />
      <p className="text-sm text-indigo-900 flex-1 min-w-[200px]">
        Enable notifications to get instant alerts when customer orders are routed to you.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={enabling}
          onClick={enable}
          className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-lg disabled:opacity-50"
        >
          {enabling ? "Enabling…" : "Enable"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="p-1.5 text-indigo-500 hover:bg-indigo-100 rounded-lg"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

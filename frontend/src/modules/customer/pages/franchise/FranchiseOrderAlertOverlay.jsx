import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { BellRing, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@core/context/AuthContext";
import { getOrderSocket, onNotificationNew } from "@core/services/orderSocket";
import { createSocketTokenReader } from "@core/utils/authStorage";
import { STORAGE_KEYS } from "@core/utils/storage";
import { franchiseApi } from "../../services/franchiseApi";
import {
  primeFranchiseOrderAlertSound,
  startFranchiseOrderRingtone,
  stopFranchiseOrderRingtone,
} from "./franchiseOrderAlertSound";

export const FRANCHISE_NOTIFICATIONS_REFRESH = "franchise:notifications-refresh";

const POLL_INTERVAL_MS = 20_000;
const FRANCHISE_ORDER_EVENT = "FRANCHISE_ORDER_ROUTED";

function dispatchNotificationsRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FRANCHISE_NOTIFICATIONS_REFRESH));
}

function extractPendingOrders(res) {
  return res.data?.result?.items ?? res.data?.data?.items ?? [];
}

function orderTotal(order) {
  if (!order) return 0;
  return (
    order.paymentBreakdown?.grandTotal ??
    order.pricing?.total ??
    order.items?.reduce((sum, line) => sum + (line.price || 0) * (line.quantity || 1), 0) ??
    0
  );
}

export default function FranchiseOrderAlertOverlay() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [isActivePartner, setIsActivePartner] = useState(false);
  const [activeAlert, setActiveAlert] = useState(null);
  const [acting, setActing] = useState(false);

  const activeAlertRef = useRef(null);
  const shownOrderIdsRef = useRef(new Set());
  const isFirstPollRef = useRef(true);
  const syncPendingRef = useRef(null);

  useEffect(() => {
    activeAlertRef.current = activeAlert;
  }, [activeAlert]);

  useEffect(() => {
    if (!token) {
      setIsActivePartner(false);
      return;
    }

    let cancelled = false;
    franchiseApi
      .getMe()
      .then((res) => {
        if (cancelled) return;
        const payload = res.data?.result ?? res.data?.data ?? {};
        setIsActivePartner(
          payload.isPartner === true && payload.partner?.status === "active",
        );
      })
      .catch(() => {
        if (!cancelled) setIsActivePartner(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const dismissAlert = useCallback(() => {
    stopFranchiseOrderRingtone();
    activeAlertRef.current = null;
    setActiveAlert(null);
  }, []);

  const openAlert = useCallback((order) => {
    const publicOrderId = String(order?.orderId || order?.publicOrderId || "").trim();
    if (!publicOrderId || shownOrderIdsRef.current.has(publicOrderId)) return;
    if (activeAlertRef.current) return;

    shownOrderIdsRef.current.add(publicOrderId);
    const next = {
      ...order,
      publicOrderId,
      orderId: publicOrderId,
    };
    activeAlertRef.current = next;
    setActiveAlert(next);
    dispatchNotificationsRefresh();
  }, []);

  const enrichAlertFromPending = useCallback(async (publicOrderId) => {
    try {
      const res = await franchiseApi.listOrders({ status: "pending", limit: 50 });
      const match = extractPendingOrders(res).find(
        (order) => String(order.orderId) === String(publicOrderId),
      );
      if (!match) return;
      setActiveAlert((prev) => {
        if (!prev || String(prev.publicOrderId) !== String(publicOrderId)) return prev;
        const merged = { ...prev, ...match, publicOrderId };
        activeAlertRef.current = merged;
        return merged;
      });
    } catch {
      // Non-fatal — popup still shows the public order id.
    }
  }, []);

  const syncPendingOrders = useCallback(async () => {
    if (!token || !isActivePartner) return;
    try {
      const res = await franchiseApi.listOrders({ status: "pending", limit: 50 });
      const pending = extractPendingOrders(res);

      if (isFirstPollRef.current) {
        pending.forEach((order) => {
          if (order?.orderId) shownOrderIdsRef.current.add(String(order.orderId));
        });
        isFirstPollRef.current = false;
        return;
      }

      const fresh = pending.find(
        (order) => order?.orderId && !shownOrderIdsRef.current.has(String(order.orderId)),
      );
      if (fresh) openAlert(fresh);
    } catch (error) {
      console.error("[franchise] pending order sync failed", error);
    }
  }, [token, isActivePartner, openAlert]);

  useEffect(() => {
    syncPendingRef.current = syncPendingOrders;
  }, [syncPendingOrders]);

  useEffect(() => {
    if (!token || !isActivePartner) return undefined;

    primeFranchiseOrderAlertSound();
    const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_CUSTOMER);
    getOrderSocket(getToken);

    syncPendingOrders();

    const onSocket = (payload) => {
      const eventType = String(payload?.eventType || payload?.type || "").toUpperCase();
      if (eventType !== FRANCHISE_ORDER_EVENT) return;

      const publicOrderId = payload?.data?.orderId || payload?.data?.publicOrderId;
      if (!publicOrderId) return;

      openAlert({
        orderId: publicOrderId,
        title: payload?.title,
        body: payload?.body || payload?.message,
      });
      enrichAlertFromPending(publicOrderId);
    };

    const offSocket = onNotificationNew(getToken, onSocket);

    const poll = setInterval(() => {
      if (document.visibilityState !== "hidden") syncPendingRef.current?.();
    }, POLL_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") syncPendingRef.current?.();
    };
    const onFocus = () => syncPendingRef.current?.();
    const onOnline = () => syncPendingRef.current?.();

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      if (typeof offSocket === "function") offSocket();
      stopFranchiseOrderRingtone();
    };
  }, [token, isActivePartner, openAlert, enrichAlertFromPending, syncPendingOrders]);

  useEffect(() => {
    if (activeAlert) {
      startFranchiseOrderRingtone();
      return () => stopFranchiseOrderRingtone();
    }
    return undefined;
  }, [activeAlert]);

  useEffect(() => () => stopFranchiseOrderRingtone(), []);

  const handleAccept = async () => {
    const alert = activeAlertRef.current;
    const mongoId = alert?._id;
    if (!mongoId) {
      toast.error("Order details still loading. Open Customer Orders to accept.");
      navigate("/mlm/franchise/orders");
      dismissAlert();
      return;
    }

    setActing(true);
    try {
      await franchiseApi.acceptOrder(mongoId);
      toast.success("Order accepted");
      dismissAlert();
      dispatchNotificationsRefresh();
      navigate("/mlm/franchise/orders");
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not accept order");
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    const alert = activeAlertRef.current;
    const mongoId = alert?._id;
    if (!mongoId) {
      navigate("/mlm/franchise/orders");
      dismissAlert();
      return;
    }

    setActing(true);
    try {
      await franchiseApi.rejectOrder(mongoId, { reason: "Partner declined from alert" });
      toast.success("Order declined");
      dismissAlert();
      dispatchNotificationsRefresh();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not decline order");
    } finally {
      setActing(false);
    }
  };

  const handleViewLater = () => {
    dismissAlert();
    navigate("/mlm/franchise/orders");
  };

  if (!isActivePartner || !activeAlert || typeof document === "undefined") {
    return null;
  }

  const total = orderTotal(activeAlert);

  return createPortal(
    <AnimatePresence>
      {activeAlert && (
        <div
          className="fixed inset-0 z-10000 flex items-center justify-center p-4 bg-slate-900/85 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="franchise-order-alert-title"
        >
          <motion.div
            key={activeAlert.publicOrderId}
            initial={{ scale: 0.92, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="bg-white rounded-[32px] p-6 w-full max-w-[360px] shadow-2xl border-4 border-indigo-200"
          >
            <div className="flex flex-col items-center text-center">
              <div className="h-16 w-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4 animate-bounce">
                <BellRing className="h-8 w-8 text-indigo-600" />
              </div>

              <h2
                id="franchise-order-alert-title"
                className="text-xl font-black text-slate-900 mb-1"
              >
                New customer order
              </h2>
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Home Shoppy partner
              </p>

              <p className="text-slate-600 font-medium mb-1">
                Order{" "}
                <span className="text-indigo-600 font-bold">#{activeAlert.orderId}</span>
              </p>
              {total > 0 && (
                <p className="text-2xl font-black text-slate-900 mb-4">
                  ₹{Number(total).toLocaleString("en-IN")}
                </p>
              )}
              {activeAlert.body && (
                <p className="text-sm text-slate-500 mb-6 leading-relaxed">{activeAlert.body}</p>
              )}

              <div className="grid grid-cols-2 gap-3 w-full mb-3">
                <button
                  type="button"
                  disabled={acting}
                  onClick={handleReject}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-colors disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                  Decline
                </button>
                <button
                  type="button"
                  disabled={acting}
                  onClick={handleAccept}
                  className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50"
                >
                  <Check className="h-5 w-5" />
                  Accept
                </button>
              </div>

              <button
                type="button"
                disabled={acting}
                onClick={handleViewLater}
                className="text-xs font-bold uppercase tracking-wider text-slate-500 hover:text-indigo-600"
              >
                View in orders
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

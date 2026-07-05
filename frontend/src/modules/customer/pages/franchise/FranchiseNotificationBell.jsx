import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useAuth } from "@core/context/AuthContext";
import { customerApi } from "../../services/customerApi";
import NotificationPopup from "@shared/layout/NotificationPopup";
import { primeFranchiseOrderAlertSound } from "./franchiseOrderAlertSound";
import { FRANCHISE_NOTIFICATIONS_REFRESH } from "./FranchiseOrderAlertOverlay";

export default function FranchiseNotificationBell({ className = "" }) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await customerApi.getNotifications();
      if (res.data?.success) {
        const result = res.data.result || res.data.data || {};
        setNotifications(result.notifications || result.items || []);
        setUnreadCount(Number(result.unreadCount || 0));
      }
    } catch (error) {
      console.error("[franchise] notification fetch failed", error);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return undefined;
    primeFranchiseOrderAlertSound();
    fetchNotifications();

    const onRefresh = () => fetchNotifications();
    window.addEventListener(FRANCHISE_NOTIFICATIONS_REFRESH, onRefresh);

    const poll = setInterval(() => {
      if (document.visibilityState !== "hidden") fetchNotifications();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchNotifications();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(FRANCHISE_NOTIFICATIONS_REFRESH, onRefresh);
    };
  }, [token, fetchNotifications]);

  useEffect(() => {
    const onDocClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const handleMarkRead = async (id) => {
    if (!id) return;
    try {
      await customerApi.markNotificationRead(id);
      fetchNotifications();
    } catch {
      toast.error("Could not mark notification as read");
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await customerApi.markAllNotificationsRead();
      fetchNotifications();
      toast.success("All caught up");
    } catch {
      toast.error("Could not mark all as read");
    }
  };

  return (
    <div className={`relative ${className}`} ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          primeFranchiseOrderAlertSound();
          setOpen((v) => !v);
        }}
        className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-200/70 transition-colors"
        aria-label="Notifications"
      >
        <Bell size={20} className="text-slate-700" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <div className="absolute right-0 top-full mt-2 z-50">
            <NotificationPopup
              notifications={notifications.map((n) => ({
                ...n,
                _id: n._id || n.id,
              }))}
              onMarkAsRead={handleMarkRead}
              onMarkAllAsRead={handleMarkAllRead}
              onClose={() => setOpen(false)}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

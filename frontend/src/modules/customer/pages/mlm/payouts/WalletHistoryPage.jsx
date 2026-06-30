import React, { useEffect, useState } from "react";
import {
  Loader2,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";
import MemberJoinedSubtitle from "@shared/components/mlm/MemberJoinedSubtitle";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  new Date(d).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const getMlmReason = (row) => {
  const meta = row?.metadata || {};
  const type = row?.type;

  if (type === "MLM_DIRECT_REFERRAL_ACTIVATION") {
    const left = Number(meta.leftDirectCount || 0);
    const right = Number(meta.rightDirectCount || 0);
    const directCount = Number(meta.directCount || 0);
    const pairIncome = Number(meta.pairIncome || row.amount || 0);
    if (left || right || directCount || pairIncome) {
      return `Reason: first direct L+R pair complete (L${left}:R${right}); ${directCount} active directs tier => ${formatINR(pairIncome)}.`;
    }
    return "Reason: first direct left-right pair completed.";
  }

  if (type === "MLM_BINARY_PAIR_MATCH") {
    const pairIndex = Number(meta.pairIndex || 0);
    const directCount = Number(meta.directCount || 0);
    const pairIncome = Number(meta.pairIncome || row.amount || 0);
    if (pairIndex || directCount || pairIncome) {
      return `Reason: team pair #${pairIndex || "?"} matched; ${directCount} active directs tier => ${formatINR(pairIncome)} per pair.`;
    }
    return "Reason: left/right team volume formed a binary pair.";
  }

  if (type === "MLM_DIRECT_REFERRAL_PER_ACTIVATION") {
    if (meta.activatedUserId) {
      return `Reason: direct referral ${meta.activatedUserId} activated Plan A.`;
    }
    return "Reason: one direct referral activated Plan A.";
  }

  return null;
};

const TYPE_LABEL = {
  MLM_BINARY_PAIR_MATCH: "Pair Match Bonus",
  MLM_DIRECT_REFERRAL_ACTIVATION: "First Direct Pair Income",
  MLM_DIRECT_REFERRAL_PER_ACTIVATION: "Direct Referral Activation",
  MLM_DIRECT_REFERRAL_MILESTONE: "Direct Referral Milestone",
  MLM_BONUS_CREDIT: "Bonus Credit",
  MLM_BONUS_RELEASED: "Bonus Released",
  MLM_BINARY_PAIR_MATCH_HELD_PENDING: "Pair Bonus Held",
  MLM_BINARY_PAIR_MATCH_RELEASED_ON_DOWNLINE_ACTIVATION: "Pair Bonus Released",
  MLM_WITHDRAWAL_GROSS_DEBIT: "Withdrawal",
  MLM_WITHDRAWAL_ADMIN_CHARGE: "Withdrawal Admin Charge",
  MLM_WITHDRAWAL_GST_CHARGE: "Withdrawal GST",
  MLM_WITHDRAWAL_NET_PAYOUT_QUEUED: "Withdrawal Payout",
  MLM_WITHDRAWAL_REVERSAL: "Withdrawal Reversed",
  MLM_WITHDRAWAL_HOLD: "Withdrawal Hold",
  MLM_WITHDRAWAL_PAID: "Withdrawal Paid",
  MLM_JOINING_FEE: "Activation Fee",
  MLM_REPURCHASE_DEBIT: "Repurchase",
  MLM_JOINING_PACKAGE_SHOPPING_CREDIT: "Plan A Shopping Credit",
  MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT: "Plan B Shopping Credit",
  MLM_SIGNUP_BONUS_SELF: "Signup Bonus",
  MLM_SIGNUP_BONUS_SPONSOR: "Referral Bonus",
  WALLET_TOPUP: "Wallet Top-up",
  WALLET_REFUND: "Refund",
  WALLET_PAYMENT: "Checkout Payment",
};

const DEFAULT_CATEGORIES = [
  { value: "all", label: "All" },
  { value: "earnings", label: "Earnings" },
  { value: "shopping", label: "Shopping" },
  { value: "signup", label: "Signup Bonuses" },
  { value: "withdrawals", label: "Withdrawals" },
];

const DIRECTION_FILTERS = [
  { value: "", label: "All" },
  { value: "CREDIT", label: "Credits" },
  { value: "DEBIT", label: "Debits" },
];

/**
 * Customer-MLM-rebuild Phase 8 — Wallet History (under Payouts layout).
 *
 * Unified ledger feed for the signed-in customer. Replaces the old
 * `transactions` collection view with the canonical `LedgerEntry`
 * stream — each row shows direction, amount, type, balance after,
 * and an optional human description.
 */
const WalletHistoryPage = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [direction, setDirection] = useState("");
  const [category, setCategory] = useState("all");
  const limit = 25;

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const params = { page, limit };
        if (direction) params.direction = direction;
        if (category && category !== "all") params.category = category;
        const res = await mlmApi.getWalletHistory(params);
        if (!mounted) return;
        setData(res.data?.result ?? res.data?.data ?? res.data);
      } catch (err) {
        toast.error(
          err?.response?.data?.message || "Failed to load wallet history",
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [page, direction, category]);

  const items = data?.items || [];
  const totalPages = data?.totalPages || 1;
  const categories = data?.categories?.length
    ? data.categories
    : DEFAULT_CATEGORIES;

  return (
    // Wallet history is a single chronological ledger, so it doesn't
    // benefit from a 2-col split. Instead we keep the natural single
    // column but cap its width on very wide screens (`xl:max-w-4xl`)
    // so the rows stay readable and don't stretch into thin strips
    // across the full panel.
    <div className="space-y-3 xl:max-w-4xl xl:mx-auto">
      <div className="bg-white rounded-2xl border border-slate-200 p-3 space-y-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {categories.map((f) => (
            <button
              key={f.value || "all"}
              onClick={() => {
                setCategory(f.value || "all");
                setPage(1);
              }}
              className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                category === (f.value || "all")
                  ? "bg-violet-600 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {DIRECTION_FILTERS.map((f) => (
            <button
              key={f.value || "all-dir"}
              onClick={() => {
                setDirection(f.value);
                setPage(1);
              }}
              className={`text-xs font-bold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                direction === f.value
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-100 text-slate-700"
              }`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <ScrollText size={16} className="text-slate-500" />
          <h3 className="text-base font-bold text-slate-900">Wallet History</h3>
          <span className="ml-auto text-[11px] text-slate-500">
            {data?.total ?? 0} total
          </span>
        </div>
        {loading && !data ? (
          <div className="px-5 py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-slate-500">
            No wallet activity yet.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((row) => {
              const isCredit = row.direction === "CREDIT";
              let label =
                TYPE_LABEL[row.type] ||
                row.type?.replace(/_/g, " ").toLowerCase() ||
                "Transaction";

              if (
                row.type === "MLM_MANUAL_ADJUSTMENT" ||
                row.type === "MANUAL_ADJUSTMENT"
              ) {
                const bucket = row.metadata?.bucket;
                label =
                  bucket === "earnings" || bucket === "pending"
                    ? "Earnings Adjustment"
                    : "Shopping Wallet";
              }

              return (
                <li
                  key={String(row._id)}
                  className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isCredit
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-rose-50 text-rose-600"
                      }`}>
                      {isCredit ? (
                        <ArrowDownLeft size={18} />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 capitalize">
                        {label}
                      </p>
                      {row.type === "MLM_SIGNUP_BONUS_SPONSOR" &&
                      row.metadata?.referralName ? (
                        <p className="text-[11px] text-slate-500">
                          {row.description}
                          <span className="block font-semibold text-indigo-700 mt-0.5">
                            Referral: {row.metadata.referralName}
                            {row.metadata.referralUserId
                              ? ` · ${row.metadata.referralUserId}`
                              : ""}
                          </span>
                          {row.metadata.referralJoinedAt && (
                            <MemberJoinedSubtitle
                              joinedAt={row.metadata.referralJoinedAt}
                              className="text-[10px] text-slate-500 mt-0.5"
                            />
                          )}
                        </p>
                      ) : (
                        (getMlmReason(row) || row.description) && (
                          <p className="text-[11px] text-slate-500 line-clamp-2">
                            {getMlmReason(row) || row.description}
                          </p>
                        )
                      )}
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {formatDate(row.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p
                      className={`text-sm font-black ${
                        isCredit ? "text-emerald-700" : "text-rose-700"
                      }`}>
                      {isCredit ? "+ " : "- "}
                      {formatINR(row.amount)}
                    </p>
                    {Number.isFinite(row.balanceAfter) && (
                      <p className="text-[10px] text-slate-400">
                        Bal: {formatINR(row.balanceAfter)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {totalPages > 1 && (
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-2 flex items-center justify-between">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1">
            <ChevronLeft size={14} /> Prev
          </button>
          <span className="text-xs text-slate-500">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="text-xs font-bold text-slate-700 disabled:opacity-40 flex items-center gap-1">
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
};

export default WalletHistoryPage;

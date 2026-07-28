import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Store,
  Wallet,
  Package,
  ClipboardList,
  Clock,
  AlertTriangle,
  MapPin,
  ChevronRight,
  RefreshCcw,
  TrendingUp,
  Boxes,
  CheckCircle2,
  ScrollText,
  Receipt,
  History,
} from "lucide-react";
import { toast } from "sonner";
import { franchiseApi } from "../../services/franchiseApi";
import FranchiseMlmHeader from "./FranchiseMlmHeader";
import FranchisePushEnableBanner from "./FranchisePushEnableBanner";
import { primeFranchiseOrderAlertSound } from "./franchiseOrderAlertSound";

const formatINR = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

function paymentPagePath(registration) {
  const paymentId = registration?.payment?.paymentId;
  if (!paymentId) return null;
  return `/mlm/franchise/register/payment/${paymentId}`;
}

const OrderStatusPill = ({ status }) => {
  const map = {
    pending: "bg-amber-100 text-amber-800",
    accepted: "bg-blue-100 text-blue-800",
    fulfilled: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${map[status] || map.pending}`}
    >
      {status || "pending"}
    </span>
  );
};

const StatTile = ({ label, value, hint, icon: Icon, tone = "indigo" }) => {
  const tones = {
    indigo: "from-indigo-500 to-violet-600",
    emerald: "from-emerald-500 to-teal-600",
    amber: "from-amber-500 to-orange-500",
    slate: "from-slate-600 to-slate-800",
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
          <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{value}</p>
          {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
        </div>
        {Icon && (
          <div
            className={`w-9 h-9 rounded-xl bg-gradient-to-br ${tones[tone]} text-white flex items-center justify-center shrink-0`}
          >
            <Icon size={16} />
          </div>
        )}
      </div>
    </div>
  );
};

const ActionCard = ({ icon: Icon, title, description, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:shadow-md transition-all group w-full"
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Icon size={18} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-900">{title}</p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">{description}</p>
        </div>
      </div>
      <ChevronRight
        size={16}
        className="text-slate-300 group-hover:text-indigo-500 shrink-0 mt-1"
      />
    </div>
  </button>
);

const NonPartnerLanding = ({ data, navigate }) => {
  const registration = data?.registration || { phase: "none" };
  const price = formatINR(data?.config?.registrationPrice || 10000);
  const hubName = data?.config?.hubShopDisplayName || "Harsh's Hub";
  const multiplier = data?.config?.walletCreditMultiplier || 2;
  const payPath = paymentPagePath(registration);

  if (registration.phase === "pending_payment" && payPath) {
    return (
      <div className="max-w-lg mx-auto p-4 sm:p-6">
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
          <Clock className="mx-auto text-amber-600" size={36} />
          <h1 className="text-xl font-bold text-slate-900 mt-3">Complete your payment</h1>
          <p className="text-sm text-slate-600 mt-2">
            Your franchise registration is saved. Pay {price} and submit UPI proof to continue.
          </p>
          <button
            onClick={() => navigate(payPath)}
            className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl"
          >
            Continue to Payment
          </button>
        </div>
      </div>
    );
  }

  if (registration.phase === "pending_review" || registration.phase === "activating") {
    return (
      <div className="max-w-lg mx-auto p-4 sm:p-6">
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6 text-center">
          <Clock className="mx-auto text-blue-600" size={36} />
          <h1 className="text-xl font-bold text-slate-900 mt-3">Under admin review</h1>
          <p className="text-sm text-slate-600 mt-2">
            Your {price} registration payment has been submitted. We will activate your franchise
            once admin verifies it.
          </p>
        </div>
      </div>
    );
  }

  if (registration.phase === "rejected") {
    return (
      <div className="max-w-lg mx-auto p-4 sm:p-6 space-y-4">
        <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
          <AlertTriangle className="mx-auto text-rose-600" size={36} />
          <h1 className="text-xl font-bold text-slate-900 mt-3">Registration not approved</h1>
          <p className="text-sm text-slate-600 mt-2">
            {registration.payment?.adminRemarks ||
              "Your previous registration payment was rejected. You can register again."}
          </p>
          <button
            onClick={() => navigate("/mlm/franchise/register")}
            className="mt-5 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl"
          >
            Register Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 text-white rounded-2xl p-6 text-center">
        <Store className="mx-auto opacity-90" size={40} />
        <h1 className="text-2xl font-black mt-3">Home Shoppy Franchise</h1>
        <p className="text-sm opacity-90 mt-2 max-w-md mx-auto">
          Become a franchise partner for {price}. Stock products from {hubName} and fulfill
          nearby customer orders.
        </p>
        <button
          onClick={() => navigate("/mlm/franchise/register")}
          className="mt-5 w-full sm:w-auto px-8 bg-white text-indigo-700 font-bold py-3 rounded-xl hover:bg-indigo-50"
        >
          Register Now — {price}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { title: "1. Register", text: `Pay ${price} and submit your franchise address` },
          { title: "2. Top up wallet", text: `Admin credits ${multiplier}× product value on approval` },
          { title: "3. Fulfill orders", text: "Buy stock from hub and serve customers in your area" },
        ].map((step) => (
          <div key={step.title} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-bold text-indigo-700">{step.title}</p>
            <p className="text-xs text-slate-600 mt-1">{step.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

const PartnerDashboard = ({ data, navigate, onRefresh, refreshing }) => {
  const partner = data.partner;
  const wallet = data.wallet || {};
  const config = data.config || {};
  const [stock, setStock] = useState([]);
  const [orders, setOrders] = useState([]);
  const [topUps, setTopUps] = useState([]);
  const [extrasLoading, setExtrasLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setExtrasLoading(true);
    Promise.all([
      franchiseApi.getStock(),
      franchiseApi.listOrders({ limit: 8 }),
      franchiseApi.listTopUps(),
    ])
      .then(([stockRes, ordersRes, topUpsRes]) => {
        if (cancelled) return;
        setStock(stockRes.data?.result?.items ?? stockRes.data?.data?.items ?? []);
        setOrders(ordersRes.data?.result?.items ?? ordersRes.data?.data?.items ?? []);
        setTopUps(topUpsRes.data?.result?.items ?? topUpsRes.data?.data?.items ?? []);
      })
      .catch(() => toast.error("Failed to load dashboard details"))
      .finally(() => {
        if (!cancelled) setExtrasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [data?.partner?.id]);

  const stockUnits = stock.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  const pendingOrders = orders.filter((o) => o.franchiseStatus === "pending").length;
  const pendingTopUps = topUps.filter((t) => t.status === "pending_review").length;
  const recentOrders = orders.slice(0, 5);
  const topStock = [...stock].sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-600">Home Shoppy</p>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 hidden md:block">
            Franchise dashboard
          </h1>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold uppercase tracking-wider bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCcw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="bg-gradient-to-br from-indigo-600 to-violet-700 text-white rounded-2xl p-5 sm:p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 bg-white/15 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide">
              <CheckCircle2 size={12} /> Active partner
            </div>
            <h2 className="text-2xl sm:text-3xl font-black mt-3">
              {partner.displayName || "Franchise Partner"}
            </h2>
            <p className="text-sm opacity-90 mt-1">Partner code: {partner.referralCode}</p>
            <p className="text-xs opacity-75 mt-1">Member since {formatDate(partner.registeredAt)}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-3xl sm:text-4xl font-black">{formatINR(wallet.availableBalance)}</p>
            <p className="text-xs opacity-80">Franchise wallet balance</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Wallet balance"
          value={formatINR(wallet.availableBalance)}
          hint="Used to buy stock from hub"
          icon={Wallet}
          tone="indigo"
        />
        <StatTile
          label="Stock on hand"
          value={extrasLoading ? "…" : stockUnits}
          hint={`${stock.length} product lines`}
          icon={Boxes}
          tone="emerald"
        />
        <StatTile
          label="Pending orders"
          value={extrasLoading ? "…" : pendingOrders}
          hint="Awaiting your action"
          icon={ClipboardList}
          tone="amber"
        />
        <StatTile
          label="Top-up credit"
          value={`${config.walletCreditMultiplier || 2}×`}
          hint="Admin credit on wallet deposits"
          icon={TrendingUp}
          tone="slate"
        />
      </div>

      {pendingTopUps > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-900">
            <strong>{pendingTopUps}</strong> wallet top-up{pendingTopUps > 1 ? "s" : ""} awaiting admin
            approval.
          </p>
          <button
            type="button"
            onClick={() => navigate("/mlm/franchise/wallet")}
            className="text-xs font-bold text-amber-800 underline shrink-0"
          >
            View wallet
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {config.posEnabled && (
          <ActionCard
            icon={Receipt}
            title="Bill customer (POS)"
            description="Sell from your on-hand stock to walk-in customers at your store"
            onClick={() => navigate("/mlm/franchise/pos")}
          />
        )}
        {config.posEnabled && (
          <ActionCard
            icon={History}
            title="POS order history"
            description="View past walk-in bills, download invoices, and export Excel reports"
            onClick={() => navigate("/mlm/franchise/pos/history")}
          />
        )}
        <ActionCard
          icon={Wallet}
          title="Wallet top-up"
          description="Deposit funds and get 2× product value credited after admin approval"
          onClick={() => navigate("/mlm/franchise/wallet")}
        />
        <ActionCard
          icon={Package}
          title="Buy stock"
          description={`Purchase inventory from ${config.hubShopDisplayName || "Harsh's Hub"} using your wallet`}
          onClick={() => navigate("/mlm/franchise/catalog")}
        />
        <ActionCard
          icon={Store}
          title="My stock"
          description="Quick view of products you hold locally"
          onClick={() => navigate("/mlm/franchise/stock")}
        />
        <ActionCard
          icon={Boxes}
          title="Inventory management"
          description="Track incoming transfers, outgoing fulfillment, damage, and movement history"
          onClick={() => navigate("/mlm/franchise/inventory")}
        />
        <ActionCard
          icon={ClipboardList}
          title="Customer orders"
          description="Accept and fulfill hub orders routed to your franchise location"
          onClick={() => navigate("/mlm/franchise/orders")}
        />
        <ActionCard
          icon={ScrollText}
          title="Transaction history"
          description="View wallet top-ups, stock purchases, customer orders, and all franchise activity"
          onClick={() => navigate("/mlm/franchise/transactions")}
        />
        <ActionCard
          icon={TrendingUp}
          title="Reports"
          description="Track stock purchases, fulfillment trends, and inventory analytics"
          onClick={() => navigate("/mlm/franchise/reports")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Recent orders</h3>
            <button
              type="button"
              onClick={() => navigate("/mlm/franchise/orders")}
              className="text-xs font-bold text-indigo-600"
            >
              View all
            </button>
          </div>
          {extrasLoading ? (
            <p className="p-6 text-sm text-slate-500 text-center">Loading orders…</p>
          ) : recentOrders.length === 0 ? (
            <p className="p-6 text-sm text-slate-500 text-center">No orders routed yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recentOrders.map((order) => (
                <li key={order._id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm text-slate-900 truncate">
                      {order.orderId || order._id}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {order.customer?.name || "Customer"} ·{" "}
                      {formatINR(order.paymentBreakdown?.grandTotal || order.pricing?.total)}
                    </p>
                  </div>
                  <OrderStatusPill status={order.franchiseStatus} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Stock snapshot</h3>
            <button
              type="button"
              onClick={() => navigate("/mlm/franchise/stock")}
              className="text-xs font-bold text-indigo-600"
            >
              View all
            </button>
          </div>
          {extrasLoading ? (
            <p className="p-6 text-sm text-slate-500 text-center">Loading stock…</p>
          ) : topStock.length === 0 ? (
            <div className="p-6 text-center">
              <p className="text-sm text-slate-500">No stock yet.</p>
              <button
                type="button"
                onClick={() => navigate("/mlm/franchise/catalog")}
                className="mt-3 text-xs font-bold text-indigo-600"
              >
                Buy from catalog →
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topStock.map((row) => (
                <li key={row._id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {row.product?.name || "Product"}
                  </p>
                  <span className="text-sm font-black text-indigo-700 shrink-0">Qty {row.quantity}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex gap-3">
            <MapPin className="text-indigo-600 shrink-0 mt-0.5" size={18} />
            <div>
              <p className="font-bold text-slate-900">Franchise address</p>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {partner.address ||
                  [partner.locality, partner.city, partner.state, partner.pincode]
                    .filter(Boolean)
                    .join(", ") ||
                  "—"}
              </p>
              {partner.pincode && (
                <p className="text-xs text-slate-500 mt-2">Service pincode: {partner.pincode}</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
          <p className="font-bold text-slate-900">How it works</p>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            <li className="flex gap-2">
              <span className="text-indigo-600 font-bold">1.</span>
              Top up your franchise wallet — admin credits {config.walletCreditMultiplier || 2}× value
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600 font-bold">2.</span>
              Buy stock from {config.hubShopDisplayName || "Harsh's Hub"} catalog
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600 font-bold">3.</span>
              Customer hub orders route to the nearest franchise partner (you)
            </li>
            <li className="flex gap-2">
              <span className="text-indigo-600 font-bold">4.</span>
              Accept orders and fulfill from your stock
            </li>
          </ul>
        </div>
      </div>

      {topUps.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Recent wallet top-ups</h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {topUps.slice(0, 4).map((row) => (
              <li key={row._id} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                <div>
                  <p className="font-semibold">{formatINR(row.amount)} deposit</p>
                  <p className="text-xs text-slate-500">
                    Credit: {formatINR(row.amount * (row.creditMultiplierSnapshot || 2))}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                    row.status === "approved"
                      ? "bg-emerald-100 text-emerald-800"
                      : row.status === "rejected"
                        ? "bg-rose-100 text-rose-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {row.status?.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

const FranchiseDashboardPage = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await franchiseApi.getMe();
      setData(res.data?.result ?? res.data?.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load franchise profile");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    primeFranchiseOrderAlertSound();
  }, []);

  if (loading) {
    return (
      <>
        <FranchiseMlmHeader title="Home Shoppy" />
        <div className="p-6 text-center text-slate-500">Loading your franchise dashboard…</div>
      </>
    );
  }

  if (!data?.isPartner) {
    return (
      <>
        <FranchiseMlmHeader title="Home Shoppy" />
        <NonPartnerLanding data={data} navigate={navigate} />
      </>
    );
  }

  return (
    <>
      <FranchiseMlmHeader title="Home Shoppy" />
      <FranchisePushEnableBanner />
      <PartnerDashboard
        data={data}
        navigate={navigate}
        onRefresh={() => load(true)}
        refreshing={refreshing}
      />
    </>
  );
};

export default FranchiseDashboardPage;

import React, { useEffect, useState, useMemo } from "react";
import { Eye, Search, Plus, Minus, PackageCheck, X, ShoppingBag, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { adminFranchiseApi, franchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  FilterTabs,
  DataTable,
  EmptyRow,
  StatusPill,
  PaymentReviewModal,
  formatINR,
  formatDate,
} from "./franchiseAdminShared";
import { getAvailableStock } from "@/core/utils/productStock";

const STATUS_FILTERS = [
  { value: "pending_review", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "ALL", label: "All" },
];

const FranchiseTopUps = () => {
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending_review");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [actionId, setActionId] = useState(null);

  // First top-up product selection modal state
  const [firstTopUpTargetRow, setFirstTopUpTargetRow] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [cart, setCart] = useState({});
  const [catalogSearch, setCatalogSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminFranchiseApi.listTopUps({ status, limit: 50 });
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load top-ups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [status]);

  const openFirstTopUpModal = async (row) => {
    setFirstTopUpTargetRow(row);
    setCart({});
    setCatalogSearch("");
    setCatalogLoading(true);
    try {
      const res = await franchiseApi.getCatalog({ limit: 200 });
      const catItems = res.data?.result?.items ?? res.data?.data?.items ?? [];
      setCatalog(catItems);
    } catch (err) {
      toast.error(err?.response?.data?.message || "Failed to load catalog");
    } finally {
      setCatalogLoading(false);
    }
  };

  const approve = async (id, forceData = null) => {
    const row = items.find((r) => r._id === id) || selected;
    if (!row) return;

    if (row.isFirstTopup && !forceData) {
      openFirstTopUpModal(row);
      return;
    }

    const credit = row.amount * (row.creditMultiplierSnapshot || 2);
    if (!forceData && !window.confirm(`Approve top-up and credit ${formatINR(credit)} to franchise wallet?`)) return;

    setActionId(id);
    try {
      await adminFranchiseApi.approveTopUp(id, forceData || {});
      toast.success(row.isFirstTopup ? "1st Top-up approved & products dispatched to partner!" : "Top-up approved — wallet credited");
      setSelected(null);
      setFirstTopUpTargetRow(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Approve failed");
    } finally {
      setActionId(null);
    }
  };

  const reject = async (id) => {
    const reason = window.prompt("Rejection reason:");
    if (!reason?.trim()) return;
    setActionId(id);
    try {
      await adminFranchiseApi.rejectTopUp(id, { reason: reason.trim() });
      toast.success("Top-up rejected");
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(err?.response?.data?.message || "Reject failed");
    } finally {
      setActionId(null);
    }
  };

  const canAct = (row) => row.status === "pending_review";

  // Product Selection Modal Computations
  const maxBudget = firstTopUpTargetRow
    ? firstTopUpTargetRow.amount * (firstTopUpTargetRow.creditMultiplierSnapshot || 2)
    : 0;

  const cartLines = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([productId, quantity]) => {
        const product = catalog.find((p) => String(p._id) === productId);
        const unitPrice = Number(product?.price) || 0;
        return { productId, quantity, product, unitPrice, lineTotal: unitPrice * quantity, name: product?.name || "" };
      });
  }, [cart, catalog]);

  const selectedTotalValue = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);

  const setQty = (productId, delta) => {
    const product = catalog.find((p) => String(p._id) === String(productId));
    if (!product) return;

    setCart((prev) => {
      const current = prev[productId] || 0;
      const next = Math.max(0, current + delta);
      const available = getAvailableStock(product, "");

      if (delta > 0 && next > available) {
        toast.error(`Only ${available} units available in hub stock`);
        return prev;
      }

      if (next === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: next };
    });
  };

  const handleDirectQtyChange = (productId, rawVal) => {
    const product = catalog.find((p) => String(p._id) === String(productId));
    if (!product) return;

    const available = getAvailableStock(product, "");
    if (rawVal === "") {
      setCart((prev) => {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      });
      return;
    }

    let parsed = parseInt(rawVal, 10);
    if (isNaN(parsed) || parsed < 0) parsed = 0;

    if (parsed > available) {
      parsed = available;
      toast.error(`Cannot exceed available hub stock (${available} units)`);
    }

    setCart((prev) => {
      if (parsed === 0) {
        const copy = { ...prev };
        delete copy[productId];
        return copy;
      }
      return { ...prev, [productId]: parsed };
    });
  };

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((p) => p.name?.toLowerCase().includes(q));
  }, [catalog, catalogSearch]);

  const handleConfirmFirstTopUpApproval = () => {
    if (cartLines.length === 0) {
      return toast.error("Please select at least one product for the first top-up allocation");
    }
    const payloadItems = cartLines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
    approve(firstTopUpTargetRow._id, { items: payloadItems });
  };

  return (
    <PageShell
      title="Franchise Wallet Top-ups"
      subtitle="Review partner wallet deposits. For 1st top-ups, select & dispatch products directly."
      actions={<FilterTabs options={STATUS_FILTERS} value={status} onChange={setStatus} />}
    >
      <DataTable
        columns={[
          { key: "submitted", label: "Submitted" },
          { key: "partner", label: "Partner" },
          { key: "deposit", label: "Deposit", align: "right" },
          { key: "multiplier", label: "Multiplier", align: "right" },
          { key: "credit", label: "Credit / Product Budget", align: "right" },
          { key: "txn", label: "Transaction ID" },
          { key: "status", label: "Status" },
          { key: "action", label: "Actions", align: "right" },
        ]}
      >
        {loading ? (
          <EmptyRow colSpan={8} message="Loading top-up requests…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={8} message="No top-ups in this status." />
        ) : (
          items.map((row) => {
            const credit = row.amount * (row.creditMultiplierSnapshot || 2);
            return (
              <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                <td className="px-4 py-3 text-xs">{formatDate(row.manualPaymentDetails?.submittedAt || row.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-slate-900">
                      {row.partnerInfo?.userId?.name || row.partnerInfo?.displayName || "Partner"}
                    </p>
                    {row.isFirstTopup && (
                      <span className="px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider bg-purple-100 text-purple-800 rounded border border-purple-200">
                        1st Top-Up
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">{row.partnerInfo?.referralCode || "—"}</p>
                </td>
                <td className="px-4 py-3 text-right font-bold">{formatINR(row.amount)}</td>
                <td className="px-4 py-3 text-right">{row.creditMultiplierSnapshot || 2}×</td>
                <td className="px-4 py-3 text-right font-bold text-emerald-700">{formatINR(credit)}</td>
                <td className="px-4 py-3 font-mono text-xs max-w-[140px] truncate">
                  {row.manualPaymentDetails?.transactionId || "—"}
                </td>
                <td className="px-4 py-3">
                  <StatusPill status={row.status} />
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex flex-wrap gap-1 justify-end">
                    <button
                      type="button"
                      onClick={() => setSelected(row)}
                      className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-slate-700 hover:bg-slate-900 text-white rounded inline-flex items-center gap-1"
                    >
                      <Eye size={10} /> View
                    </button>
                    {canAct(row) && (
                      <>
                        <button
                          type="button"
                          onClick={() => approve(row._id)}
                          disabled={actionId === row._id}
                          className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded disabled:opacity-50 text-white ${
                            row.isFirstTopup ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700"
                          }`}
                        >
                          {row.isFirstTopup ? "Select Products & Approve" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => reject(row._id)}
                          disabled={actionId === row._id}
                          className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-rose-600 text-white rounded disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </DataTable>

      <PaymentReviewModal
        open={!!selected}
        onClose={() => setSelected(null)}
        title="Wallet top-up request"
        subtitle={selected ? `Submitted ${formatDate(selected.manualPaymentDetails?.submittedAt || selected.updatedAt)}` : ""}
        screenshotUrl={selected?.manualPaymentDetails?.screenshotUrl}
        screenshotDownloadFilename={
          selected
            ? `franchise-topup-${selected.manualPaymentDetails?.transactionId || selected._id}`
            : 'payment-screenshot'
        }
        canAct={selected ? canAct(selected) : false}
        onApprove={() => approve(selected._id)}
        onReject={() => reject(selected._id)}
        actionInProgress={selected && actionId === selected._id}
        fields={
          selected
            ? [
                {
                  label: "Partner",
                  content: (
                    <>
                      <p className="font-semibold">{selected.partnerInfo?.userId?.name || selected.partnerInfo?.displayName || "Partner"}</p>
                      <p className="text-xs text-slate-500">{selected.partnerInfo?.referralCode}</p>
                      {selected.isFirstTopup && (
                        <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-800 rounded">
                          First Top-Up (Direct Admin Product Selection)
                        </span>
                      )}
                    </>
                  ),
                },
                {
                  label: "Deposit amount",
                  content: <p className="text-xl font-black">{formatINR(selected.amount)}</p>,
                },
                {
                  label: "Credit / Product Value",
                  content: (
                    <p className="text-xl font-black text-emerald-700">
                      {formatINR(selected.amount * (selected.creditMultiplierSnapshot || 2))}
                    </p>
                  ),
                },
                {
                  label: "Transaction ID",
                  content: (
                    <p className="font-mono text-sm break-all">{selected.manualPaymentDetails?.transactionId || "—"}</p>
                  ),
                },
              ]
            : []
        }
      />

      {/* Admin Product Selection Modal for First Top-Up */}
      {firstTopUpTargetRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div>
                <div className="flex items-center gap-2">
                  <ShoppingBag size={20} className="text-purple-400" />
                  <h3 className="font-bold text-lg">First Top-Up Product Selection</h3>
                </div>
                <p className="text-xs text-slate-300 mt-0.5">
                  Select Hub products to dispatch to{" "}
                  <span className="font-semibold text-white">
                    {firstTopUpTargetRow.partnerInfo?.userId?.name || firstTopUpTargetRow.partnerInfo?.displayName || "Franchise Partner"}
                  </span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFirstTopUpTargetRow(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            {/* Budget Bar */}
            <div className="px-6 py-3 bg-purple-50 border-b border-purple-100 flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="flex items-center gap-4">
                <div>
                  <span className="text-xs text-purple-700 font-medium">Target Budget (2× Credit):</span>{" "}
                  <span className="font-black text-purple-900">{formatINR(maxBudget)}</span>
                </div>
                <div>
                  <span className="text-xs text-slate-600 font-medium">Selected Value:</span>{" "}
                  <span className="font-black text-emerald-700">{formatINR(selectedTotalValue)}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-700">Remaining Budget:</span>
                <span
                  className={`font-black text-sm px-2.5 py-0.5 rounded-full ${
                    maxBudget - selectedTotalValue >= 0
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-rose-100 text-rose-800"
                  }`}
                >
                  {formatINR(maxBudget - selectedTotalValue)}
                </span>
              </div>
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b border-slate-100 bg-slate-50">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Search hub catalog products by name…"
                  className="w-full pl-9 pr-4 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Product Catalog List */}
            <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
              {catalogLoading ? (
                <div className="col-span-2 text-center py-12 text-slate-500 text-sm">Loading hub catalog…</div>
              ) : filteredCatalog.length === 0 ? (
                <div className="col-span-2 text-center py-12 text-slate-500 text-sm">No products found in hub catalog</div>
              ) : (
                filteredCatalog.map((p) => {
                  const qty = cart[p._id] || 0;
                  const available = getAvailableStock(p, "");
                  const isOutOfStock = available <= 0;
                  return (
                    <div
                      key={p._id}
                      className="border border-slate-200 rounded-xl p-3 flex gap-3 bg-white shadow-xs items-center"
                    >
                      <div className="w-14 h-14 rounded-lg bg-slate-100 flex-shrink-0 overflow-hidden flex items-center justify-center border border-slate-100">
                        {p.mainImage ? (
                          <img src={p.mainImage} alt={p.name} className="w-full h-full object-cover" />
                        ) : (
                          <ShoppingBag size={20} className="text-slate-400" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-900 text-xs truncate">{p.name}</p>
                        <p className="text-sm font-black text-purple-700 mt-0.5">{formatINR(p.price)}</p>
                        <p className="text-[10px] font-medium text-slate-500">
                          {isOutOfStock ? (
                            <span className="text-rose-600 font-bold">Out of stock</span>
                          ) : (
                            `${available} available in hub`
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setQty(p._id, -1)}
                          disabled={qty === 0}
                          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"
                        >
                          <Minus size={12} />
                        </button>
                        <input
                          type="number"
                          min="0"
                          max={available}
                          value={qty || ""}
                          onChange={(e) => handleDirectQtyChange(p._id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          placeholder="0"
                          className="w-12 h-7 text-center font-bold text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button
                          type="button"
                          onClick={() => setQty(p._id, 1)}
                          disabled={isOutOfStock || qty >= available}
                          className="w-7 h-7 rounded-lg border border-slate-200 flex items-center justify-center hover:bg-slate-100 disabled:opacity-30"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
              <div className="text-xs text-slate-600">
                <span className="font-bold text-slate-900">{cartLines.length}</span> SKUs selected · Total:{" "}
                <span className="font-black text-emerald-700">{formatINR(selectedTotalValue)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFirstTopUpTargetRow(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFirstTopUpApproval}
                  disabled={cartLines.length === 0 || actionId === firstTopUpTargetRow._id}
                  className="px-5 py-2.5 text-xs font-bold uppercase tracking-wider bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-sm disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <PackageCheck size={14} /> Approve & Dispatch Stock
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
};

export default FranchiseTopUps;


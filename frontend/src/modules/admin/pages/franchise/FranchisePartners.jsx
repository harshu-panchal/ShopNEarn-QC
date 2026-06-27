import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { adminFranchiseApi } from "../../../customer/services/franchiseApi";
import {
  PageShell,
  DataTable,
  EmptyRow,
  StatusPill,
  formatINR,
  formatDate,
} from "./franchiseAdminShared";

const FranchisePartners = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const params = { limit: 100 };
      if (search) params.q = search;
      const res = await adminFranchiseApi.listPartners(params);
      setItems(res.data?.result?.items ?? res.data?.data?.items ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  return (
    <PageShell
      title="Franchise Partners"
      subtitle="Active Home Shoppy partners, wallet balances, territories, and stock."
      actions={
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
          className="flex items-center bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <Search size={14} className="ml-2 text-slate-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, code, phone…"
            className="px-2 py-2 text-xs bg-transparent focus:outline-none w-44 sm:w-56"
          />
          {searchInput && (
            <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }} className="px-2 text-slate-400">
              <X size={14} />
            </button>
          )}
        </form>
      }
    >
      <DataTable
        columns={[
          { key: "partner", label: "Partner" },
          { key: "code", label: "Code" },
          { key: "location", label: "Location" },
          { key: "wallet", label: "Wallet", align: "right" },
          { key: "status", label: "Status" },
          { key: "since", label: "Since" },
          { key: "action", label: "", align: "right" },
        ]}
      >
        {loading ? (
          <EmptyRow colSpan={7} message="Loading partners…" />
        ) : items.length === 0 ? (
          <EmptyRow colSpan={7} message="No franchise partners found." />
        ) : (
          items.map((row) => (
            <tr key={row._id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-900">{row.userId?.name || row.displayName || "Partner"}</p>
                <p className="text-xs text-slate-500">{row.userId?.phone || row.phone || "—"}</p>
              </td>
              <td className="px-4 py-3 font-mono text-sm font-bold">{row.referralCode}</td>
              <td className="px-4 py-3 text-xs text-slate-600 max-w-xs">
                {[row.locality, row.city, row.pincode].filter(Boolean).join(", ") || (row.territoryPincodes || []).join(", ") || "—"}
              </td>
              <td className="px-4 py-3 text-right font-bold">{formatINR(row.wallet?.availableBalance)}</td>
              <td className="px-4 py-3">
                <StatusPill status={row.status} />
              </td>
              <td className="px-4 py-3 text-xs whitespace-nowrap">{formatDate(row.registeredAt)}</td>
              <td className="px-4 py-3 text-right">
                <Link
                  to={`/admin/franchise/partners/${row._id}`}
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-800 uppercase tracking-wider"
                >
                  Manage →
                </Link>
              </td>
            </tr>
          ))
        )}
      </DataTable>
    </PageShell>
  );
};

export default FranchisePartners;

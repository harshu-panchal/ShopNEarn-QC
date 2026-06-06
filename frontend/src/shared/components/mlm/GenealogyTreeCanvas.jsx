import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Loader2,
  Plus,
  Minus,
  Move,
  Sparkles,
  Users,
  TrendingUp,
  Calendar,
  BadgeCheck,
  Hash,
  ChevronLeft,
  ChevronRight,
  Crown,
} from "lucide-react";

/**
 * GenealogyTreeCanvas — reusable interactive binary-tree canvas.
 *
 * Shared by:
 *   - Customer "My Network" tree view
 *     (`frontend/src/modules/customer/pages/mlm/genealogy/TreeViewPage.jsx`)
 *   - Admin member detail page
 *     (`frontend/src/modules/admin/pages/mlm/MlmMemberDetail.jsx`)
 *
 * Responsibilities:
 *   - Tidy-tree layout math (nodes locked in deterministic positions)
 *   - Pan + zoom of the whole canvas
 *   - Hover tooltip with the full member detail card
 *   - Tap-to-recenter callback (parent decides what to fetch)
 *   - Depth selector + zoom controls
 *   - Empty / loading / "not a member" states
 *
 * Out of scope (left to the parent):
 *   - Data fetching (different APIs for customer vs admin)
 *   - Navigation history / breadcrumb (different UX for each surface)
 *
 * Interaction model:
 *   - Per-node drag is intentionally disabled — every node sits at
 *     the position computed by the tidy-tree algorithm so the chart
 *     remains visually consistent for every viewer (no per-user
 *     drift). To move the chart, drag the background to pan or use
 *     the zoom controls.
 *   - Tap detection on a node piggybacks on the browser's synthetic
 *     `click` event so the canvas's `pointerdown → pan` flow on the
 *     background is unaffected: a true tap (no movement) fires
 *     `onNodeTap`, a press-and-drag pans the canvas as usual.
 */

// Node "slot" dimensions. The visual node is a coloured pill holding
// the referral code with the name as plain text below. These numbers
// drive the tidy-tree layout math (column spacing, edge endpoints)
// and the inline width/height of each slot's hit area.
//
// Tightened from 130×50 with 32/70 gaps to compress the tree on the
// page — a depth-4 network now reads as a coherent group instead of
// sprawling across ~2.6k px of horizontal real estate.
const NODE_WIDTH = 96;
const NODE_HEIGHT = 46;
const HORIZONTAL_GAP = 12;
const VERTICAL_GAP = 56;

const GenealogyTreeCanvas = ({
  tree,
  loading = false,
  isMember = true,
  depth,
  onDepthChange,
  onNodeTap,
  breadcrumb = null,
  emptyMemberMessage = "Your tree appears once you become a member. Activate your account to see your network.",
  emptyTreeMessage = "No downline yet — referrals will populate this canvas as they join.",
  footerHint = null,
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.85);
  // Hovered node — when set, renders a fixed-position tooltip with
  // the full member details. We capture the node's screen rect at
  // hover-enter time so the tooltip can be positioned relative to
  // the pill regardless of pan/zoom or scroll inside the canvas.
  const [hoveredNode, setHoveredNode] = useState(null);
  const hideHoverTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) {
        clearTimeout(hideHoverTimerRef.current);
        hideHoverTimerRef.current = null;
      }
    },
    [],
  );

  // ----- Compute default tidy layout (recursive divide-and-conquer) -----
  const { nodes, edges, treeWidth, treeHeight } = useMemo(() => {
    if (!tree) {
      return { nodes: [], edges: [], treeWidth: 0, treeHeight: 0 };
    }
    const nodeList = [];
    const edgeList = [];

    // Resolve a stable, unique string id for a tree node. The
    // backend populates `userId` as a User object on the customer
    // side (`{ _id, name, phone, userId, ... }`) and increasingly
    // does the same on the admin side. Naively stringifying that
    // object yields "[object Object]" which would collide for
    // EVERY node, breaking React's `key` reconciliation (other
    // cards vanish on the next render) and breaking edge lookups
    // (every edge resolves to the same node, so the curve
    // degenerates to zero length and never paints). Prefer the
    // user's `_id` hex string, then the membership `_id`.
    function nodeIdFor(node) {
      if (!node) return "";
      const u = node.userId;
      if (u && typeof u === "object" && u._id) return String(u._id);
      if (typeof u === "string") return u;
      if (node._id) return String(node._id);
      return "";
    }

    // First pass: compute subtree widths (in "node columns").
    function measure(node) {
      if (!node) return 0;
      const leftW = measure(node.left);
      const rightW = measure(node.right);
      node.__subtreeColumns = Math.max(1, leftW + rightW);
      return node.__subtreeColumns;
    }
    measure(tree);

    // Second pass: assign x/y based on subtree widths.
    function place(node, leftEdgeX, depthLevel) {
      if (!node) return;
      const columns = node.__subtreeColumns || 1;
      const totalWidth = columns * (NODE_WIDTH + HORIZONTAL_GAP);
      const centerX = leftEdgeX + totalWidth / 2 - NODE_WIDTH / 2;
      const y = depthLevel * (NODE_HEIGHT + VERTICAL_GAP);
      const id = nodeIdFor(node);
      nodeList.push({
        id,
        x: centerX,
        y,
        data: node,
      });

      if (node.left) {
        const leftColumns = node.left.__subtreeColumns || 1;
        const leftWidth = leftColumns * (NODE_WIDTH + HORIZONTAL_GAP);
        place(node.left, leftEdgeX, depthLevel + 1);
        edgeList.push({
          fromId: id,
          toId: nodeIdFor(node.left),
          side: "L",
        });
        leftEdgeX += leftWidth;
      }
      if (node.right) {
        place(node.right, leftEdgeX, depthLevel + 1);
        edgeList.push({
          fromId: id,
          toId: nodeIdFor(node.right),
          side: "R",
        });
      }
    }
    place(tree, 0, 0);

    const maxX = nodeList.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH), 0);
    const maxY = nodeList.reduce((m, n) => Math.max(m, n.y + NODE_HEIGHT), 0);
    return {
      nodes: nodeList,
      edges: edgeList,
      treeWidth: maxX + 40,
      treeHeight: maxY + 40,
    };
  }, [tree]);

  // Nodes are rendered straight from the tidy-tree layout — there
  // are no per-user position overrides because per-node drag is
  // disabled (see header).
  const positionedNodes = nodes;

  // ----- Pan (drag on background) -----
  const panState = useRef({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });
  const onPanStart = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return;
    panState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHoveredNode(null);
  }, [pan]);
  const onPanMove = useCallback((e) => {
    if (!panState.current.active) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setPan({ x: panState.current.panX + dx, y: panState.current.panY + dy });
  }, []);
  const onPanEnd = useCallback((e) => {
    if (panState.current.active) {
      panState.current.active = false;
      e.currentTarget?.releasePointerCapture?.(e.pointerId);
    }
  }, []);

  // ----- Zoom (wheel + buttons) -----
  const onWheel = useCallback((e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom((z) => Math.max(0.3, Math.min(2.5, z + (e.deltaY < 0 ? 0.08 : -0.08))));
  }, []);

  const fitToCenter = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPan({
      x: (rect.width - treeWidth * zoom) / 2,
      y: 32,
    });
  }, [treeWidth, zoom]);

  // Refit whenever the tree changes (e.g. parent fetched a new
  // sub-tree after a tap). Also fires after the initial mount.
  useEffect(() => {
    if (!loading && treeWidth > 0) {
      fitToCenter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, treeWidth, tree]);

  // Node tap — the browser's synthetic `click` event handles the
  // drag-vs-tap distinction natively, so we don't have to track
  // pointermove distance ourselves. `onClick` only fires when
  // pointerdown and pointerup land on the same element with
  // negligible movement; anything beyond that is treated as a pan
  // and the canvas listeners get the event instead.
  const handleNodeClick = useCallback(
    (node) => {
      onNodeTap?.(node);
    },
    [onNodeTap],
  );

  // ----- Hover plumbing -----
  const handleNodeHoverEnter = useCallback((node, rect) => {
    if (hideHoverTimerRef.current) {
      clearTimeout(hideHoverTimerRef.current);
      hideHoverTimerRef.current = null;
    }
    if (!rect) return;
    setHoveredNode({ node, rect });
  }, []);

  const handleNodeHoverLeave = useCallback(() => {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = setTimeout(() => {
      setHoveredNode(null);
      hideHoverTimerRef.current = null;
    }, 120);
  }, []);

  // ----- Render branches -----
  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500">Loading tree…</p>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-8 text-center">
        <Sparkles className="w-10 h-10 text-slate-300 mb-2" />
        <p className="text-sm text-slate-500 max-w-sm">{emptyMemberMessage}</p>
      </div>
    );
  }

  if (!tree) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-8 text-center">
        <p className="text-sm text-slate-500 max-w-sm">{emptyTreeMessage}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2 flex-wrap">
          {typeof depth === "number" && onDepthChange && (
            <>
              <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Depth
              </label>
              <select
                value={depth}
                onChange={(e) => onDepthChange(Number(e.target.value))}
                className="text-xs font-bold border border-slate-200 rounded-md px-2 py-1 bg-white"
              >
                {[2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {d} levels
                  </option>
                ))}
              </select>
            </>
          )}
          {breadcrumb}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
            className="w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600"
            aria-label="Zoom out"
            type="button"
          >
            <Minus size={14} />
          </button>
          <span className="text-xs font-bold text-slate-600 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(2.5, z + 0.1))}
            className="w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600"
            aria-label="Zoom in"
            type="button"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={fitToCenter}
            className="w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 ml-1"
            aria-label="Center tree"
            type="button"
          >
            <Move size={14} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 min-h-0 bg-[radial-gradient(circle_at_1px_1px,_#e2e8f0_1px,_transparent_0)] [background-size:16px_16px] cursor-grab active:cursor-grabbing select-none overflow-hidden touch-pan-y"
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}
        onWheel={onWheel}
      >
        <div
          ref={stageRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            width: treeWidth,
            height: treeHeight,
          }}
        >
          <svg
            width={treeWidth}
            height={treeHeight}
            className="absolute top-0 left-0 pointer-events-none"
          >
            {edges.map((edge) => {
              const from = positionedNodes.find((n) => n.id === edge.fromId);
              const to = positionedNodes.find((n) => n.id === edge.toId);
              if (!from || !to) return null;
              const x1 = from.x + NODE_WIDTH / 2;
              const y1 = from.y + NODE_HEIGHT;
              const x2 = to.x + NODE_WIDTH / 2;
              const y2 = to.y;
              const midY = (y1 + y2) / 2;
              return (
                <g key={`${edge.fromId}-${edge.toId}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x1}
                    y2={midY}
                    stroke="#94a3b8"
                    strokeWidth={1}
                  />
                  <line
                    x1={x1}
                    y1={midY}
                    x2={x2}
                    y2={midY}
                    stroke="#94a3b8"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  <line
                    x1={x2}
                    y1={midY}
                    x2={x2}
                    y2={y2}
                    stroke="#94a3b8"
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </svg>

          {positionedNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              onTap={handleNodeClick}
              onHoverEnter={handleNodeHoverEnter}
              onHoverLeave={handleNodeHoverLeave}
              isHovered={hoveredNode?.node?.id === n.id}
            />
          ))}
        </div>

        {hoveredNode && (
          <NodeHoverTooltip anchorRect={hoveredNode.rect} node={hoveredNode.node} />
        )}
      </div>

      {footerHint !== null && (
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 leading-relaxed">
          {footerHint || (
            <>
              <span className="hidden sm:inline">
                Hover a node for details • Tap to view their downline • Drag
                the background to pan • Hold ⌘/Ctrl + scroll to zoom.
              </span>
              <span className="sm:hidden">
                Tap a node to view their downline • Drag the background to
                pan • Pinch to zoom.
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * NodeCard — pill + label.
 *
 * Renders a coloured pill containing the referral code on top and
 * the customer's name in plain text directly below. The slot is
 * absolutely positioned at the tidy-tree coordinates and is no
 * longer draggable — `onClick` is the sole interaction (browser
 * decides tap-vs-pan natively based on pointer movement).
 *
 * Status hints survive as colour-only cues:
 *   - Root → indigo pill + "You" suffix appended to the name.
 *   - Unpaid downline → amber pill.
 *   - Active downline → slate-700 pill (neutral).
 */
const NodeCard = ({ node, onTap, onHoverEnter, onHoverLeave, isHovered }) => {
  const data = node.data || {};
  const isRoot = data.position === null || data.position === undefined;
  const isUnpaid = data.status === "registered_unpaid";
  const pillRef = useRef(null);

  const pillClass = isRoot
    ? "bg-indigo-600 text-white"
    : isUnpaid
      ? "bg-amber-500 text-white"
      : "bg-slate-700 text-white";

  const handleEnter = useCallback(() => {
    if (!onHoverEnter) return;
    const rect = pillRef.current?.getBoundingClientRect();
    onHoverEnter(node, rect);
  }, [node, onHoverEnter]);

  const handleLeave = useCallback(() => {
    onHoverLeave?.();
  }, [onHoverLeave]);

  const handleClick = useCallback(
    (e) => {
      // Suppress bubbling so the click doesn't restart a pan or
      // trigger any background interaction the parent canvas may
      // attach later.
      e.stopPropagation();
      onTap?.(node);
    },
    [node, onTap],
  );

  return (
    <div
      onClick={handleClick}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      className="flex flex-col items-center justify-start cursor-pointer select-none"
    >
      <span
        ref={pillRef}
        className={`px-3 py-1 rounded-md text-[11px] font-mono font-bold tracking-wider shadow-sm whitespace-nowrap transition-transform ${pillClass} ${
          isHovered ? "ring-2 ring-offset-1 ring-indigo-400 scale-[1.04]" : ""
        }`}
      >
        {data.referralCode || "—"}
      </span>
      <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 truncate max-w-full">
        {data.name || "Member"}
        {isRoot && data.__isViewerSelf && (
          <span className="ml-1 text-indigo-600 normal-case font-bold">
            (You)
          </span>
        )}
      </span>
    </div>
  );
};

/**
 * Floating details tooltip for a hovered node.
 *
 * Positioned in fixed viewport coordinates so it never inherits the
 * canvas's pan / zoom transform. Pointer-events disabled so the
 * tooltip never steals hover from the underlying pill (which would
 * cause an enter/leave flicker loop). Auto-flips above when the
 * anchor sits in the bottom half of the viewport.
 */
const NodeHoverTooltip = ({ anchorRect, node }) => {
  const data = node?.data || {};
  const u = data.userId;
  const publicUserId =
    (typeof u === "object" && u?.userId) || data.publicUserId || null;
  const name = (typeof u === "object" && u?.name) || data.name || "Member";
  const phone = data.phone || (typeof u === "object" ? u?.phone : null) || null;
  const referralCode = data.referralCode || null;
  const status = data.status || "unknown";
  const planType = data.planType || "—";
  const joinedAt = data.planAJoinedAt || data.joinedAt || null;
  const left = Number(data.leftLegDirectCount || 0);
  const right = Number(data.rightLegDirectCount || 0);
  const pairs = Number(data.pairsCompleted || 0);
  const totalDownline = Number(data.totalDownlineCount || 0);
  const lifetime =
    Number(data.lifetimePlanAEarnings || 0) +
    Number(data.lifetimePlanBEarnings || 0);
  const isRoot = data.position === null || data.position === undefined;
  const isUnpaid = status === "registered_unpaid";

  const TOOLTIP_W = 280;
  const GAP = 10;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const anchorCenterX = anchorRect ? anchorRect.left + anchorRect.width / 2 : vw / 2;
  const left_ = Math.max(
    8,
    Math.min(anchorCenterX - TOOLTIP_W / 2, vw - TOOLTIP_W - 8),
  );
  const placeAbove = anchorRect && anchorRect.bottom > vh - 260;
  const top_ = anchorRect
    ? placeAbove
      ? Math.max(8, anchorRect.top - GAP - 240)
      : anchorRect.bottom + GAP
    : 60;

  const statusLabel = isRoot
    ? "Root"
    : isUnpaid
      ? "Registered (unpaid)"
      : status === "active"
        ? "Active"
        : status.replace(/_/g, " ");
  const statusClass = isRoot
    ? "bg-indigo-100 text-indigo-700"
    : isUnpaid
      ? "bg-amber-100 text-amber-800"
      : "bg-emerald-100 text-emerald-700";

  const fmtMoney = (n) =>
    `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const fmtDate = (d) => {
    if (!d) return "—";
    try {
      return new Date(d).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        left: left_,
        top: top_,
        width: TOOLTIP_W,
        zIndex: 60,
        pointerEvents: "none",
      }}
      className="rounded-xl bg-white shadow-xl ring-1 ring-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-3 py-2.5 bg-linear-to-br from-indigo-50 to-white border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">
              Member
            </p>
            <p className="mt-0.5 text-sm font-bold text-slate-900 truncate">
              {name}
              {isRoot && (
                <Crown size={12} className="inline ml-1 text-indigo-500" />
              )}
            </p>
          </div>
          <span
            className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-3 py-2 space-y-1.5 text-[12px]">
        {publicUserId && (
          <TooltipRow
            icon={<BadgeCheck size={13} className="text-indigo-500" />}
            label="User ID"
            value={publicUserId}
            mono
          />
        )}
        {referralCode && (
          <TooltipRow
            icon={<Hash size={13} className="text-slate-400" />}
            label="Referral"
            value={referralCode}
            mono
          />
        )}
        <TooltipRow
          icon={<Sparkles size={13} className="text-amber-500" />}
          label="Plan"
          value={planType && planType !== "—" ? `Plan ${planType}` : "—"}
        />
        <TooltipRow
          icon={<Calendar size={13} className="text-slate-400" />}
          label="Joined"
          value={fmtDate(joinedAt)}
        />
        {phone && (
          <TooltipRow
            icon={<Users size={13} className="text-slate-400" />}
            label="Phone"
            value={phone}
          />
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-100 grid grid-cols-3 gap-1.5">
        <Stat
          icon={<ChevronLeft size={11} />}
          label="Left"
          value={left}
          tone="emerald"
        />
        <Stat
          icon={<ChevronRight size={11} />}
          label="Right"
          value={right}
          tone="indigo"
        />
        <Stat
          icon={<Users size={11} />}
          label="Pairs"
          value={pairs}
          tone="amber"
        />
      </div>

      <div className="px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2 bg-slate-50">
        <div className="flex items-center gap-1 text-[11px] text-slate-500">
          <Users size={11} />
          <span className="font-semibold">{totalDownline}</span>
          <span>downline</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-slate-700 font-bold">
          <TrendingUp size={11} className="text-emerald-500" />
          {fmtMoney(lifetime)}
        </div>
      </div>

      {!isRoot && (
        <div className="px-3 py-1.5 bg-indigo-600 text-[10px] text-white font-bold uppercase tracking-wider text-center">
          Tap to view this member&apos;s downline
        </div>
      )}
    </div>
  );
};

const TooltipRow = ({ icon, label, value, mono = false }) => (
  <div className="flex items-center justify-between gap-2 min-w-0">
    <div className="flex items-center gap-1.5 text-slate-500 shrink-0">
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-wider">
        {label}
      </span>
    </div>
    <span
      className={`text-[12px] text-slate-900 truncate ${
        mono ? "font-mono font-bold tracking-wide" : "font-semibold"
      }`}
    >
      {value}
    </span>
  </div>
);

const Stat = ({ icon, label, value, tone = "slate" }) => {
  const toneClass =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "indigo"
        ? "bg-indigo-50 text-indigo-700"
        : tone === "amber"
          ? "bg-amber-50 text-amber-800"
          : "bg-slate-100 text-slate-700";
  return (
    <div className={`rounded-md px-1.5 py-1 ${toneClass}`}>
      <div className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider opacity-70">
        {icon}
        {label}
      </div>
      <div className="text-[13px] font-bold leading-tight">{value}</div>
    </div>
  );
};

export default GenealogyTreeCanvas;

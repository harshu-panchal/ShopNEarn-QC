import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Minus, RotateCcw, Move, User, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";

/**
 * Customer-MLM-rebuild Phase 8 — Tree View page.
 *
 * Pan/zoom/drag binary tree canvas. The plan calls for "drag and
 * drop" but the locked-in clarification is cosmetic only: pan +
 * zoom + per-node drag whose positions are persisted server-side.
 * The binary parent/child structure NEVER changes from the customer
 * side — this is a visualisation toy, not an editor.
 *
 * Implementation deliberately avoids any third-party graph lib so we
 * don't have to install / pin a React 19 compatible release. The
 * pan/zoom is implemented with native event listeners + a CSS
 * `transform: translate(...) scale(...)` on a positioned container.
 *
 * Drag model (must be bulletproof — earlier per-node setState-on-move
 * caused every pointermove to re-render the entire stage, which
 * fought with the captured-pointer model and made the other cards
 * flicker / disappear during drag):
 *
 *   1. `startNodeDrag` records the dragged card's id + start coords
 *      in a ref and attaches `pointermove` / `pointerup` listeners
 *      directly on `window`. No React state changes.
 *   2. On each pointermove we mutate ONLY the dragged card's inline
 *      style (left/top) imperatively via a ref-lookup map. No
 *      React re-render fires while the user is dragging, so the
 *      other cards / edges keep their initial DOM intact.
 *   3. On pointerup we commit the final position into
 *      `layoutOverrides` once. THAT re-render is the only one — and
 *      by then the drag is over so capture isn't at risk.
 *
 * Pan + zoom keep their setState model because they intentionally
 * need to move the whole stage on every event.
 */
const NODE_WIDTH = 200;
const NODE_HEIGHT = 92;
const HORIZONTAL_GAP = 32;
const VERTICAL_GAP = 110;

const STATUS_LABEL = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700" },
  registered_unpaid: {
    label: "Unpaid",
    className: "bg-amber-100 text-amber-700",
  },
  suspended: { label: "Suspended", className: "bg-rose-100 text-rose-700" },
  terminated: { label: "Terminated", className: "bg-slate-200 text-slate-700" },
};

const TreeViewPage = () => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const saveTimerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [treePayload, setTreePayload] = useState(null);
  const [layoutOverrides, setLayoutOverrides] = useState({});
  const [depth, setDepth] = useState(4);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.85);

  // ----- Fetch tree + saved layout -----
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const [treeRes, layoutRes] = await Promise.all([
          mlmApi.getGenealogyTree({ depth }),
          mlmApi.getTreeLayout(),
        ]);
        if (!mounted) return;
        const t = treeRes.data?.result ?? treeRes.data?.data ?? treeRes.data;
        const l = layoutRes.data?.result ?? layoutRes.data?.data ?? layoutRes.data;
        setTreePayload(t);
        setLayoutOverrides(l?.overrides || {});
      } catch (err) {
        toast.error(
          err?.response?.data?.message || "Failed to load tree",
        );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [depth]);

  // ----- Compute default tidy layout (recursive divide-and-conquer) -----
  const { nodes, edges, treeWidth, treeHeight } = useMemo(() => {
    if (!treePayload?.tree) {
      return { nodes: [], edges: [], treeWidth: 0, treeHeight: 0 };
    }
    const nodeList = [];
    const edgeList = [];

    // Resolve a stable, unique string id for a tree node. The backend
    // populates `userId` as a User object (`{ _id, name, phone, email }`)
    // because the controller calls `.populate("userId", "name phone …")`.
    // Naively stringifying that object yields "[object Object]" — which
    // would collide for EVERY node, breaking React's `key` reconciliation
    // (other cards vanish on the next render) and breaking the edge
    // lookup (every edge resolves to the same node, so the curve
    // degenerates to zero length and never paints). Prefer the user's
    // `_id` hex string, then the membership `_id`, before falling back.
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
    measure(treePayload.tree);

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
    place(treePayload.tree, 0, 0);

    const maxX = nodeList.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH), 0);
    const maxY = nodeList.reduce((m, n) => Math.max(m, n.y + NODE_HEIGHT), 0);
    return {
      nodes: nodeList,
      edges: edgeList,
      treeWidth: maxX + 40,
      treeHeight: maxY + 40,
    };
  }, [treePayload]);

  // Apply user overrides on top of the default tidy layout.
  const positionedNodes = useMemo(() => {
    return nodes.map((n) => {
      const override = layoutOverrides[n.id];
      if (override && Number.isFinite(override.x) && Number.isFinite(override.y)) {
        return { ...n, x: override.x, y: override.y };
      }
      return n;
    });
  }, [nodes, layoutOverrides]);

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
    if (!e.ctrlKey && !e.metaKey) {
      // Only zoom when modifier held — otherwise lets the page scroll.
      return;
    }
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

  useEffect(() => {
    if (!loading && treeWidth > 0) {
      fitToCenter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, treeWidth]);

  // ----- Node drag (imperative — see top-of-file design notes) -----
  //
  // `nodeElementsRef.current` is a map of `nodeId -> HTMLDivElement`
  // populated by each NodeCard via a ref callback below. The drag
  // code looks up the dragged card in O(1) and mutates its inline
  // `style.left` / `style.top` directly so React never re-renders
  // during the drag.
  const nodeElementsRef = useRef(new Map());
  const registerNodeEl = useCallback((id, el) => {
    if (el) {
      nodeElementsRef.current.set(id, el);
    } else {
      nodeElementsRef.current.delete(id);
    }
  }, []);

  // Latest zoom is captured in a ref so the window-level move
  // listener installed by `startNodeDrag` always reads the current
  // value without having to be re-attached when the toolbar buttons
  // change zoom mid-session.
  const zoomRef = useRef(zoom);
  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const dragStateRef = useRef(null);
  const moveHandlerRef = useRef(null);
  const endHandlerRef = useRef(null);

  // Tear-down for any active drag — used both by the normal pointerup
  // path and by the cleanup `useEffect` so a hot-reload / unmount
  // never leaves orphaned window listeners behind.
  const teardownActiveDrag = useCallback(() => {
    if (moveHandlerRef.current) {
      window.removeEventListener("pointermove", moveHandlerRef.current);
      moveHandlerRef.current = null;
    }
    if (endHandlerRef.current) {
      window.removeEventListener("pointerup", endHandlerRef.current);
      window.removeEventListener("pointercancel", endHandlerRef.current);
      endHandlerRef.current = null;
    }
  }, []);

  useEffect(() => teardownActiveDrag, [teardownActiveDrag]);

  const startNodeDrag = useCallback((e, node) => {
    // Left button only; node drag must NEVER trigger the canvas pan
    // handler — stopPropagation prevents React from bubbling the
    // pointerdown up to the pan listener on the canvas div.
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const startEl = nodeElementsRef.current.get(node.id);
    dragStateRef.current = {
      id: node.id,
      el: startEl || null,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: node.x,
      originY: node.y,
      currentX: node.x,
      currentY: node.y,
      moved: false,
    };

    const onMove = (ev) => {
      const s = dragStateRef.current;
      if (!s) return;
      const z = zoomRef.current || 1;
      const dx = (ev.clientX - s.startClientX) / z;
      const dy = (ev.clientY - s.startClientY) / z;
      const nx = s.originX + dx;
      const ny = s.originY + dy;
      s.currentX = nx;
      s.currentY = ny;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) s.moved = true;
      // Imperative DOM mutation — no React re-render, so other
      // cards / edges stay rock-solid on screen.
      const el = s.el || nodeElementsRef.current.get(s.id);
      if (el) {
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        el.style.zIndex = "20";
      }
    };

    const onEnd = () => {
      const s = dragStateRef.current;
      teardownActiveDrag();
      dragStateRef.current = null;
      if (!s) return;
      const el = s.el || nodeElementsRef.current.get(s.id);
      if (el) el.style.zIndex = "";
      // Skip the commit (and the PUT) if the user merely clicked
      // without actually moving the cursor — that's an accidental
      // no-op, no need to dirty the layout overrides.
      if (!s.moved) return;
      setLayoutOverrides((prev) => {
        const next = {
          ...prev,
          [s.id]: { x: s.currentX, y: s.currentY },
        };
        // Persist (debounced) once the React state catches up.
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(async () => {
          try {
            await mlmApi.saveTreeLayout(next);
          } catch (err) {
            console.warn("Save tree layout failed", err.message);
          }
        }, 600);
        return next;
      });
    };

    moveHandlerRef.current = onMove;
    endHandlerRef.current = onEnd;
    // `passive: false` lets the move handler call preventDefault if
    // we ever need to suppress native scrolling on touch devices.
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }, [teardownActiveDrag]);

  const resetLayout = async () => {
    setLayoutOverrides({});
    try {
      await mlmApi.saveTreeLayout({});
      toast.success("Layout reset to default");
    } catch {
      /* ignore */
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        <p className="text-sm text-slate-500">Loading your tree…</p>
      </div>
    );
  }

  if (!treePayload?.isMember) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <Sparkles className="w-10 h-10 mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">
          Your tree appears once you become a member. Activate your account to
          see your network.
        </p>
      </div>
    );
  }

  if (!treePayload?.tree) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
        <p className="text-sm text-slate-500">
          Your network is empty — share your referral code to start building
          your team.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      {/* Toolbar — wraps to a second row on narrow viewports so the
          zoom controls never spill out of the card. */}
      <div className="flex items-center justify-between flex-wrap gap-2 p-3 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Depth
          </label>
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="text-xs font-bold border border-slate-200 rounded-md px-2 py-1 bg-white"
          >
            {[2, 3, 4, 5, 6].map((d) => (
              <option key={d} value={d}>
                {d} levels
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))}
            className="w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600"
            aria-label="Zoom out"
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
          >
            <Plus size={14} />
          </button>
          <button
            onClick={fitToCenter}
            className="w-8 h-8 rounded-md border border-slate-200 bg-white hover:bg-slate-100 flex items-center justify-center text-slate-600 ml-1"
            aria-label="Center tree"
          >
            <Move size={14} />
          </button>
          <button
            onClick={resetLayout}
            className="ml-1 px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600 flex items-center gap-1"
          >
            <RotateCcw size={12} /> Reset
          </button>
        </div>
      </div>

      {/* Canvas — height grows with viewport so PC users get a
          proper canvas, mobile users a compact swipe area. */}
      <div
        ref={containerRef}
        className="relative w-full h-[460px] sm:h-[560px] lg:h-[640px] bg-[radial-gradient(circle_at_1px_1px,_#e2e8f0_1px,_transparent_0)] [background-size:16px_16px] cursor-grab active:cursor-grabbing select-none overflow-hidden touch-pan-y"
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
          {/* Edges (SVG) */}
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
                <path
                  key={`${edge.fromId}-${edge.toId}`}
                  d={`M ${x1},${y1} C ${x1},${midY} ${x2},${midY} ${x2},${y2}`}
                  stroke={edge.side === "L" ? "#6366f1" : "#10b981"}
                  strokeWidth={1.5}
                  fill="none"
                />
              );
            })}
          </svg>

          {/* Node cards. Pointer move/up listeners live on `window`
              (set up in startNodeDrag) so we don't need to attach
              them per-card — that's what keeps the other cards
              fully visible during a drag. */}
          {positionedNodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              registerEl={registerNodeEl}
              onPointerDown={(e) => startNodeDrag(e, n)}
            />
          ))}
        </div>
      </div>

      <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 leading-relaxed">
        <span className="hidden sm:inline">
          Drag a card to reposition it • Drag the background to pan • Hold
          ⌘/Ctrl + scroll to zoom • Your layout is saved automatically.
        </span>
        <span className="sm:hidden">
          Tap-drag a card to move it • Drag background to pan • Use the
          buttons to zoom • Layout saves automatically.
        </span>
      </div>
    </div>
  );
};

const NodeCard = ({ node, onPointerDown, registerEl }) => {
  const data = node.data || {};
  const statusInfo = STATUS_LABEL[data.status] || {
    label: data.status,
    className: "bg-slate-100 text-slate-700",
  };
  // Always render — but show "YOU" pill for the root (depth=0).
  const isRoot = data.position === null;

  // Hand the DOM element back up to TreeViewPage so the imperative
  // drag code can mutate this card's left/top during a drag without
  // triggering a React re-render.
  const elRef = useCallback(
    (el) => {
      registerEl(node.id, el);
    },
    [node.id, registerEl],
  );

  return (
    <div
      ref={elRef}
      onPointerDown={onPointerDown}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      className={`bg-white border-2 rounded-xl shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing p-2.5 ${
        isRoot
          ? "border-indigo-400 bg-indigo-50"
          : data.status === "registered_unpaid"
            ? "border-amber-300"
            : "border-slate-200"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0">
          <User size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-xs font-bold text-slate-900 truncate">
              {data.name || "Member"}
            </p>
            {isRoot && (
              <span className="bg-indigo-600 text-white text-[8px] font-bold uppercase tracking-widest px-1.5 rounded">
                You
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 truncate">
            {data.referralCode || "—"}
          </p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-1.5">
        <span
          className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${statusInfo.className}`}
        >
          {statusInfo.label}
        </span>
        <span className="text-[10px] text-slate-500">
          ↙ {data.leftLegDirectCount || 0} · ↘ {data.rightLegDirectCount || 0}
        </span>
      </div>
    </div>
  );
};

export default TreeViewPage;

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
  UserPlus2,
  X,
  Lock,
  ArrowLeft,
  ArrowRight,
  Mail,
  Phone as PhoneIcon,
  User as UserIcon,
  KeyRound,
  Eye,
  EyeOff,
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
 *   - Hover tooltip with the full member detail card for filled nodes
 *   - Tap-to-recenter callback (parent decides what to fetch)
 *   - Tap-to-add callback for empty slots whose parent is filled
 *   - Depth selector + zoom controls
 *   - Empty / loading / "not a member" states
 *
 * EMPTY-SLOT MODEL (Genealogy redesign):
 *   The canvas synthesises EMPTY placeholder nodes below every
 *   filled leaf so the user can visualise the next two levels of
 *   capacity at all times. Each empty node is one of:
 *     - "addable" (blue, UserPlus icon, hover ring) — its immediate
 *       parent in the tree is a filled member. Clicking it opens
 *       the in-canvas Add Member modal which collects the same
 *       signup payload the public flow uses, locks the referral
 *       code to the parent's code, and pre-selects the leg based
 *       on the slot.
 *     - "placeholder" (grey, UserPlus icon, no interaction) — its
 *       parent is also empty, so adding here is not yet possible.
 *       Visible purely to telegraph "this position exists".
 *   `emptySlotMaxDepth` (default 2) bounds the recursion so the
 *   canvas never explodes into 2^N placeholders for a deep tree;
 *   2 levels matches the visual density of the reference design.
 *
 * Out of scope (left to the parent):
 *   - Data fetching (different APIs for customer vs admin)
 *   - Navigation history / breadcrumb (different UX for each surface)
 *   - The actual add-member POST call (caller owns the API client)
 *
 * Interaction model:
 *   - Per-node drag is intentionally disabled — every node sits at
 *     the position computed by the tidy-tree algorithm so the chart
 *     remains visually consistent for every viewer (no per-user
 *     drift). To move the chart, drag the background to pan or use
 *     the zoom controls.
 *   - Tap detection on a node piggybacks on the browser's synthetic
 *     `click` event so the canvas's `pointerdown -> pan` flow on the
 *     background is unaffected: a true tap (no movement) fires
 *     `onNodeTap` (filled) or opens the add modal (empty addable),
 *     a press-and-drag pans the canvas as usual.
 */

// Node "slot" dimensions. The visual node is a coloured pill holding
// the referral code with the name as plain text below. These numbers
// drive the layout math (sibling spacing, edge endpoints) and the
// inline width/height of each slot's hit area.
//
// Tuned for the leaves-first layout (see the `place()` walker below):
// every leaf is one `SLOT_WIDTH` apart, so a tighter HORIZONTAL_GAP
// directly compresses the whole canvas without changing the visual
// hierarchy.
//
// `NODE_WIDTH` / `NODE_HEIGHT` are visual constants (used by the
// pill cards directly) and stay module-scoped. `HORIZONTAL_GAP` and
// `VERTICAL_GAP` are LAYOUT-ONLY defaults — when the host passes
// `compactSpacing` (admin tree, per PO Jun 2026) we substitute
// tighter values in the layout walker without touching the node
// visuals, which keeps both consumers visually consistent at the
// per-node level while letting the admin view fit more of the tree
// in the same viewport.
const NODE_WIDTH = 104;
const NODE_HEIGHT = 56;
const HORIZONTAL_GAP = 8;
const VERTICAL_GAP = 58;
const COMPACT_HORIZONTAL_GAP = 4;
const COMPACT_VERTICAL_GAP = 28;

/**
 * Resolve the canonical colour theme for a FILLED member node based
 * on the member's MLM status + plan. Single source of truth shared
 * by the in-tree pill (`NodeCard`), the toolbar legend, and the
 * hover tooltip's status badge — so changing a colour in one place
 * automatically updates every surface.
 *
 * Mapping (per PO request):
 *   - REGISTERED_UNPAID            -> red   (joining fee not yet paid)
 *   - ACTIVE + Plan A              -> green (paid, base plan)
 *   - ACTIVE + Plan B              -> blue  (paid, premium plan)
 *   - SUSPENDED / TERMINATED       -> slate (visually de-emphasised)
 *
 * The root node (the viewer or the admin-selected member) follows the
 * same rule — colour reflects the member's actual lifecycle state,
 * not their position in the tree. A `Crown` icon in the tooltip
 * header is the secondary "this is the root" cue.
 */
function nodeAccent(data) {
  const status = data?.status || "";
  const planType = data?.planType || "A";
  if (status === "registered_unpaid") {
    return {
      key: "unpaid",
      label: "Unpaid",
      pill: "bg-red-500 text-white shadow-red-200",
      ring: "ring-red-300",
      tooltipHeader: "bg-linear-to-br from-red-50 to-white",
      tooltipBadge: "bg-red-100 text-red-700",
      tooltipAccent: "text-red-500",
      swatch: "bg-red-500",
      ctaBar: "bg-red-600",
    };
  }
  if (status === "suspended" || status === "terminated") {
    return {
      key: status,
      label: status === "suspended" ? "Suspended" : "Terminated",
      pill: "bg-slate-500 text-white shadow-slate-200",
      ring: "ring-slate-300",
      tooltipHeader: "bg-linear-to-br from-slate-50 to-white",
      tooltipBadge: "bg-slate-200 text-slate-700",
      tooltipAccent: "text-slate-500",
      swatch: "bg-slate-500",
      ctaBar: "bg-slate-600",
    };
  }
  if (planType === "B") {
    return {
      key: "planB",
      label: "Plan B",
      pill: "bg-blue-500 text-white shadow-blue-200",
      ring: "ring-blue-300",
      tooltipHeader: "bg-linear-to-br from-blue-50 to-white",
      tooltipBadge: "bg-blue-100 text-blue-700",
      tooltipAccent: "text-blue-500",
      swatch: "bg-blue-500",
      ctaBar: "bg-blue-600",
    };
  }
  return {
    key: "active",
    label: "Active",
    pill: "bg-emerald-500 text-white shadow-emerald-200",
    ring: "ring-emerald-300",
    tooltipHeader: "bg-linear-to-br from-emerald-50 to-white",
    tooltipBadge: "bg-emerald-100 text-emerald-700",
    tooltipAccent: "text-emerald-500",
    swatch: "bg-emerald-500",
    ctaBar: "bg-emerald-600",
  };
}

/**
 * Resolve a stable, unique string id for ANY node (filled or
 * synthesised empty). Hoisted from the layout closure because both
 * the synthesis step AND the layout step need it.
 *
 * - Filled nodes: prefer `data.userId._id` (populated User object)
 *   so the id is the same identifier the parent surface uses to
 *   navigate sub-trees.
 * - Empty nodes: deterministic synthetic id derived from the parent
 *   id and the leg ("L"/"R") — guarantees React key stability
 *   across re-renders and protects against the [object Object]
 *   collision the legacy code had.
 */
function nodeIdFor(node) {
  if (!node) return "";
  if (node.__empty) return node.__id;
  const u = node.userId;
  if (u && typeof u === "object" && u._id) return String(u._id);
  if (typeof u === "string") return u;
  if (node._id) return String(node._id);
  return "";
}

/**
 * Recursively walk the live tree and fill in EMPTY placeholder
 * children where the backend returned `null`. Stops at
 * `emptySlotMaxDepth` levels below every filled leaf so the canvas
 * never explodes for a deep tree.
 *
 * Mutates a CLONE — never the original payload — because callers
 * may share the tree object across renders / consumers.
 */
function augmentWithEmptySlots(tree, emptySlotMaxDepth) {
  if (!tree) return null;

  function build(node, depthFromLeaf, parentFilledId, side) {
    // Filled node — recurse, then synthesize any missing children.
    if (!node) return null;
    if (node.__empty) return node; // already an empty placeholder

    const cloned = { ...node };
    const ownId = nodeIdFor(node);

    if (cloned.left) {
      cloned.left = build(cloned.left, emptySlotMaxDepth, ownId, "L");
    } else if (emptySlotMaxDepth > 0) {
      cloned.left = synthesiseEmpty({
        parentId: ownId,
        side: "L",
        // The parent is a filled node, so this immediate child is
        // ADDABLE (blue). Children of an addable empty are
        // non-addable placeholders (grey).
        addable: true,
        remainingDepth: emptySlotMaxDepth - 1,
      });
    }
    if (cloned.right) {
      cloned.right = build(cloned.right, emptySlotMaxDepth, ownId, "R");
    } else if (emptySlotMaxDepth > 0) {
      cloned.right = synthesiseEmpty({
        parentId: ownId,
        side: "R",
        addable: true,
        remainingDepth: emptySlotMaxDepth - 1,
      });
    }
    return cloned;
  }

  function synthesiseEmpty({ parentId, side, addable, remainingDepth }) {
    const id = `__empty:${parentId}:${side}`;
    const node = {
      __empty: true,
      __id: id,
      __addable: addable,
      __parentFilledId: addable ? parentId : null,
      __leg: side,
      left: null,
      right: null,
    };
    if (remainingDepth > 0) {
      node.left = synthesiseEmpty({
        parentId: id,
        side: "L",
        addable: false,
        remainingDepth: remainingDepth - 1,
      });
      node.right = synthesiseEmpty({
        parentId: id,
        side: "R",
        addable: false,
        remainingDepth: remainingDepth - 1,
      });
    }
    return node;
  }

  return build(tree, emptySlotMaxDepth, null, null);
}

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
  // Genealogy redesign — when provided, ADDABLE empty slots become
  // clickable and open the Add Member modal. The handler receives
  // `{ parentMembershipId, parentReferralCode, parentName, leg,
  //   form: { name, email, phone, password } }` and must return a
  // promise that resolves when the member has been persisted (the
  // canvas waits for that promise before closing the modal).
  onAddMember = null,
  // How many EMPTY levels to render below every filled leaf. Default
  // 2 matches the reference design (one blue level + one grey
  // placeholder level beneath).
  emptySlotMaxDepth = 2,
  // Per-node accent toggle — set false on admin tree to skip the
  // "(You)" suffix that the customer-side surface uses.
  highlightViewerSelf = true,
  // Layout-only spacing toggle (admin tree, Jun 2026). When true,
  // the leaves-first walker uses `COMPACT_HORIZONTAL_GAP` and
  // `COMPACT_VERTICAL_GAP` in place of the defaults so the canvas
  // fits more nodes in the same viewport. Node pill dimensions are
  // unchanged — only the empty space between cells shrinks.
  compactSpacing = false,
}) => {
  const containerRef = useRef(null);
  const stageRef = useRef(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(0.85);

  // Member-details modal state. `selectedFilledNode` is the node
  // the user most recently CLICKED on (filled members only —
  // empty/addable slots get their own AddMemberModal flow).
  // Cleared on close.
  //
  // Hover-to-show-tooltip was retired here: clicks open a richer
  // centered modal so the interaction is identical on desktop and
  // touch surfaces and so the user can dwell on the details
  // without the popover disappearing the instant their cursor
  // drifts.
  const [selectedFilledNode, setSelectedFilledNode] = useState(null);

  // Add-member modal state. `target` carries the parent context
  // selected when the user taps a blue empty slot. Cleared on
  // close.
  const [addTarget, setAddTarget] = useState(null);
  const [addBusy, setAddBusy] = useState(false);

  // ----- Augment the tree with empty placeholder nodes -----
  const augmentedTree = useMemo(
    () => augmentWithEmptySlots(tree, Math.max(0, Number(emptySlotMaxDepth) || 0)),
    [tree, emptySlotMaxDepth],
  );

  // ----- Compute layout: leaves-first / post-order -----
  //
  // The old algorithm allocated horizontal space proportional to each
  // subtree's leaf count, so a heavy right chain (common in this
  // product's binary trees) would balloon and push every ancestor
  // off-center — the visible effect was a diagonal cascade with huge
  // empty bands on the light side.
  //
  // The leaves-first walker fixes that by giving every leaf an equal
  // `SLOT_WIDTH` slot and positioning every parent EXACTLY at the
  // midpoint of its two children. Consequences:
  //   - All siblings at the same level are equispaced (matches the
  //     "align the space equally" requirement from the redesign).
  //   - Every parent sits perfectly centered above its children, so
  //     L and R subtree distances are mirror images regardless of how
  //     much deeper the heavy side runs.
  //   - The deeper a chain extends, the smaller each step's offset
  //     becomes (because the subtree's leaf range shrinks), so the
  //     residual diagonal flattens out rather than compounding.
  //
  // Complexity stays O(n); the only state shared across the
  // recursion is a single leaf-index counter.
  const { nodes, edges, treeWidth, treeHeight, filledById } = useMemo(() => {
    if (!augmentedTree) {
      return {
        nodes: [],
        edges: [],
        treeWidth: 0,
        treeHeight: 0,
        filledById: new Map(),
      };
    }
    const nodeList = [];
    const edgeList = [];
    const filledMap = new Map();

    // Effective layout spacing — admin-only tightening toggled by
    // the `compactSpacing` prop. Node-visual constants (NODE_WIDTH,
    // NODE_HEIGHT) are NOT scaled here; only the empty space
    // between cells changes, which keeps the pill cards visually
    // identical between customer and admin surfaces.
    const horizontalGap = compactSpacing
      ? COMPACT_HORIZONTAL_GAP
      : HORIZONTAL_GAP;
    const verticalGap = compactSpacing ? COMPACT_VERTICAL_GAP : VERTICAL_GAP;
    const slotWidth = NODE_WIDTH + horizontalGap;

    let leafIndex = 0;

    /**
     * Post-order walker. Returns the `centerX` of the placed node so
     * the caller (the parent in the recursion) can compute its own
     * midpoint. Pushes the placed node into `nodeList` and any
     * outgoing edges into `edgeList` as a side-effect.
     */
    function place(node, depthLevel) {
      if (!node) return null;
      const y = depthLevel * (NODE_HEIGHT + verticalGap);
      const id = nodeIdFor(node);

      const leftCenter = node.left ? place(node.left, depthLevel + 1) : null;
      const rightCenter = node.right ? place(node.right, depthLevel + 1) : null;

      let centerX;
      if (leftCenter === null && rightCenter === null) {
        // Leaf — take the next equispaced slot.
        centerX = leafIndex * slotWidth + NODE_WIDTH / 2;
        leafIndex += 1;
      } else if (leftCenter !== null && rightCenter !== null) {
        centerX = (leftCenter + rightCenter) / 2;
      } else if (leftCenter !== null) {
        // Only-left-child fallback. Real trees never hit this because
        // `augmentWithEmptySlots` always synthesises both children
        // for any filled leaf when `emptySlotMaxDepth > 0`, but the
        // branch keeps the algorithm robust to a depth-0 caller.
        centerX = leftCenter;
      } else {
        centerX = rightCenter;
      }

      nodeList.push({
        id,
        x: centerX - NODE_WIDTH / 2,
        y,
        data: node,
      });
      if (!node.__empty) {
        filledMap.set(id, node);
      }

      if (node.left) {
        edgeList.push({
          fromId: id,
          toId: nodeIdFor(node.left),
          side: "L",
          targetEmpty: !!node.left.__empty,
          targetAddable: !!node.left.__addable,
        });
      }
      if (node.right) {
        edgeList.push({
          fromId: id,
          toId: nodeIdFor(node.right),
          side: "R",
          targetEmpty: !!node.right.__empty,
          targetAddable: !!node.right.__addable,
        });
      }

      return centerX;
    }
    place(augmentedTree, 0);

    const maxX = nodeList.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH), 0);
    const maxY = nodeList.reduce((m, n) => Math.max(m, n.y + NODE_HEIGHT), 0);
    return {
      nodes: nodeList,
      edges: edgeList,
      treeWidth: maxX + 40,
      treeHeight: maxY + 40,
      filledById: filledMap,
    };
  }, [augmentedTree, compactSpacing]);

  const positionedNodes = nodes;

  // ----- Pan (drag on background) -----
  const PAN_THRESHOLD_PX = 5;
  const panState = useRef({
    pending: false,
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });
  const onPanStart = useCallback(
    (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      panState.current = {
        pending: true,
        active: false,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
    },
    [pan],
  );
  const onPanMove = useCallback((e) => {
    const s = panState.current;
    if (!s.pending && !s.active) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.active) {
      if (Math.hypot(dx, dy) < PAN_THRESHOLD_PX) return;
      s.active = true;
      s.pending = false;
      e.currentTarget.setPointerCapture?.(s.pointerId);
    }
    setPan({ x: s.panX + dx, y: s.panY + dy });
  }, []);
  const onPanEnd = useCallback((e) => {
    const s = panState.current;
    if (s.active) {
      e.currentTarget?.releasePointerCapture?.(s.pointerId);
    }
    panState.current = {
      pending: false,
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      panX: 0,
      panY: 0,
    };
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

  useEffect(() => {
    if (!loading && treeWidth > 0) {
      fitToCenter();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, treeWidth, tree]);

  // Filled-node tap — opens the member detail modal. The actual
  // "drill into this member's downline" action lives behind the
  // "Show Genealogy" button INSIDE the modal so the user can
  // inspect details before navigating away from the current root.
  // The parent's `onNodeTap` is therefore no longer called on raw
  // click; it fires only from `handleShowGenealogy` below.
  const handleNodeClick = useCallback((node) => {
    if (!node?.data || node.data.__empty) return;
    setSelectedFilledNode(node);
  }, []);

  const handleCloseDetailModal = useCallback(() => {
    setSelectedFilledNode(null);
  }, []);

  const handleShowGenealogy = useCallback(() => {
    if (!selectedFilledNode) return;
    setSelectedFilledNode(null);
    onNodeTap?.(selectedFilledNode);
  }, [selectedFilledNode, onNodeTap]);

  // Empty-slot tap (only fires for ADDABLE empties).
  const handleEmptyClick = useCallback(
    (emptyNode) => {
      if (!onAddMember) return;
      if (!emptyNode?.data?.__addable) return;
      const parentId = emptyNode.data.__parentFilledId;
      const parent = filledById.get(parentId);
      if (!parent) return;
      // Inspect the sibling slot under the parent so the modal's
      // leg toggle can disable the leg that's already occupied.
      const sibling = emptyNode.data.__leg === "L" ? parent.right : parent.left;
      const siblingIsFilled = sibling && !sibling.__empty;
      const parentUser = parent.userId;
      setAddTarget({
        parentMembershipId: String(parent._id),
        parentReferralCode: parent.referralCode,
        parentName:
          (typeof parentUser === "object" && parentUser?.name) ||
          parent.name ||
          "Member",
        parentPublicUserId:
          (typeof parentUser === "object" && parentUser?.userId) ||
          parent.publicUserId ||
          null,
        leg: emptyNode.data.__leg,
        // Cheap predicate the modal uses to lock the leg picker
        // when the OTHER leg is already taken by a real member.
        siblingFilled: !!siblingIsFilled,
      });
    },
    [onAddMember, filledById],
  );

  const handleAddSubmit = useCallback(
    async (formValues) => {
      if (!addTarget || !onAddMember) return;
      setAddBusy(true);
      try {
        await onAddMember({
          parentMembershipId: addTarget.parentMembershipId,
          parentReferralCode: addTarget.parentReferralCode,
          parentName: addTarget.parentName,
          leg: formValues.leg,
          form: {
            name: formValues.name,
            email: formValues.email,
            phone: formValues.phone,
            password: formValues.password,
          },
        });
        setAddTarget(null);
      } finally {
        setAddBusy(false);
      }
    },
    [addTarget, onAddMember],
  );

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
                {[3, 5, 7, 10, 15, 0].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "All levels" : `${d} levels`}
                  </option>
                ))}
              </select>
            </>
          )}
          {breadcrumb}
          {/* Legend — colour key for the in-tree pills and the
              add/future placeholders. Compressed onto one line on
              md+; hidden on small screens to keep the toolbar from
              wrapping. Order mirrors the lifecycle of a member:
              active -> plan B upgrade -> unpaid (regressed) -> open
              slot -> future slot. */}
          <div className="hidden lg:flex items-center gap-2 text-[10px] text-slate-500 ml-2 flex-wrap">
            <LegendSwatch tone="bg-emerald-500" label="Paid (Plan A)" />
            <LegendSwatch tone="bg-blue-500" label="Plan B" />
            <LegendSwatch tone="bg-red-500" label="Unpaid" />
            {onAddMember && (
              <>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-sky-500 inline-block"></span>
                  Open slot
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-slate-300 inline-block"></span>
                  Future
                </span>
              </>
            )}
          </div>
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
              const isEmptyEdge = edge.targetEmpty;
              const strokeColor = isEmptyEdge
                ? edge.targetAddable
                  ? "#cbd5e1"
                  : "#e2e8f0"
                : "#94a3b8";
              return (
                <g key={`${edge.fromId}-${edge.toId}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x1}
                    y2={midY}
                    stroke={strokeColor}
                    strokeWidth={1}
                  />
                  <line
                    x1={x1}
                    y1={midY}
                    x2={x2}
                    y2={midY}
                    stroke={strokeColor}
                    strokeWidth={1}
                    strokeDasharray="4 3"
                  />
                  <line
                    x1={x2}
                    y1={midY}
                    x2={x2}
                    y2={y2}
                    stroke={strokeColor}
                    strokeWidth={1}
                  />
                </g>
              );
            })}
          </svg>

          {positionedNodes.map((n) =>
            n.data.__empty ? (
              <EmptyNodeCard
                key={n.id}
                node={n}
                canAdd={!!onAddMember && n.data.__addable}
                onClick={handleEmptyClick}
              />
            ) : (
              <NodeCard
                key={n.id}
                node={n}
                onTap={handleNodeClick}
                isSelected={selectedFilledNode?.id === n.id}
                highlightViewerSelf={highlightViewerSelf}
              />
            ),
          )}
        </div>
      </div>

      {footerHint !== null && (
        <div className="px-3 py-2 border-t border-slate-200 bg-slate-50 text-[10px] text-slate-500 leading-relaxed">
          {footerHint || (
            <>
              <span className="hidden sm:inline">
                Click a member to open their details — use the “Show Genealogy”
                button inside to view their downline • Tap a{" "}
                <span className="text-sky-600 font-bold">blue</span> open slot to
                add a new member • Drag the background to pan • Hold ⌘/Ctrl +
                scroll to zoom.
              </span>
              <span className="sm:hidden">
                Tap a member to see details · Show Genealogy in the popup to
                drill in · Tap blue slots to add a member · Drag to pan · Pinch
                to zoom.
              </span>
            </>
          )}
        </div>
      )}

      {addTarget && (
        <AddMemberModal
          target={addTarget}
          busy={addBusy}
          onClose={() => (addBusy ? null : setAddTarget(null))}
          onSubmit={handleAddSubmit}
        />
      )}

      {selectedFilledNode && (
        <MemberDetailModal
          node={selectedFilledNode}
          onClose={handleCloseDetailModal}
          onShowGenealogy={handleShowGenealogy}
        />
      )}
    </div>
  );
};

/**
 * NodeCard — pill + label for a FILLED member.
 *
 * Visually matches the reference design: status/plan-tinted pill
 * (see `nodeAccent`) holding the referral code with the member's
 * name beneath. The pill grows a subtle ring while the
 * member-detail modal for that node is open (`isSelected`).
 *
 * Hover-driven tooltips were retired; clicks now open
 * `MemberDetailModal` which is the single source of details +
 * "Show Genealogy" navigation.
 */
const NodeCard = ({ node, onTap, isSelected, highlightViewerSelf }) => {
  const data = node.data || {};
  const isRoot = data.position === null || data.position === undefined;

  // Colour is driven entirely by the member's status + plan (see
  // `nodeAccent` for the canonical mapping). The root gets the same
  // accent as any other member; the Crown icon in the detail modal
  // header is the secondary cue that distinguishes it.
  const accent = nodeAccent(data);
  const pillClass = accent.pill;

  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      onTap?.(node);
    },
    [node, onTap],
  );

  return (
    <div
      onClick={handleClick}
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
        className={`px-3 py-1.5 rounded-md text-[12px] font-mono font-bold tracking-wider shadow-md whitespace-nowrap transition-transform ${pillClass} ${
          isSelected ? `ring-2 ring-offset-1 ${accent.ring} scale-[1.05]` : ""
        }`}
      >
        {data.referralCode || "—"}
      </span>
      <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700 truncate max-w-full text-center">
        {data.name || "Member"}
        {isRoot && highlightViewerSelf && data.__isViewerSelf && (
          <span className={`ml-1 normal-case font-bold ${accent.tooltipAccent}`}>
            (You)
          </span>
        )}
      </span>
    </div>
  );
};

/**
 * EmptyNodeCard — placeholder for an unfilled binary slot.
 *
 * Two visual variants:
 *   - `canAdd === true`  →  sky-blue UserPlus icon with hover ring,
 *     clickable, opens the Add Member modal via the parent canvas.
 *   - `canAdd === false` →  light grey UserPlus icon, no interaction,
 *     visible purely to signal "this position exists below an empty
 *     parent — fill the parent first" (user-clarified "unassigned
 *     places in grey, which can be assigned in future").
 *
 * The empty card centers itself horizontally within the `NODE_WIDTH`
 * slot so the icon sits exactly under the connecting edge from the
 * parent, regardless of how much horizontal padding the slot has.
 */
const EmptyNodeCard = ({ node, canAdd, onClick }) => {
  const handleClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (!canAdd) return;
      onClick?.(node);
    },
    [node, canAdd, onClick],
  );

  const wrapperClass = canAdd
    ? "cursor-pointer group"
    : "cursor-default";

  const iconColor = canAdd ? "text-sky-500" : "text-slate-300";
  const ringClass = canAdd
    ? "border-2 border-dashed border-sky-300 group-hover:border-sky-500 group-hover:bg-sky-50/60"
    : "border-2 border-dashed border-slate-200 bg-slate-50/40";

  return (
    <div
      onClick={handleClick}
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      }}
      className={`flex flex-col items-center justify-start select-none ${wrapperClass}`}
      title={canAdd ? "Add a new member to this slot" : "Future slot — fill the parent first"}
    >
      <div
        className={`w-9 h-9 rounded-full bg-white flex items-center justify-center transition-colors ${ringClass}`}
      >
        <UserPlus2 size={16} className={iconColor} />
      </div>
      <span
        className={`mt-1 text-[9px] font-bold uppercase tracking-wider text-center ${
          canAdd ? "text-sky-600" : "text-slate-300"
        }`}
      >
        {canAdd ? "Open Slot" : "Future"}
      </span>
    </div>
  );
};

/**
 * AddMemberModal — collects the same signup payload the public flow
 * uses, locks the referral code to the parent's code, and pre-
 * selects the leg based on the empty slot the user tapped. The leg
 * toggle stays editable when the OTHER leg under the same parent
 * is also empty; otherwise the alternate leg is disabled.
 */
const AddMemberModal = ({ target, busy, onClose, onSubmit }) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [leg, setLeg] = useState(target.leg || "L");
  const [error, setError] = useState("");

  // The OTHER leg under the parent (the one the user did NOT tap)
  // is locked out only when it's already occupied by a real
  // member. In that case `target.leg` (the slot the user tapped)
  // is the only valid choice and the alternate button stays
  // disabled. When both legs are empty, both buttons are live and
  // the user can switch freely.
  const leftDisabled = busy || (target.siblingFilled && target.leg === "R");
  const rightDisabled = busy || (target.siblingFilled && target.leg === "L");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();
    if (trimmedName.length < 2) {
      setError("Please enter a full name (2+ characters).");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (trimmedPhone.length !== 10 || !/^\d{10}$/.test(trimmedPhone)) {
      setError("Please enter a 10-digit mobile number.");
      return;
    }
    if (!password) {
      setError("Please choose a password.");
      return;
    }
    if (!["L", "R"].includes(leg)) {
      setError("Please choose a leg.");
      return;
    }

    try {
      await onSubmit({ name: trimmedName, email: trimmedEmail, phone: trimmedPhone, password, leg });
    } catch (submissionError) {
      setError(submissionError?.message || "Failed to add member");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">Add Member to Slot</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Placing under{" "}
              <span className="font-bold text-slate-800">{target.parentName}</span>
              {target.parentPublicUserId ? (
                <>
                  {" · "}
                  <span className="font-mono font-bold text-slate-700">{target.parentPublicUserId}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-8 h-8 rounded-full hover:bg-slate-100 disabled:opacity-50 flex items-center justify-center text-slate-400"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3.5">
          <Field
            icon={<UserIcon size={16} />}
            placeholder="Full Name"
            value={name}
            onChange={setName}
            autoComplete="name"
            disabled={busy}
          />
          <Field
            icon={<Mail size={16} />}
            placeholder="Email Address"
            type="email"
            value={email}
            onChange={(v) => setEmail(v.toLowerCase())}
            autoComplete="email"
            disabled={busy}
          />
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <PhoneIcon size={16} />
            </span>
            <span className="absolute left-10 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 border-r border-slate-200 pr-2">
              +91
            </span>
            <input
              type="tel"
              maxLength={10}
              placeholder="10-digit Mobile Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              disabled={busy}
              className="w-full pl-20 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:border-rose-400 focus:bg-white transition-colors disabled:opacity-60"
              autoComplete="tel"
            />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <KeyRound size={16} />
            </span>
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Set a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:border-rose-400 focus:bg-white transition-colors disabled:opacity-60"
              autoComplete="new-password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <Lock size={16} />
            </span>
            <input
              type="text"
              value={target.parentReferralCode || ""}
              readOnly
              className="w-full pl-10 pr-3 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm font-mono font-bold tracking-wide text-slate-600 outline-none cursor-not-allowed"
              title="Referral code is locked to the parent member's code"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-bold uppercase tracking-wider text-slate-400">
              Locked
            </span>
          </div>

          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Leg Position
            </p>
            <div className="grid grid-cols-2 gap-2">
              <LegToggle
                active={leg === "L"}
                disabled={leftDisabled}
                onClick={() => setLeg("L")}
                icon={<ArrowLeft size={16} />}
                label="Left"
              />
              <LegToggle
                active={leg === "R"}
                disabled={rightDisabled}
                onClick={() => setLeg("R")}
                icon={<ArrowRight size={16} />}
                label="Right"
              />
            </div>
            {target.siblingFilled && (
              <p className="mt-1.5 text-[10px] text-amber-700">
                The {target.leg === "L" ? "right" : "left"} slot is already taken
                by another member.
              </p>
            )}
          </div>

          {error && (
            <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-[1.5] px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 inline-flex items-center justify-center gap-1.5"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <UserPlus2 size={14} />
                  Create Member
                </>
              )}
            </button>
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed">
            Login credentials and the referral code will be emailed to the new
            member automatically. They can sign in immediately — no OTP
            verification is required.
          </p>
        </form>
      </div>
    </div>
  );
};

const Field = ({
  icon,
  placeholder,
  value,
  onChange,
  type = "text",
  autoComplete,
  disabled,
}) => (
  <div className="relative">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
      {icon}
    </span>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      disabled={disabled}
      className="w-full pl-10 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:border-rose-400 focus:bg-white transition-colors disabled:opacity-60"
    />
  </div>
);

const LegendSwatch = ({ tone, label }) => (
  <span className="inline-flex items-center gap-1">
    <span className={`w-2.5 h-2.5 rounded-sm inline-block ${tone}`}></span>
    {label}
  </span>
);

const LegToggle = ({ active, disabled, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border-2 text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active
        ? "bg-rose-50 border-rose-400 text-rose-700"
        : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
    }`}
  >
    {icon}
    {label}
  </button>
);

/**
 * MemberDetailModal — centered modal that opens when the user
 * clicks a FILLED member node on the canvas.
 *
 * Replaces the previous hover-driven floating tooltip:
 *   - Identical detail surface (status pill, plan, joined date,
 *     downline/earning stats, leg counters, pair count).
 *   - Adds a primary "Show Genealogy" CTA so the user can pivot
 *     the canvas to render the selected member as the new root.
 *   - For the CURRENT root, the CTA is suppressed (you can't
 *     "show genealogy of who you're already viewing") and we
 *     surface a small "Current root" pill instead so the user
 *     knows why no action button is present.
 *
 * Layout / interaction parity with `AddMemberModal`:
 *   - `z-50` backdrop, click-outside to close, X button.
 *   - Modal sits in the global fixed-position layer so canvas
 *     pan/zoom never moves it around.
 *
 * Pure presentational — receives a `node` (the canvas tree node
 * struct: `{ id, x, y, data: <membership-with-populated-user> }`)
 * plus close + show-genealogy callbacks from the canvas.
 */
const MemberDetailModal = ({ node, onClose, onShowGenealogy }) => {
  const data = node?.data || {};
  const u = data.userId;
  const publicUserId =
    (typeof u === "object" && u?.userId) || data.publicUserId || null;
  const name = (typeof u === "object" && u?.name) || data.name || "Member";
  const phone = data.phone || (typeof u === "object" ? u?.phone : null) || null;
  const email = (typeof u === "object" && u?.email) || data.email || null;
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
  const accent = nodeAccent(data);

  const statusLabel =
    status === "registered_unpaid"
      ? "Registered (unpaid)"
      : status === "active"
        ? data.planType === "B"
          ? "Active · Plan B"
          : "Active · Plan A"
        : status
          ? status.replace(/_/g, " ")
          : "Unknown";
  const statusClass = accent.tooltipBadge;

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — name, root indicator, status pill, close X. */}
        <div
          className={`px-4 py-3 ${accent.tooltipHeader} border-b border-slate-100`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p
                className={`text-[10px] font-bold uppercase tracking-wider ${accent.tooltipAccent}`}
              >
                Member
              </p>
              <p className="mt-0.5 text-base font-bold text-slate-900 truncate">
                {name}
                {isRoot && (
                  <Crown
                    size={14}
                    className={`inline ml-1.5 ${accent.tooltipAccent}`}
                  />
                )}
              </p>
              <span
                className={`mt-1 inline-block px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${statusClass}`}
              >
                {statusLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full hover:bg-white/60 flex items-center justify-center text-slate-500"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Identity block. */}
        <div className="px-4 py-3 space-y-1.5 text-[12px]">
          {publicUserId && (
            <TooltipRow
              icon={<BadgeCheck size={13} className={accent.tooltipAccent} />}
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
            icon={<Sparkles size={13} className={accent.tooltipAccent} />}
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
              icon={<PhoneIcon size={13} className="text-slate-400" />}
              label="Phone"
              value={phone}
            />
          )}
          {email && (
            <TooltipRow
              icon={<Mail size={13} className="text-slate-400" />}
              label="Email"
              value={email}
            />
          )}
        </div>

        {/* Leg stats. */}
        <div className="px-4 py-3 border-t border-slate-100 grid grid-cols-3 gap-1.5">
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

        {/* Network summary. */}
        <div className="px-4 py-2.5 border-t border-slate-100 flex items-center justify-between gap-2 bg-slate-50">
          <div className="flex items-center gap-1 text-[11px] text-slate-600">
            <Users size={11} />
            <span className="font-bold">{totalDownline}</span>
            <span>downline</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-700 font-bold">
            <TrendingUp size={11} className="text-emerald-500" />
            {fmtMoney(lifetime)}
          </div>
        </div>

        {/* Actions — primary "Show Genealogy" CTA opens this
            member's downline on the same canvas. Hidden when the
            user is already viewing this member (root) because
            re-rooting onto yourself is a no-op. */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
          {!isRoot ? (
            <button
              type="button"
              onClick={onShowGenealogy}
              className={`flex-[1.5] px-3 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white hover:opacity-90 inline-flex items-center justify-center gap-1.5 ${accent.ctaBar}`}
            >
              <GitBranchIcon />
              Show Genealogy
            </button>
          ) : (
            <span className="flex-[1.5] px-3 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 text-center">
              Current root
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Tiny inline icon — mirrors lucide's `GitBranch` shape but
 * avoids the extra named import (the file already pulls in
 * plenty of lucide icons). Kept private to the modal.
 */
const GitBranchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

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

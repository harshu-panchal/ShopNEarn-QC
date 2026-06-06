import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";
import GenealogyTreeCanvas from "@shared/components/mlm/GenealogyTreeCanvas";

/**
 * Customer-MLM-rebuild Phase 8 — Tree View page (thin wrapper).
 *
 * Owns the API plumbing for the customer's binary downline tree:
 *   - Fetches the tree (`mlmApi.getGenealogyTree`) with depth
 *     selection and an optional `rootUserId` to recenter on any
 *     descendant.
 *   - Loads + persists per-user layout overrides
 *     (`mlmApi.getTreeLayout` / `saveTreeLayout`).
 *   - Maintains the in-page navigation stack so the user can walk
 *     into sub-trees (click a node) and back out one level at a
 *     time without ever leaving this page or the canvas.
 *
 * All rendering (pan / zoom / drag / hover tooltip / pill nodes /
 * edges / toolbar) lives in the shared `GenealogyTreeCanvas`
 * component, which is shared with the admin member detail page so
 * the two surfaces always present an identical interaction model.
 */
const TreeViewPage = () => {
  const saveTimerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [treePayload, setTreePayload] = useState(null);
  const [layoutOverrides, setLayoutOverrides] = useState({});
  const [depth, setDepth] = useState(4);

  // Sub-tree navigation: `rootUserId` is null when the user is
  // viewing their own root. Clicking a downline node pushes its
  // User._id here, which re-runs the fetch effect and re-renders
  // the canvas. The `rootStack` keeps the breadcrumb history so the
  // back button unwinds one level at a time instead of jumping all
  // the way back to self.
  const [rootUserId, setRootUserId] = useState(null);
  const [rootStack, setRootStack] = useState([]);

  // ----- Fetch tree + saved layout -----
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const treeParams = { depth };
        if (rootUserId) treeParams.rootUserId = rootUserId;
        const [treeRes, layoutRes] = await Promise.all([
          mlmApi.getGenealogyTree(treeParams),
          mlmApi.getTreeLayout(),
        ]);
        if (!mounted) return;
        const t = treeRes.data?.result ?? treeRes.data?.data ?? treeRes.data;
        const l = layoutRes.data?.result ?? layoutRes.data?.data ?? layoutRes.data;
        setTreePayload(t);
        setLayoutOverrides(l?.overrides || {});
      } catch (err) {
        const code = err?.response?.status;
        const msg = err?.response?.data?.message;
        toast.error(
          msg ||
            (code === 403
              ? "You can only view members in your own network."
              : "Failed to load tree"),
        );
        if (code === 403 && rootUserId) {
          // Roll back to whatever root we came from instead of
          // leaving the user stranded on an empty canvas.
          setRootStack((prev) => {
            const next = prev.slice(0, -1);
            setRootUserId(next.length ? next[next.length - 1] : null);
            return next;
          });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [depth, rootUserId]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // Debounced persistence for layout overrides. Both drag commits
  // and Reset funnel through here — Reset just emits an empty map.
  const handleChangeLayout = useCallback((next) => {
    setLayoutOverrides(next);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await mlmApi.saveTreeLayout(next);
      } catch (err) {
        console.warn("Save tree layout failed", err?.message || err);
      }
    }, 600);
  }, []);

  // Tap a node → push current root onto the back-stack and recenter
  // the canvas on the tapped node. No-op if the user taps the
  // visible root (tapping yourself goes nowhere).
  const handleNodeTap = useCallback(
    (node) => {
      const targetId = node?.data?.userId?._id
        ? String(node.data.userId._id)
        : typeof node?.data?.userId === "string"
          ? node.data.userId
          : null;
      if (!targetId) return;
      const currentRoot = rootUserId || null;
      if (currentRoot && String(currentRoot) === targetId) return;
      if (!currentRoot && treePayload?.tree) {
        const ownRootId = treePayload.tree.userId?._id
          ? String(treePayload.tree.userId._id)
          : null;
        if (ownRootId && ownRootId === targetId) return;
      }
      setRootStack((prev) => {
        const next = currentRoot ? [...prev, currentRoot] : [...prev];
        if (next.length && next[next.length - 1] === targetId) return prev;
        return next;
      });
      setRootUserId(targetId);
    },
    [rootUserId, treePayload],
  );

  const handleBackOneLevel = useCallback(() => {
    setRootStack((prev) => {
      if (!prev.length) {
        setRootUserId(null);
        return prev;
      }
      const next = prev.slice(0, -1);
      setRootUserId(next.length ? next[next.length - 1] : null);
      return next;
    });
  }, []);

  const handleResetToOwnTree = useCallback(() => {
    setRootStack([]);
    setRootUserId(null);
  }, []);

  // Inject `__isViewerSelf` so the NodeCard can append "(You)" to
  // the customer's own root when they're viewing their own tree.
  // The shared canvas reads this flag from `node.data.__isViewerSelf`.
  const enrichedTree = useMemo(() => {
    if (!treePayload?.tree) return null;
    if (rootUserId) return treePayload.tree;
    const t = { ...treePayload.tree, __isViewerSelf: true };
    return t;
  }, [treePayload, rootUserId]);

  const currentRootInfo = useMemo(() => {
    const root = treePayload?.tree;
    if (!root) return null;
    const u = root.userId;
    const name = (typeof u === "object" && u?.name) || root.name || "Member";
    const publicId =
      (typeof u === "object" && u?.userId) || root.publicUserId || null;
    return { name, publicId, referralCode: root.referralCode || null };
  }, [treePayload]);
  const viewingOwnTree = !rootUserId;

  const breadcrumb =
    !viewingOwnTree && currentRootInfo ? (
      <div className="flex items-center gap-1.5 ml-1">
        <button
          type="button"
          onClick={handleBackOneLevel}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
          title="Back one level"
        >
          <ArrowLeft size={12} />
          Back
        </button>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-700">
          <Users size={12} className="text-indigo-500" />
          <span className="font-bold uppercase tracking-wide truncate max-w-[140px]">
            {currentRootInfo.name}
          </span>
          {currentRootInfo.publicId && (
            <span className="font-mono font-bold text-indigo-500/80">
              · {currentRootInfo.publicId}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleResetToOwnTree}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600"
          title="Return to your own tree"
        >
          My tree
        </button>
      </div>
    ) : null;

  return (
    <GenealogyTreeCanvas
      tree={enrichedTree}
      loading={loading}
      isMember={Boolean(treePayload?.isMember)}
      depth={depth}
      onDepthChange={setDepth}
      layoutOverrides={layoutOverrides}
      onChangeLayout={handleChangeLayout}
      onNodeTap={handleNodeTap}
      breadcrumb={breadcrumb}
      emptyMemberMessage="Your tree appears once you become a member. Activate your account to see your network."
      emptyTreeMessage="Your network is empty — share your referral code to start building your team."
    />
  );
};

export default TreeViewPage;

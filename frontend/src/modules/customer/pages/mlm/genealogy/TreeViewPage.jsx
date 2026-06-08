import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Users } from "lucide-react";
import { toast } from "sonner";
import { mlmApi } from "../../../services/mlmApi";
import GenealogyTreeCanvas from "@shared/components/mlm/GenealogyTreeCanvas";

/**
 * Reload counter — bumping it forces the fetch effect to re-run
 * (deps array contains it). Used after a successful add-member so
 * the freshly placed node appears in the canvas without a manual
 * page refresh.
 */

/**
 * Customer-MLM-rebuild Phase 8 — Tree View page (thin wrapper).
 *
 * Owns the API plumbing for the customer's binary downline tree:
 *   - Fetches the tree (`mlmApi.getGenealogyTree`) with depth
 *     selection and an optional `rootUserId` to recenter on any
 *     descendant.
 *   - Maintains the in-page navigation stack so the user can walk
 *     into sub-trees (click a node) and back out one level at a
 *     time without ever leaving this page or the canvas.
 *
 * Per-user layout overrides have been retired — every node sits at
 * its deterministic tidy-tree position so the chart looks the same
 * for every viewer. The legacy `tree-layout` endpoints stay alive
 * on the backend for now but are intentionally never read or
 * written by this page.
 *
 * All rendering (pan / zoom / hover tooltip / pill nodes / edges /
 * toolbar) lives in the shared `GenealogyTreeCanvas` component,
 * which is shared with the admin member detail page so the two
 * surfaces always present an identical interaction model.
 */
const TreeViewPage = () => {
  const [loading, setLoading] = useState(true);
  const [treePayload, setTreePayload] = useState(null);
  // `depth = 0` is the sentinel for "All levels" — see the
  // `getMyGenealogyTree` controller. The customer's own tree should
  // show the entire downline on first load instead of an arbitrary
  // 4-level slice; the dropdown still lets them dial it back if they
  // want a smaller view.
  const [depth, setDepth] = useState(0);

  // Sub-tree navigation: `rootUserId` is null when the user is
  // viewing their own root. Clicking a downline node pushes its
  // User._id here, which re-runs the fetch effect and re-renders
  // the canvas. The `rootStack` keeps the breadcrumb history so the
  // back button unwinds one level at a time instead of jumping all
  // the way back to self.
  const [rootUserId, setRootUserId] = useState(null);
  const [rootStack, setRootStack] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);

  // ----- Fetch tree -----
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const treeParams = { depth };
        if (rootUserId) treeParams.rootUserId = rootUserId;
        const treeRes = await mlmApi.getGenealogyTree(treeParams);
        if (!mounted) return;
        const t = treeRes.data?.result ?? treeRes.data?.data ?? treeRes.data;
        setTreePayload(t);
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
    // `reloadKey` is intentionally in the deps array so a successful
    // add-member POST can trigger a fresh fetch with no other state
    // change. See `handleAddMember` below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depth, rootUserId, reloadKey]);

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

  // Genealogy redesign — empty-slot tap handler. The canvas opens
  // its own modal and gives us the resolved `{parentMembershipId,
  // leg, form}` payload here. We POST, show a toast, and bump
  // `reloadKey` so the fetch effect re-runs and the canvas paints
  // the freshly placed node. Throwing back to the canvas keeps the
  // modal open with the user's input so they can correct an
  // invalid field without retyping everything.
  const handleAddMember = useCallback(async ({ parentMembershipId, leg, form }) => {
    try {
      const res = await mlmApi.addMemberAtSlot({
        parentMembershipId,
        leg,
        name: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      const newMember =
        res.data?.result?.newMember ?? res.data?.data?.newMember ?? null;
      const credentialEcho = newMember?.publicUserId
        ? ` (User ID ${newMember.publicUserId})`
        : "";
      toast.success(
        `Member added to your network${credentialEcho}. Login details have been emailed.`,
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      const msg = err?.response?.data?.message || "Failed to add member.";
      toast.error(msg);
      // Re-throw so the modal surfaces the error inline and keeps
      // the form values intact.
      throw new Error(msg);
    }
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
      onNodeTap={handleNodeTap}
      onAddMember={handleAddMember}
      emptySlotMaxDepth={2}
      breadcrumb={breadcrumb}
      emptyMemberMessage="Your tree appears once you become a member. Activate your account to see your network."
      emptyTreeMessage="Your network is empty — share your referral code to start building your team."
    />
  );
};

export default TreeViewPage;

/**
 * Curated registry of MLM maintenance scripts exposed to admins via
 * Settings → Maintenance Tools. Each entry maps to a file under
 * `backend/scripts/` and documents the CLI flags the runner passes.
 */
export const MLM_MAINTENANCE_JOBS = [
  {
    id: "diagnose-binary-tree-drift",
    category: "Binary Tree",
    label: "Diagnose binary tree drift",
    description:
      "Read-only report of slot conflicts, orphan placements, and counter drift under a root member.",
    script: "scripts/diagnoseBinaryTreeDrift.js",
    danger: "low",
    readOnly: true,
    applyFlag: null,
    buildArgs: ({ root }) => (root ? [`--root=${root}`] : []),
    options: [
      {
        key: "root",
        label: "Root referral code",
        type: "text",
        placeholder: "e.g. SEXC4HJTEX (optional)",
      },
    ],
  },
  {
    id: "repair-binary-slot-conflicts",
    category: "Binary Tree",
    label: "Repair binary slot conflicts",
    description:
      "Re-spill members who claim the same binary slot into the first empty position on their leg chain.",
    script: "scripts/repairBinarySlotConflicts.js",
    danger: "high",
    applyFlag: "--commit",
    buildArgs: ({ root }) => (root ? [`--root=${root}`] : []),
    options: [
      {
        key: "root",
        label: "Scope to root referral code",
        type: "text",
        placeholder: "Leave empty for entire network",
      },
    ],
  },
  {
    id: "rebuild-binary-tree-all",
    category: "Binary Tree",
    label: "Rebuild binary tree — entire network",
    description:
      "Replay every member in registration order using same-leg spine spill (L→L / R→R). Run leg + pair backfills after.",
    script: "scripts/rebuildBinaryTreeRegistrationOrder.js",
    danger: "high",
    applyFlag: "--commit",
    buildArgs: () => ["--all-roots"],
    options: [],
  },
  {
    id: "rebuild-binary-tree-root",
    category: "Binary Tree",
    label: "Rebuild binary tree — one root subtree",
    description:
      "Replay placement for one root and its binary descendants only.",
    script: "scripts/rebuildBinaryTreeRegistrationOrder.js",
    danger: "high",
    applyFlag: "--commit",
    requiresOption: "root",
    buildArgs: ({ root }) => [`--root=${String(root || "").trim().toUpperCase()}`],
    options: [
      {
        key: "root",
        label: "Root referral code",
        type: "text",
        required: true,
        placeholder: "Required",
      },
    ],
  },
  {
    id: "backfill-leg-direct-counts",
    category: "Counters",
    label: "Backfill leg direct counts",
    description:
      "Recompute leftLegDirectCount, rightLegDirectCount, and pairsCompleted from the binary tree.",
    script: "scripts/backfill-mlm-leg-direct-counts.js",
    danger: "medium",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "backfill-binary-team-pair-counts",
    category: "Counters",
    label: "Backfill team pair snapshot counters",
    description:
      "Recompute left/right team active volumes and binary pair eligibility fields.",
    script: "scripts/backfill-mlm-binary-team-pair-counts.js",
    danger: "medium",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "recalculate-downline-counters",
    category: "Counters",
    label: "Recalculate downline counters",
    description:
      "Rebuild activeDownlineCount and inactiveDownlineCount from sponsor chains. Always writes — no preview mode.",
    script: "scripts/recalculateDownlineCounters.js",
    danger: "medium",
    noDryRun: true,
    applyFlag: null,
    buildArgs: () => [],
    options: [],
  },
  {
    id: "backfill-signup-bonus",
    category: "Income & Bonuses",
    label: "Backfill signup shopping bonuses",
    description:
      "Credit ₹100 self + ₹50 sponsor shopping wallet for memberships that never received signup bonus.",
    script: "scripts/backfill-mlm-signup-bonus.js",
    danger: "medium",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "backfill-direct-referral-activation",
    category: "Income & Bonuses",
    label: "Backfill referral activation income",
    description:
      "Credit ₹200 earnings to sponsors who completed their first direct L+R pair but never received DIRECT_REFERRAL_ACTIVATION.",
    script: "scripts/backfill-mlm-direct-referral-activation.js",
    danger: "medium",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "restore-first-pair-after-recalc",
    category: "Income & Bonuses",
    label: "Restore first-pair income after recalc",
    description:
      "Credit ₹200 earnings to sponsors zeroed by earnings recalc (MLM-EARN-RECALC) who have a complete first direct L+R pair but no wallet credit yet. Safe for Vinod-type cases.",
    script: "scripts/restore-first-pair-income-after-recalc.js",
    danger: "medium",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "backfill-held-bonus-contributors",
    category: "Income & Bonuses",
    label: "Backfill held pair bonus contributors",
    description:
      "Fix meta.left/rightContributorUserId on held pair-match commission events.",
    script: "scripts/backfill-mlm-held-bonus-and-contributors.js",
    danger: "low",
    applyFlag: "--apply",
    buildArgs: () => [],
    options: [],
  },
  {
    id: "recalc-earnings-wallet",
    category: "Income & Bonuses",
    label: "Recalculate earnings wallets (binary pairs)",
    description:
      "DESTRUCTIVE: zeros earnings/pending, voids prior pair credits, re-credits from current tree volumes. Use only after tree fixes.",
    script: "scripts/recalc-mlm-earnings-wallet.js",
    danger: "critical",
    applyFlag: "--apply",
    buildArgs: ({ force }) => (force ? ["--force"] : []),
    options: [
      {
        key: "force",
        label: "Force re-run (voids prior recalc credits)",
        type: "boolean",
        default: false,
      },
    ],
  },
  {
    id: "backfill-daily-payout-reports",
    category: "Income & Bonuses",
    label: "Backfill daily payout reports",
    description:
      "Generate MlmDailyPayoutReport snapshots for an IST date range (pairs, earnings, referrals per day).",
    script: "scripts/backfill-mlm-daily-payout-reports.js",
    danger: "medium",
    applyFlag: "--apply",
    requiresOption: "from",
    buildArgs: ({ from, to }) => {
      const args = [`--from=${String(from || "").trim()}`];
      if (to) args.push(`--to=${String(to).trim()}`);
      return args;
    },
    options: [
      {
        key: "from",
        label: "From date (IST)",
        type: "text",
        required: true,
        placeholder: "YYYY-MM-DD",
      },
      {
        key: "to",
        label: "To date (IST)",
        type: "text",
        placeholder: "YYYY-MM-DD (defaults to from)",
      },
    ],
  },
  {
    id: "audit-mlm-dashboard",
    category: "Audit",
    label: "Run MLM dashboard audit",
    description:
      "Read-only summary of wallet totals, counter drift, and membership stats.",
    script: "scripts/audit-mlm-dashboard.js",
    danger: "low",
    readOnly: true,
    applyFlag: null,
    buildArgs: () => [],
    options: [],
  },
];

export function getMaintenanceJob(jobId) {
  return MLM_MAINTENANCE_JOBS.find((j) => j.id === jobId) || null;
}

export function listMaintenanceJobsForApi() {
  return MLM_MAINTENANCE_JOBS.map((job) => ({
    id: job.id,
    category: job.category,
    label: job.label,
    description: job.description,
    danger: job.danger,
    readOnly: Boolean(job.readOnly),
    noDryRun: Boolean(job.noDryRun),
    options: (job.options || []).map((opt) => ({
      key: opt.key,
      label: opt.label,
      type: opt.type,
      required: Boolean(opt.required),
      placeholder: opt.placeholder || "",
      default: opt.default ?? null,
    })),
  }));
}

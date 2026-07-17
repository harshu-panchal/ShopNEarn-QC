/**
 * Idempotent backfill: ensure super_admin role exists and assign it to
 * every Admin document that is missing roleId / isActive / tokenVersion.
 *
 * Usage:
 *   node scripts/backfillAdminRoles.js --dry-run
 *   node scripts/backfillAdminRoles.js
 *   node scripts/backfillAdminRoles.js --limit 100
 */

import dotenv from "dotenv";
import mongoose from "mongoose";
import Admin from "../app/models/admin.js";
import {
  ensureSuperAdminRole,
  getAllAdminPermissions,
} from "../app/services/admin/adminRbacService.js";

dotenv.config();

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const limitIndex = argv.indexOf("--limit");
  const limit =
    limitIndex >= 0 && argv[limitIndex + 1]
      ? Number(argv[limitIndex + 1])
      : null;
  return { dryRun, limit: Number.isFinite(limit) && limit > 0 ? limit : null };
}

async function run() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const migrationId = `backfill-admin-roles-${Date.now()}`;
  const startedAt = Date.now();

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI environment variable is not defined");
  }

  await mongoose.connect(mongoUri);
  console.log(
    JSON.stringify({
      event: "migration.start",
      migrationId,
      dryRun,
      limit,
    }),
  );

  const summary = {
    migrationId,
    dryRun,
    superAdminRoleEnsured: false,
    scanned: 0,
    wouldModify: 0,
    modified: 0,
    sampleIds: [],
    checksum: {
      adminsWithoutRoleId: 0,
      inactiveWithoutDisabledAt: 0,
      missingTokenVersion: 0,
    },
  };

  try {
    const superRole = await ensureSuperAdminRole();
    summary.superAdminRoleEnsured = true;
    summary.superAdminPermissionCount = getAllAdminPermissions().length;
    summary.superAdminRoleId = String(superRole._id);

    const filter = {
      $or: [
        { roleId: { $exists: false } },
        { roleId: null },
        { isActive: { $exists: false } },
        { tokenVersion: { $exists: false } },
      ],
    };

    let query = Admin.find(filter).select("_id email roleId isActive tokenVersion").sort({ _id: 1 });
    if (limit) query = query.limit(limit);
    const candidates = await query.lean();
    summary.scanned = candidates.length;

    for (const admin of candidates) {
      const needsRole = !admin.roleId;
      const needsActive = admin.isActive === undefined;
      const needsTokenVersion = admin.tokenVersion === undefined;
      if (!needsRole && !needsActive && !needsTokenVersion) continue;

      summary.wouldModify += 1;
      if (summary.sampleIds.length < 10) {
        summary.sampleIds.push(String(admin._id));
      }

      if (dryRun) continue;

      const update = {};
      if (needsRole) update.roleId = superRole._id;
      if (needsActive) update.isActive = true;
      if (needsTokenVersion) update.tokenVersion = 0;

      await Admin.updateOne({ _id: admin._id }, { $set: update });
      summary.modified += 1;
    }

    // Also assign super_admin to any active admin still without roleId
    // outside the $or filter edge cases (e.g. empty ObjectId string).
    if (!dryRun) {
      const leftover = await Admin.updateMany(
        { $or: [{ roleId: null }, { roleId: { $exists: false } }] },
        { $set: { roleId: superRole._id, isActive: true, tokenVersion: 0 } },
      );
      summary.leftoverMatched = leftover.matchedCount;
      summary.leftoverModified = leftover.modifiedCount;
    }

    summary.checksum.adminsWithoutRoleId = await Admin.countDocuments({
      $or: [{ roleId: null }, { roleId: { $exists: false } }],
    });
    summary.checksum.missingTokenVersion = await Admin.countDocuments({
      tokenVersion: { $exists: false },
    });
    summary.checksum.superAdminAssigned = await Admin.countDocuments({
      roleId: superRole._id,
    });

    console.log(
      JSON.stringify({
        event: "migration.done",
        ...summary,
        elapsedMs: Date.now() - startedAt,
      }),
    );

    if (!dryRun && summary.checksum.adminsWithoutRoleId > 0) {
      throw new Error(
        `Checksum failed: ${summary.checksum.adminsWithoutRoleId} admins still missing roleId`,
      );
    }
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((error) => {
  console.error(
    JSON.stringify({
      event: "migration.failed",
      error: error.message,
      stack: error.stack,
    }),
  );
  process.exit(1);
});

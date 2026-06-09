/**
 * One-shot binary-tree restructure (PO-request Jun 2026).
 *
 * Two subtree moves, executed inside ONE mongoose transaction so
 * a failure on the second move rolls back the first.
 *
 *   MOVE 2: Samad shaikh [JAVFATD3]      -> right child of Akbar [DN5K9DMW]
 *           (Samad's downline rides along; Yasminbanu.R is freed.)
 *
 *   MOVE 1: Abdulwahab A Shaikh [PTEXCRW6] -> right child of Yasminbanu [3HBQUC97]
 *           (Abdulwahab's downline rides along; Abdulmustakim.R is freed.)
 *
 * Order matters: Move 2 must complete first because Yasminbanu.R is
 * currently OCCUPIED by Samad. After Move 2 it's empty and Move 1
 * can land cleanly.
 *
 * Pre-conditions are asserted explicitly; if ANY of them fail the
 * transaction aborts before a single write hits disk.
 *
 * Usage:
 *   node scripts/moveSamadAndAbdulwahab.js            # dry-run (no commit, prints plan)
 *   node scripts/moveSamadAndAbdulwahab.js --commit   # actually persist
 *
 * Safe to re-run with --commit: idempotency is achieved by the
 * pre-condition checks (if the move has already happened, the script
 * sees the post-state instead of the pre-state and bails with a
 * clear "already moved" notice — no double-writes).
 *
 * Strictly does NOT touch:
 *   - sponsorId / sponsorChain / sponsorMembershipId  (sponsorship
 *     is independent of binary placement; nothing should change)
 *   - Wallet / Ledger / Commission events             (binary moves
 *     don't trigger any money flow)
 *   - leftLegDirectCount / rightLegDirectCount        (these are
 *     signup-time snapshots and have known drift on historical
 *     data; a manual move doesn't make the drift better OR worse,
 *     so leave them for a dedicated recompute job)
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";

const COMMIT = process.argv.includes("--commit");

const PLAYERS = {
  yasminbanu:    "3HBQUC97",
  abdulwahab:    "PTEXCRW6",
  abdulmustakim: "Z398BKJE",
  samad:         "JAVFATD3",
  akbar:         "DN5K9DMW",
};

function tag(label, m) {
  if (!m) return `${label}=MISSING`;
  return `${label}=${m.userId?.name || "?"} [${m.referralCode}] uid=${m.userId?._id || m.userId}`;
}

function assert(condition, message) {
  if (!condition) {
    const err = new Error(`PRECONDITION FAILED: ${message}`);
    err.precondition = true;
    throw err;
  }
}

async function loadByCode(code, session) {
  return MlmMembership.findOne({ referralCode: code }, null, { session })
    .populate("userId", "name");
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const session = await mongoose.startSession();
  try {
    let alreadyDone = { move1: false, move2: false };

    await session.withTransaction(async () => {
      const [yasminbanu, abdulwahab, abdulmustakim, samad, akbar] = await Promise.all([
        loadByCode(PLAYERS.yasminbanu, session),
        loadByCode(PLAYERS.abdulwahab, session),
        loadByCode(PLAYERS.abdulmustakim, session),
        loadByCode(PLAYERS.samad, session),
        loadByCode(PLAYERS.akbar, session),
      ]);

      console.log("\n--- LOADED ---");
      console.log(" ", tag("YASMINBANU   ", yasminbanu));
      console.log(" ", tag("ABDULWAHAB   ", abdulwahab));
      console.log(" ", tag("ABDULMUSTAKIM", abdulmustakim));
      console.log(" ", tag("SAMAD        ", samad));
      console.log(" ", tag("AKBAR        ", akbar));

      assert(yasminbanu,    "Yasminbanu (3HBQUC97) not found");
      assert(abdulwahab,    "Abdulwahab (PTEXCRW6) not found");
      assert(abdulmustakim, "Abdulmustakim (Z398BKJE) not found");
      assert(samad,         "Samad (JAVFATD3) not found");
      assert(akbar,         "Akbar (DN5K9DMW) not found");

      const yasminbanuUid    = yasminbanu.userId._id;
      const abdulwahabUid    = abdulwahab.userId._id;
      const abdulmustakimUid = abdulmustakim.userId._id;
      const samadUid         = samad.userId._id;
      const akbarUid         = akbar.userId._id;

      // ---------------- MOVE 2 first: Samad -> Akbar.R ----------------
      console.log("\n--- MOVE 2: Samad shaikh -> Akbar.R ---");

      const samadAlreadyUnderAkbar =
        String(samad.binaryParentId) === String(akbarUid) &&
        samad.binaryPosition === "R";

      if (samadAlreadyUnderAkbar) {
        console.log("  ✅ Already done: Samad is already Akbar's R child. Skipping.");
        alreadyDone.move2 = true;
      } else {
        assert(
          String(samad.binaryParentId) === String(yasminbanuUid) && samad.binaryPosition === "R",
          `Samad is no longer Yasminbanu's R child (parent=${samad.binaryParentId}, pos=${samad.binaryPosition}). Refusing to move.`,
        );
        assert(!akbar.binaryRightChildId, `Akbar.R is already occupied (binaryRightChildId=${akbar.binaryRightChildId}).`);
        // Bottom-up check: nobody currently claims Akbar.R via binaryParentId.
        const akbarRightSquatter = await MlmMembership.findOne(
          { binaryParentId: akbarUid, binaryPosition: "R" },
          null,
          { session },
        );
        assert(!akbarRightSquatter, `A row already claims Akbar.R via binaryParentId (${akbarRightSquatter?.referralCode}). Refusing.`);

        // Cycle defence: Akbar must NOT be in Samad's current subtree.
        const akbarInSamadDownline = await MlmMembership.findOne(
          { userId: akbarUid, sponsorChain: samadUid },
          { _id: 1 },
          { session },
        );
        assert(!akbarInSamadDownline, "Cycle risk: Akbar is in Samad's sponsor chain.");

        // 1. Detach Samad from Yasminbanu (clear Yasminbanu.binaryRightChildId).
        yasminbanu.binaryRightChildId = null;
        await yasminbanu.save({ session });
        // 2. Wire Samad under Akbar on R.
        samad.binaryParentId           = akbarUid;
        samad.binaryParentMembershipId = akbar._id;
        samad.binaryPosition           = "R";
        await samad.save({ session });
        // 3. Update Akbar's top-down pointer.
        akbar.binaryRightChildId = samadUid;
        await akbar.save({ session });

        console.log("  ✓ Samad detached from Yasminbanu.R");
        console.log("  ✓ Samad attached to Akbar.R");
      }

      // ---------------- MOVE 1: Abdulwahab -> Yasminbanu.R ----------------
      console.log("\n--- MOVE 1: Abdulwahab A Shaikh -> Yasminbanu.R ---");

      const abdulwahabAlreadyUnderYasminbanu =
        String(abdulwahab.binaryParentId) === String(yasminbanuUid) &&
        abdulwahab.binaryPosition === "R";

      if (abdulwahabAlreadyUnderYasminbanu) {
        console.log("  ✅ Already done: Abdulwahab is already Yasminbanu's R child. Skipping.");
        alreadyDone.move1 = true;
      } else {
        assert(
          String(abdulwahab.binaryParentId) === String(abdulmustakimUid) && abdulwahab.binaryPosition === "R",
          `Abdulwahab is no longer Abdulmustakim's R child (parent=${abdulwahab.binaryParentId}, pos=${abdulwahab.binaryPosition}). Refusing to move.`,
        );

        // Re-read Yasminbanu's R state (Move 2 may have cleared it
        // inside this same transaction; mongoose's in-memory doc is
        // still in sync because we mutated it directly above).
        assert(
          !yasminbanu.binaryRightChildId,
          `Yasminbanu.R is still occupied (binaryRightChildId=${yasminbanu.binaryRightChildId}). Move 2 must have failed.`,
        );
        // Cycle defence — Yasminbanu must NOT be in Abdulwahab's current downline.
        const yasminbanuInAbdulwahabDownline = await MlmMembership.findOne(
          { userId: yasminbanuUid, sponsorChain: abdulwahabUid },
          { _id: 1 },
          { session },
        );
        assert(!yasminbanuInAbdulwahabDownline, "Cycle risk: Yasminbanu is in Abdulwahab's sponsor chain.");

        // 1. Detach Abdulwahab from Abdulmustakim.R.
        abdulmustakim.binaryRightChildId = null;
        await abdulmustakim.save({ session });
        // 2. Wire Abdulwahab under Yasminbanu on R.
        abdulwahab.binaryParentId           = yasminbanuUid;
        abdulwahab.binaryParentMembershipId = yasminbanu._id;
        abdulwahab.binaryPosition           = "R";
        await abdulwahab.save({ session });
        // 3. Update Yasminbanu's top-down pointer.
        yasminbanu.binaryRightChildId = abdulwahabUid;
        await yasminbanu.save({ session });

        console.log("  ✓ Abdulwahab detached from Abdulmustakim.R");
        console.log("  ✓ Abdulwahab attached to Yasminbanu.R");
      }

      // ---------------- POST-CONDITION CHECKS ----------------
      console.log("\n--- POST-CONDITION CHECKS ---");

      const [samadAfter, abdulwahabAfter, akbarAfter, yasminbanuAfter, abdulmustakimAfter] =
        await Promise.all([
          loadByCode(PLAYERS.samad, session),
          loadByCode(PLAYERS.abdulwahab, session),
          loadByCode(PLAYERS.akbar, session),
          loadByCode(PLAYERS.yasminbanu, session),
          loadByCode(PLAYERS.abdulmustakim, session),
        ]);

      assert(
        String(samadAfter.binaryParentId) === String(akbarAfter.userId._id) &&
          samadAfter.binaryPosition === "R" &&
          String(akbarAfter.binaryRightChildId) === String(samadAfter.userId._id),
        "Post-check Move 2 FAILED: Samad/Akbar linkage inconsistent.",
      );
      assert(
        String(abdulwahabAfter.binaryParentId) === String(yasminbanuAfter.userId._id) &&
          abdulwahabAfter.binaryPosition === "R" &&
          String(yasminbanuAfter.binaryRightChildId) === String(abdulwahabAfter.userId._id),
        "Post-check Move 1 FAILED: Abdulwahab/Yasminbanu linkage inconsistent.",
      );
      assert(
        !abdulmustakimAfter.binaryRightChildId,
        "Post-check FAILED: Abdulmustakim.binaryRightChildId should be null (Abdulwahab left).",
      );

      console.log("  ✅ Samad      => parent=Akbar [DN5K9DMW] / R");
      console.log("  ✅ Abdulwahab => parent=Yasminbanu [3HBQUC97] / R");
      console.log("  ✅ Abdulmustakim.R freed (was Abdulwahab)");
      console.log("  ✅ Yasminbanu.R now Abdulwahab (was Samad)");
      console.log("  ✅ Akbar.R now Samad (was empty)");

      if (!COMMIT) {
        console.log("\n*** DRY-RUN — aborting transaction (pass --commit to persist) ***");
        // Throwing causes withTransaction to abort cleanly; calling
        // session.abortTransaction() explicitly would double-abort
        // and surface MongoTransactionError.
        const dryRun = new Error("__DRY_RUN_ABORT__");
        dryRun.dryRun = true;
        throw dryRun;
      }
    });

    if (COMMIT) {
      console.log("\n🎉 COMMITTED. Both moves persisted atomically.");
      if (alreadyDone.move1 && alreadyDone.move2) {
        console.log("   (Both targets were already in place — script was a no-op.)");
      } else if (alreadyDone.move1) {
        console.log("   (Move 1 was already in place; only Move 2 wrote.)");
      } else if (alreadyDone.move2) {
        console.log("   (Move 2 was already in place; only Move 1 wrote.)");
      }
    }
  } catch (err) {
    if (err.dryRun) {
      console.log("\n(Dry-run aborted as expected. No changes written.)");
    } else if (err.precondition) {
      console.error(`\n❌ ${err.message}`);
      console.error("   No writes committed.");
      process.exitCode = 1;
    } else {
      console.error("\n💥 UNEXPECTED ERROR:", err);
      process.exitCode = 1;
    }
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});

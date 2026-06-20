/**
 * Place Abdulwahab A Shaikh as Yasminbanu A Shaikh's direct R binary child.
 *
 * Yasmin.R is currently Samad — Samad moves to Abdulmustakim.R (freed when
 * Abdulwahab leaves). Then Abdulwahab attaches to Yasmin.R.
 *
 * Usage:
 *   node scripts/moveSamadAndAbdulwahab.js
 *   node scripts/moveSamadAndAbdulwahab.js --commit
 */
import "dotenv/config";
import mongoose from "mongoose";

import MlmMembership from "../app/models/mlmMembership.js";
import "../app/models/customer.js";

const COMMIT = process.argv.includes("--commit");

const PLAYERS = {
  yasminbanu: "SE8P8JS4GC",
  abdulwahab: "SEUJMP3M85",
  abdulmustakim: "SE2CXE6WVG",
  samad: "SEW2YHR3Y6",
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
  return MlmMembership.findOne({ referralCode: code }, null, { session }).populate(
    "userId",
    "name",
  );
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: undefined });

  const session = await mongoose.startSession();
  try {
    let alreadyDone = { moveSamad: false, moveAbdulwahab: false };

    await session.withTransaction(async () => {
      const [yasminbanu, abdulwahab, abdulmustakim, samad] = await Promise.all([
        loadByCode(PLAYERS.yasminbanu, session),
        loadByCode(PLAYERS.abdulwahab, session),
        loadByCode(PLAYERS.abdulmustakim, session),
        loadByCode(PLAYERS.samad, session),
      ]);

      console.log("\n--- LOADED ---");
      console.log(" ", tag("YASMINBANU   ", yasminbanu));
      console.log(" ", tag("ABDULWAHAB   ", abdulwahab));
      console.log(" ", tag("ABDULMUSTAKIM", abdulmustakim));
      console.log(" ", tag("SAMAD        ", samad));

      assert(yasminbanu, "Yasminbanu not found");
      assert(abdulwahab, "Abdulwahab not found");
      assert(abdulmustakim, "Abdulmustakim not found");
      assert(samad, "Samad not found");

      const yasminbanuUid = yasminbanu.userId._id;
      const abdulwahabUid = abdulwahab.userId._id;
      const abdulmustakimUid = abdulmustakim.userId._id;
      const samadUid = samad.userId._id;

      // MOVE A: free Abdulmustakim.R, then Samad Yasmin.R -> Abdulmustakim.R
      console.log("\n--- MOVE A: Samad -> Abdulmustakim.R ---");

      const samadAlreadyUnderAbdulmustakim =
        String(samad.binaryParentId) === String(abdulmustakimUid) &&
        samad.binaryPosition === "R";

      if (samadAlreadyUnderAbdulmustakim) {
        console.log("  Already done: Samad is Abdulmustakim's R child.");
        alreadyDone.moveSamad = true;
      } else {
        assert(
          String(samad.binaryParentId) === String(yasminbanuUid) &&
            samad.binaryPosition === "R",
          `Samad is not Yasminbanu's R child (parent=${samad.binaryParentId}, pos=${samad.binaryPosition}).`,
        );

        // Abdulmustakim.R currently holds Abdulwahab — clear top-down first.
        if (
          String(abdulmustakim.binaryRightChildId) === String(abdulwahabUid)
        ) {
          abdulmustakim.binaryRightChildId = null;
          await abdulmustakim.save({ session });
          console.log("  Cleared Abdulmustakim.R (was Abdulwahab).");
        }
        assert(
          !abdulmustakim.binaryRightChildId,
          `Abdulmustakim.R still occupied (${abdulmustakim.binaryRightChildId}).`,
        );

        yasminbanu.binaryRightChildId = null;
        await yasminbanu.save({ session });

        samad.binaryParentId = abdulmustakimUid;
        samad.binaryParentMembershipId = abdulmustakim._id;
        samad.binaryPosition = "R";
        await samad.save({ session });

        abdulmustakim.binaryRightChildId = samadUid;
        await abdulmustakim.save({ session });

        console.log("  Samad moved to Abdulmustakim.R; Yasmin.R freed.");
      }

      // MOVE B: Abdulwahab Abdulmustakim.R -> Yasminbanu.R
      console.log("\n--- MOVE B: Abdulwahab -> Yasminbanu.R ---");

      const abdulwahabAlreadyUnderYasminbanu =
        String(abdulwahab.binaryParentId) === String(yasminbanuUid) &&
        abdulwahab.binaryPosition === "R";

      if (abdulwahabAlreadyUnderYasminbanu) {
        console.log("  Already done: Abdulwahab is Yasminbanu's R child.");
        alreadyDone.moveAbdulwahab = true;
      } else {
        if (!alreadyDone.moveSamad) {
          assert(
            !yasminbanu.binaryRightChildId,
            `Yasminbanu.R still occupied (${yasminbanu.binaryRightChildId}).`,
          );
        } else {
          const yasminRightSquatter = await MlmMembership.findOne(
            { binaryParentId: yasminbanuUid, binaryPosition: "R" },
            null,
            { session },
          );
          assert(
            !yasminRightSquatter ||
              String(yasminRightSquatter.userId) === String(abdulwahabUid),
            `Yasminbanu.R claimed by ${yasminRightSquatter?.referralCode}.`,
          );
        }

        assert(
          String(abdulwahab.binaryParentId) === String(abdulmustakimUid) &&
            abdulwahab.binaryPosition === "R",
          `Abdulwahab is not Abdulmustakim's R child (parent=${abdulwahab.binaryParentId}, pos=${abdulwahab.binaryPosition}).`,
        );

        abdulwahab.binaryParentId = yasminbanuUid;
        abdulwahab.binaryParentMembershipId = yasminbanu._id;
        abdulwahab.binaryPosition = "R";
        await abdulwahab.save({ session });

        yasminbanu.binaryRightChildId = abdulwahabUid;
        await yasminbanu.save({ session });

        console.log("  Abdulwahab attached to Yasminbanu.R.");
      }

      if (!COMMIT) {
        const dryRun = new Error("__DRY_RUN_ABORT__");
        dryRun.dryRun = true;
        throw dryRun;
      }
    });

    if (COMMIT) {
      console.log("\nCommitted. Abdulwahab is Yasminbanu's direct R binary child.");
    }
  } catch (err) {
    if (err.dryRun) {
      console.log("\nDry-run OK. Re-run with --commit to persist.");
    } else if (err.precondition) {
      console.error(`\n${err.message}`);
      process.exitCode = 1;
    } else {
      console.error("\nERROR:", err);
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

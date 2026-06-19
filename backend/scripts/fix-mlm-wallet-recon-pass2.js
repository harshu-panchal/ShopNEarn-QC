import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../app/dbConfig/dbConfig.js";
import LedgerEntry from "../app/models/ledgerEntry.js";
import Wallet from "../app/models/wallet.js";
import { LEDGER_DIRECTION, LEDGER_TRANSACTION_TYPE, OWNER_TYPE } from "../app/constants/finance.js";
import { creditWallet, debitWallet } from "../app/services/finance/walletService.js";
import { roundCurrency } from "../app/utils/money.js";

dotenv.config();
const APPLY = process.argv.includes("--apply");

function isShoppingCreditRow(row) {
  if (row.direction !== LEDGER_DIRECTION.CREDIT) return false;
  if (
    [
      LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SELF,
      LEDGER_TRANSACTION_TYPE.MLM_SIGNUP_BONUS_SPONSOR,
      LEDGER_TRANSACTION_TYPE.MLM_JOINING_PACKAGE_SHOPPING_CREDIT,
      LEDGER_TRANSACTION_TYPE.MLM_PREMIUM_UPGRADE_SHOPPING_CREDIT,
    ].includes(row.type)
  ) {
    return true;
  }
  if (row.type === LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT) {
    return /plan\s*a|activation|joining|shopping|reconciliation.*credit/i.test(row.description || "");
  }
  if (row.type === LEDGER_TRANSACTION_TYPE.ADJUSTMENT) {
    return /shopping|signup|migration.*credit/i.test(row.description || "");
  }
  return false;
}

function isShoppingDebitRow(row) {
  if (row.direction !== LEDGER_DIRECTION.DEBIT) return false;
  if (row.idempotencyKey?.startsWith("MLM-WALLET-FIX-RECON-")) return false;
  if (row.metadata?.bucketDrained === "shopping") return true;
  if (/shopping|checkout.*wallet/i.test(row.description || "")) return true;
  return false;
}

async function expectedShopping(userId) {
  const rows = await LedgerEntry.find({ actorId: userId, actorType: OWNER_TYPE.CUSTOMER }).lean();
  let c = 0, d = 0;
  for (const row of rows) {
    if (isShoppingCreditRow(row)) c += row.amount || 0;
    if (isShoppingDebitRow(row)) d += row.amount || 0;
  }
  return roundCurrency(c - d);
}

async function main() {
  await connectDB();
  const wallets = await Wallet.find({ ownerType: OWNER_TYPE.CUSTOMER });
  let fixed = 0;
  for (const w of wallets) {
    const expected = await expectedShopping(w.ownerId);
    const actual = roundCurrency(w.shoppingBalance || 0);
    const gap = roundCurrency(actual - expected);
    if (Math.abs(gap) < 0.01) continue;
    console.log(`GAP ${w.ownerId}: actual ${actual} expected ${expected} gap ${gap}`);
    if (!APPLY) continue;
    const key = `MLM-WALLET-FIX-RECON2-${gap > 0 ? "DEBIT" : "CREDIT"}-${String(w.ownerId)}`;
    if (await LedgerEntry.exists({ idempotencyKey: key })) continue;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        if (gap > 0) {
          await debitWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: w.ownerId,
            amount: gap,
            bucket: "shopping",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerDescription: "Wallet fix pass 2: shopping reconciliation debit",
            idempotencyKey: key,
            syncUserWalletBalance: false,
          });
        } else {
          await creditWallet({
            ownerType: OWNER_TYPE.CUSTOMER,
            ownerId: w.ownerId,
            amount: -gap,
            bucket: "shopping",
            session,
            ledgerType: LEDGER_TRANSACTION_TYPE.MLM_MANUAL_ADJUSTMENT,
            ledgerDescription: "Wallet fix pass 2: shopping reconciliation credit",
            idempotencyKey: key,
            syncUserWalletBalance: false,
          });
        }
      });
    } finally {
      await session.endSession();
    }
    fixed += 1;
  }
  console.log("Fixed:", fixed, APPLY ? "(applied)" : "(dry-run)");
  await mongoose.connection.close();
}
main();

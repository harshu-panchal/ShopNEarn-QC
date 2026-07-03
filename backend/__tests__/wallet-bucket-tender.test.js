import { jest } from "@jest/globals";

// Focused unit test for the full-wallet checkout tender helper
// `debitCustomerWalletBucket`. It must:
//   1. Debit ONLY the chosen bucket (never cascade across buckets).
//   2. Write exactly one WALLET_PAYMENT ledger entry inside the session.
//   3. Throw (and touch nothing) when the chosen bucket alone can't cover
//      the amount, even if OTHER buckets could.
//
// We mock the Mongoose models + ledgerService so the real walletService
// internals (getCustomerSpendableBuckets → debitWallet → ledger) run
// against an in-memory wallet document.

const mockCreateLedgerEntry = jest.fn();
const mockUserUpdateOne = jest.fn();

// A query object that works for BOTH `await Wallet.findOne(...)` and
// `Wallet.findOne(...).lean()` by being a thenable that also exposes lean().
function makeQuery(doc) {
  return {
    lean: () => Promise.resolve(doc),
    then: (resolve, reject) => Promise.resolve(doc).then(resolve, reject),
  };
}

let walletDoc;
const mockWalletFindOne = jest.fn(() => makeQuery(walletDoc));

jest.unstable_mockModule("../app/models/wallet.js", () => ({
  default: {
    findOne: mockWalletFindOne,
    create: jest.fn(),
  },
}));
jest.unstable_mockModule("../app/models/payout.js", () => ({ default: {} }));
jest.unstable_mockModule("../app/models/order.js", () => ({ default: {} }));
jest.unstable_mockModule("../app/models/customer.js", () => ({
  default: { updateOne: mockUserUpdateOne, findById: jest.fn() },
}));
jest.unstable_mockModule("../app/services/finance/ledgerService.js", () => ({
  createLedgerEntry: mockCreateLedgerEntry,
}));

const { debitCustomerWalletBucket } = await import(
  "../app/services/finance/walletService.js"
);
const { WALLET_STATUS, LEDGER_DIRECTION } = await import(
  "../app/constants/finance.js"
);

function seedWallet({ shopping, earnings, available }) {
  walletDoc = {
    _id: "wallet-1",
    status: WALLET_STATUS.ACTIVE,
    shoppingBalance: shopping,
    earningsBalance: earnings,
    availableBalance: available,
    totalDebited: 0,
    save: jest.fn().mockResolvedValue(true),
  };
  return walletDoc;
}

describe("debitCustomerWalletBucket (full-wallet checkout tender)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateLedgerEntry.mockResolvedValue({ _id: "ledger-1" });
  });

  it("debits ONLY the earnings bucket and never touches shopping/available", async () => {
    seedWallet({ shopping: 100, earnings: 500, available: 50 });

    const result = await debitCustomerWalletBucket({
      customerId: "cust-1",
      bucket: "earnings",
      totalAmount: 300,
      session: { id: "sess" },
      ledgerReference: "WLT-CHOUT-CG1",
      idempotencyKey: "WLT-CHOUT-CG1",
    });

    // Bucket isolation: earnings drained, others intact.
    expect(walletDoc.earningsBalance).toBe(200);
    expect(walletDoc.shoppingBalance).toBe(100);
    expect(walletDoc.availableBalance).toBe(50);

    // Return shape used to persist paymentBreakdown.walletSplit.
    expect(result.totalDebited).toBe(300);
    expect(result.split).toEqual({ shopping: 0, earnings: 300, available: 0 });
    expect(result.ledgerIds).toEqual(["ledger-1"]);

    // Exactly one WALLET_PAYMENT debit ledger row, in-session.
    expect(mockCreateLedgerEntry).toHaveBeenCalledTimes(1);
    const [ledgerArgs, ledgerOpts] = mockCreateLedgerEntry.mock.calls[0];
    expect(ledgerArgs).toEqual(
      expect.objectContaining({
        type: "WALLET_PAYMENT",
        direction: LEDGER_DIRECTION.DEBIT,
        amount: 300,
      }),
    );
    expect(ledgerOpts).toEqual({ session: { id: "sess" } });

    // Non-available bucket must NOT mirror to legacy User.walletBalance.
    expect(mockUserUpdateOne).not.toHaveBeenCalled();
  });

  it("throws for an insufficient chosen bucket even when other buckets could cover it", async () => {
    seedWallet({ shopping: 1000, earnings: 100, available: 1000 });

    await expect(
      debitCustomerWalletBucket({
        customerId: "cust-1",
        bucket: "earnings",
        totalAmount: 300,
        session: { id: "sess" },
      }),
    ).rejects.toThrow(/insufficient earning wallet balance/i);

    // No cascade: shopping/available untouched, no ledger, no save-debit.
    expect(walletDoc.shoppingBalance).toBe(1000);
    expect(walletDoc.availableBalance).toBe(1000);
    expect(walletDoc.earningsBalance).toBe(100);
    expect(mockCreateLedgerEntry).not.toHaveBeenCalled();
  });

  it("rejects an unknown bucket name", async () => {
    seedWallet({ shopping: 100, earnings: 100, available: 100 });
    await expect(
      debitCustomerWalletBucket({
        customerId: "cust-1",
        bucket: "bonus",
        totalAmount: 10,
        session: { id: "sess" },
      }),
    ).rejects.toThrow(/invalid wallet bucket/i);
  });
});

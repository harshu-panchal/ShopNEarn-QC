/**
 * Shared inventory movement vocabulary for hub (StockHistory) and franchise (FranchiseStockMovement).
 */

/** Hub seller StockHistory types (PascalCase for legacy enum compatibility). */
export const HUB_STOCK_TYPES = {
  RESTOCK: "Restock",
  SALE: "Sale",
  CORRECTION: "Correction",
  RESERVATION: "Reservation",
  RELEASE: "Release",
  TRANSFER_OUT: "TransferOut",
  DAMAGE: "Damage",
};

export const ALL_HUB_STOCK_TYPES = Object.values(HUB_STOCK_TYPES);

/** Franchise FranchiseStockMovement types (SCREAMING_SNAKE for franchise ledger). */
export const FRANCHISE_STOCK_TYPES = {
  TRANSFER_IN: "TRANSFER_IN",
  FULFILLMENT: "FULFILLMENT",
  POS_SALE: "POS_SALE",
  POS_SALE_EDIT_RESTORE: "POS_SALE_EDIT_RESTORE",
  POS_SALE_EDIT_DEBIT: "POS_SALE_EDIT_DEBIT",
  RETURN_IN: "RETURN_IN",
  DAMAGE: "DAMAGE",
  CORRECTION: "CORRECTION",
  RESTOCK: "RESTOCK",
};

export const ALL_FRANCHISE_STOCK_TYPES = Object.values(FRANCHISE_STOCK_TYPES);

export const INCOMING_HUB_TYPES = new Set([
  HUB_STOCK_TYPES.RESTOCK,
  HUB_STOCK_TYPES.RELEASE,
  HUB_STOCK_TYPES.CORRECTION,
]);

export const OUTGOING_HUB_TYPES = new Set([
  HUB_STOCK_TYPES.SALE,
  HUB_STOCK_TYPES.RESERVATION,
  HUB_STOCK_TYPES.TRANSFER_OUT,
  HUB_STOCK_TYPES.DAMAGE,
  HUB_STOCK_TYPES.CORRECTION,
]);

export const INCOMING_FRANCHISE_TYPES = new Set([
  FRANCHISE_STOCK_TYPES.TRANSFER_IN,
  FRANCHISE_STOCK_TYPES.RETURN_IN,
  FRANCHISE_STOCK_TYPES.RESTOCK,
  FRANCHISE_STOCK_TYPES.CORRECTION,
]);

export const OUTGOING_FRANCHISE_TYPES = new Set([
  FRANCHISE_STOCK_TYPES.FULFILLMENT,
  FRANCHISE_STOCK_TYPES.POS_SALE,
  FRANCHISE_STOCK_TYPES.DAMAGE,
  FRANCHISE_STOCK_TYPES.CORRECTION,
]);

export function hubDirectionForType(type) {
  const t = String(type || "");
  if (INCOMING_HUB_TYPES.has(t)) return "incoming";
  if (OUTGOING_HUB_TYPES.has(t)) return "outgoing";
  return "neutral";
}

export function franchiseDirectionForType(type) {
  const t = String(type || "");
  if (INCOMING_FRANCHISE_TYPES.has(t)) return "incoming";
  if (OUTGOING_FRANCHISE_TYPES.has(t)) return "outgoing";
  return "neutral";
}

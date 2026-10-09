/** Public data availability, independent from permissionless redemption. */
import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";
import { valuationQuality } from "./valuation-quality.js";

export interface BasketDataQuality {
  status: "ready" | "pending" | "unavailable";
  reasons: Array<{ code: string; message: string }>;
  valuation: { eligible: boolean; reason: string | null; missingPriceMints: string[] };
  recovery: { required: boolean; pendingSignatures: number; quarantinedSignatures: number };
}
const messages: Record<string, string> = {
  "no-prices": "USD value is unavailable for these tokens.",
  "incomplete-prices": "Some token prices are unavailable.",
  "prices-unavailable": "Token prices are temporarily unavailable.",
  "incomplete-holdings": "Basket balances are still being verified.",
  "unauthenticated-supply": "Basket share supply is still being verified.",
  "inputs-expired-during-read": "Basket values are being refreshed.",
  "invalid-constituents": "Basket details could not be verified.",
  "stale": "Basket values are being refreshed.",
};
const count = (value: unknown): number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export function basketDataQuality(row: Record<string, unknown>, now = new Date()): BasketDataQuality {
  const quality = valuationQuality({ ...row, ts: row.nav_as_of ?? row.ts }, now);
  const pending = count(row.pending_signatures), quarantined = count(row.quarantined_signatures);
  const required = row.recovery_required === true;
  const reasons: BasketDataQuality["reasons"] = [];
  if (required) reasons.push({ code: "position-rebuild-required", message: "Balance history is being verified." });
  if (quarantined > 0) reasons.push({ code: "history-incomplete", message: "Some transaction history is unavailable." });
  else if (pending > 0) reasons.push({ code: "history-pending", message: "Transaction history is catching up." });
  const reason = quality.eligible ? null : (Object.hasOwn(messages, quality.status) ? quality.status : "valuation-unavailable");
  if (reason) reasons.push({ code: reason, message: messages[reason] ?? "USD value is not available yet." });
  const priceMints = Array.isArray(row.missing_price_mints) ? row.missing_price_mints.filter((value): value is string => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)).slice(0,20) : [];
  return {
    status: quality.eligible && reasons.length === 0 ? "ready" : required || pending > 0 || quarantined > 0 ? "pending" : "unavailable",
    reasons,
    valuation: { eligible: quality.eligible, reason, missingPriceMints: priceMints },
    recovery: { required, pendingSignatures: pending, quarantinedSignatures: quarantined },
  };
}

/** Source identifiers only. Never interpolate request data into these fragments. */
export function basketRecoverySql(basket: "b.pubkey" | "$1"): string {
  // Imported here to keep public messages entirely independent from database text.
  if (basket !== "b.pubkey" && basket !== "$1") throw new Error("Invalid recovery basket expression");
  return `EXISTS(SELECT 1 FROM position_rebuild_required pr WHERE pr.basket=${basket} AND
    ${unresolvedPositionRebuildCondition("pr")}) AS recovery_required,
    (SELECT COUNT(*)::int FROM indexer_signature_queue WHERE status='pending') AS pending_signatures,
    (SELECT COUNT(*)::int FROM indexer_signature_queue WHERE status='quarantined') AS quarantined_signatures`;
}

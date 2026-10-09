/** Indexed USD values require explicit current eligibility, independently of wallet/RPC access. */
export interface BasketDataQuality {
  status: "ready" | "pending" | "unavailable";
  reasons: { code: string; message: string }[];
  valuation: { eligible: boolean; reason: string | null; missingPriceMints: string[] };
  recovery: { required: boolean; pendingSignatures: number; quarantinedSignatures: number };
}

const UNKNOWN_MESSAGE = "Price and return data are not available yet.";
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const message = (value: unknown): string | null => typeof value === "string" && value.trim().length > 0 &&
  value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;

/** Unknown/malformed new evidence never falls back to an older eligible value. */
export function parseBasketDataQuality(value: unknown, legacy?: unknown, priceSource?: unknown): BasketDataQuality {
  const unknown: BasketDataQuality = {
    status: "unavailable", reasons: [{ code: "unknown", message: UNKNOWN_MESSAGE }],
    valuation: { eligible: false, reason: "unknown", missingPriceMints: [] },
    recovery: { required: false, pendingSignatures: 0, quarantinedSignatures: 0 },
  };
  if (hasMockPriceSource(priceSource)) return {
    ...unknown, reasons: [{ code: "mock-price", message: "These test tokens have no USD market price." }],
    valuation: { ...unknown.valuation, reason: "mock-price" },
  };
  if (value === undefined) {
    const old = record(legacy);
    if (old?.eligible === true && old.complete === true && old.status === "complete" && old.stale === false) {
      return { ...unknown, status: "ready", reasons: [], valuation: { ...unknown.valuation, eligible: true, reason: null } };
    }
    return unknown;
  }
  const input = record(value), valuation = record(input?.valuation), recovery = record(input?.recovery);
  if (!input || !["ready", "pending", "unavailable"].includes(String(input.status)) ||
    !Array.isArray(input.reasons) || !valuation || typeof valuation.eligible !== "boolean" ||
    !(valuation.reason === null || typeof valuation.reason === "string") || !Array.isArray(valuation.missingPriceMints) ||
    !valuation.missingPriceMints.every(mint => typeof mint === "string") ||
    !recovery || typeof recovery.required !== "boolean" || !count(recovery.pendingSignatures) || !count(recovery.quarantinedSignatures)) return unknown;
  const reasons = input.reasons.slice(0, 8).flatMap(item => {
    const reason = record(item), text = message(reason?.message);
    return text && typeof reason?.code === "string" && /^[a-z0-9_-]{1,80}$/i.test(reason.code)
      ? [{ code: reason.code, message: text }] : [];
  });
  const status = input.status as BasketDataQuality["status"];
  const eligible = status === "ready" && valuation.eligible === true && !recovery.required &&
    recovery.pendingSignatures === 0 && recovery.quarantinedSignatures === 0;
  return {
    status: eligible ? "ready" : status === "ready" ? "unavailable" : status,
    reasons: reasons.length || eligible ? reasons : [{ code: "unknown", message: status === "pending" ? "Basket data are still being checked." : UNKNOWN_MESSAGE }],
    valuation: { eligible, reason: valuation.reason as string | null, missingPriceMints: valuation.missingPriceMints as string[] },
    recovery: { required: recovery.required, pendingSignatures: recovery.pendingSignatures, quarantinedSignatures: recovery.quarantinedSignatures },
  };
}

/** One short explanation per basket; detail can disclose the remaining public reasons. */
export function basketDataMessage(quality: BasketDataQuality): string | null {
  return quality.valuation.eligible ? null : quality.reasons[0]?.message ?? UNKNOWN_MESSAGE;
}

/** A mock price can never establish a market value, even in an older payload. */
export function hasMockPriceSource(value: unknown): boolean {
  if (typeof value === "string") return /(^|[^a-z])mock(?::|$)/i.test(value);
  if (Array.isArray(value)) return value.some(hasMockPriceSource);
  const obj = record(value);
  return obj ? Object.values(obj).some(hasMockPriceSource) : false;
}

export type IndexedDataState = { state: "on" | "off" | "unknown"; label: string; message: string | null };
/** API liveness does not establish that indexed balances or prices are complete. */
export function indexedDataState(payload: unknown): IndexedDataState {
  const data = record(payload);
  if (!data || typeof data.ready !== "boolean" || typeof data.projectionReady !== "boolean")
    return { state: "unknown", label: "Indexed data unknown", message: "Current basket data could not be checked." };
  if (!data.ready) return { state: "off", label: "Indexed data unavailable", message: "Basket data are temporarily unavailable. Direct devnet withdrawal remains available." };
  if (!data.projectionReady) return { state: "off", label: "Indexed data catching up", message: "Some indexed balances are still being checked. USD values depend on verified prices for each basket." };
  return { state: "on", label: "Indexed balances ready", message: "USD values depend on verified prices for each basket." };
}

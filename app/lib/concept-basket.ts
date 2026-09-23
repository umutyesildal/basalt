import { getConceptAsset } from "@/lib/concept-assets";

/** Public, wallet-free basket shape used by the hackathon concept preview. */
export interface ConceptBasket {
  v: 1;
  name: string;
  thesis: string;
  assets: { symbol: string; weightBps: number }[];
  amountUsd: number;
  fees: { entryBps: number; exitBps: number; managementBps: number };
}

export const CONCEPT_BASKET_LIMITS = {
  minAssets: 2,
  maxAssets: 20,
  maxNameLength: 60,
  maxThesisLength: 240,
  maxAmountUsd: 1_000_000,
  maxEncodedLength: 4096,
  entryFeeBps: 300,
  exitFeeBps: 100,
  managementFeeBps: 300,
} as const;

export type ConceptBasketValidation =
  | { ok: true; value: ConceptBasket }
  | { ok: false; errors: string[] };

/** Validate and normalize untrusted URL or form data before it is displayed. */
export function validateConceptBasket(input: unknown): ConceptBasketValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["The basket data is missing or malformed."] };
  }

  const value = input as Record<string, unknown>;
  const errors: string[] = [];
  if (value.v !== 1) errors.push("This preview link uses an unsupported version.");
  if (typeof value.name !== "string" || value.name.trim().length === 0 || value.name.length > CONCEPT_BASKET_LIMITS.maxNameLength) {
    errors.push("Give the basket a name up to 60 characters.");
  }
  if (typeof value.thesis !== "string" || value.thesis.length > CONCEPT_BASKET_LIMITS.maxThesisLength) {
    errors.push("The thesis must be 240 characters or fewer.");
  }
  if (!Number.isFinite(value.amountUsd) || (value.amountUsd as number) <= 0 || (value.amountUsd as number) > CONCEPT_BASKET_LIMITS.maxAmountUsd) {
    errors.push("Choose a starting amount greater than $0 and no more than $1,000,000.");
  }

  const assets = Array.isArray(value.assets) ? value.assets : [];
  if (assets.length < CONCEPT_BASKET_LIMITS.minAssets || assets.length > CONCEPT_BASKET_LIMITS.maxAssets) {
    errors.push("A basket needs between 2 and 20 assets.");
  }
  const symbols = new Set<string>();
  let totalWeight = 0;
  for (const asset of assets) {
    if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
      errors.push("One or more assets are malformed.");
      continue;
    }
    const row = asset as Record<string, unknown>;
    if (typeof row.symbol !== "string" || !/^[A-Z][A-Z0-9.]{0,9}$/.test(row.symbol) || !getConceptAsset(row.symbol)) {
      errors.push("One or more asset symbols are invalid.");
      continue;
    }
    if (symbols.has(row.symbol)) errors.push("Each asset can appear only once.");
    symbols.add(row.symbol);
    if (!Number.isInteger(row.weightBps) || (row.weightBps as number) <= 0 || (row.weightBps as number) > 10_000) {
      errors.push("Every selected asset needs a positive allocation.");
    } else {
      totalWeight += row.weightBps as number;
    }
  }
  if (totalWeight !== 10_000) errors.push("Asset allocations must add up to 100%.");

  const fees = value.fees && typeof value.fees === "object" && !Array.isArray(value.fees)
    ? value.fees as Record<string, unknown>
    : {};
  const feeCaps: Record<string, number> = {
    entryBps: CONCEPT_BASKET_LIMITS.entryFeeBps,
    exitBps: CONCEPT_BASKET_LIMITS.exitFeeBps,
    managementBps: CONCEPT_BASKET_LIMITS.managementFeeBps,
  };
  for (const [key, cap] of Object.entries(feeCaps)) {
    const fee = fees[key];
    if (!Number.isInteger(fee) || (fee as number) < 0 || (fee as number) > cap) {
      errors.push(`${key} must be between 0% and its allowed maximum.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };

  return {
    ok: true,
    value: {
      v: 1,
      name: (value.name as string).trim(),
      thesis: (value.thesis as string).trim(),
      assets: assets.map((asset) => {
        const row = asset as Record<string, unknown>;
        return { symbol: row.symbol as string, weightBps: row.weightBps as number };
      }),
      amountUsd: value.amountUsd as number,
      fees: {
        entryBps: fees.entryBps as number,
        exitBps: fees.exitBps as number,
        managementBps: fees.managementBps as number,
      },
    },
  };
}

export function isConceptBasket(input: unknown): input is ConceptBasket {
  return validateConceptBasket(input).ok;
}

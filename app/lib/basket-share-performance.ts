import { MAX_CLOSE_AGE_DAYS, MODEL_BASE_DATE, marketDate, type BasketPerformanceResponse } from "@/lib/basket-performance";
import { getConceptAsset, hasConceptAssetIdentityConflict } from "@/lib/concept-assets";
import type { ConceptBasket } from "@/lib/concept-basket";
import { CONCEPT_BASKETS, type ConceptBasketSample } from "@/lib/concept-samples";

export interface BasketSharePerformance {
  basketId: string;
  /** Percentage points, already ready for formatPercent; never multiply by 100. */
  return7dPct: number;
  asOf: string;
  windowStart: string;
}

/** A shared draft only inherits a published model for the exact named mix. */
export function findBasketPerformanceSample(basket: ConceptBasket): ConceptBasketSample | undefined {
  if (new Set(basket.assets.map((asset) => asset.symbol)).size !== basket.assets.length) return undefined;
  return CONCEPT_BASKETS.find((sample) => sample.name === basket.name && sample.assets.length === basket.assets.length &&
    sample.assets.every((asset) => basket.assets.some((candidate) => candidate.symbol === asset.symbol &&
      candidate.weightBps === asset.weightBps && (candidate.mint === undefined ||
        (getConceptAsset(candidate.symbol, candidate.mint)?.symbol === asset.symbol &&
          !hasConceptAssetIdentityConflict(candidate.symbol, candidate.mint))))));
}

const DAY_MS = 86_400_000;
function day(date: string | null): number | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date ? timestamp / DAY_MS : null;
}

/** Only server-sourced, complete seven-day model evidence belongs in an image. */
export function getBasketSharePerformance(
  basket: ConceptBasket,
  response: BasketPerformanceResponse | null | undefined,
): BasketSharePerformance | null {
  const sample = findBasketPerformanceSample(basket);
  if (!sample || !response || (response.status !== "ready" && response.status !== "partial") || response.source !== "Yahoo Finance" ||
    response.baseValue !== 100 || !Array.isArray(response.items)) return null;
  const matches = response.items.filter((item) => item.basketId === sample.id);
  if (matches.length !== 1) return null;
  const item = matches[0];
  if (item.status !== "ready" || typeof item.return7dPct !== "number" || !Number.isFinite(item.return7dPct) ||
    typeof item.modelPrice !== "number" || !Number.isFinite(item.modelPrice) || item.modelPrice <= 0 ||
    item.asOf !== response.asOf || item.windowStart !== response.windowStart) return null;

  const asOf = day(item.asOf), windowStart = day(item.windowStart), base = day(response.baseDate);
  const fetchedAt = Date.parse(response.fetchedAt);
  if (asOf === null || windowStart === null || base === null || !Number.isFinite(fetchedAt)) return null;
  const anchor = day(MODEL_BASE_DATE)!;
  const today = day(marketDate(fetchedAt))!;
  const baselineGap = asOf - 7 - windowStart;
  // Use the model's completed-close policy and its fetch clock, including
  // weekend/holiday tolerance, without inventing a second rolling baseline.
  if (base < anchor || base - anchor > MAX_CLOSE_AGE_DAYS || windowStart < base ||
    asOf > today || today - asOf > MAX_CLOSE_AGE_DAYS || baselineGap < 0 || baselineGap > MAX_CLOSE_AGE_DAYS) return null;
  return { basketId: sample.id, return7dPct: item.return7dPct, asOf: item.asOf!, windowStart: item.windowStart! };
}

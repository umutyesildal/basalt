import bs58 from "bs58";
import { parseBasketDataQuality } from "./basket-data-quality";
import { scaledFromRaw } from "./format";

const U64_MAX = (1n << 64n) - 1n;
const MAX_POSITIONS = 1000;

export interface BalanceEvidence {
  slot: number;
  observedAt: string;
  historyComplete: false;
  costBasisKnown: false;
}

export interface PortfolioPosition {
  basket: string;
  share_balance: string;
  kind: "snapshot" | "indexed";
  balanceEvidence: BalanceEvidence | null;
  estimatedValue: number | null;
  asOf: string | null;
}

export interface PortfolioCoverage {
  indexedBaskets: number;
  verifiedBaskets: number;
  complete: boolean;
}

export interface PortfolioData {
  positions: PortfolioPosition[];
  coverage: PortfolioCoverage | null;
  withheldPositions: number;
  source: string | null;
  asOf: string | null;
  totalValue: number | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function basketKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return false;
  try { return bs58.decode(value).length === 32; } catch { return false; }
}

function rawShares(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d{0,19})$/.test(value) && BigInt(value) <= U64_MAX;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value ? value : null;
}

function positiveUsd(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,63})(?:\.\d{1,64})?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCoverage(value: unknown): PortfolioCoverage | null {
  const input = record(value);
  if (!input || !count(input.indexedBaskets) || !count(input.verifiedBaskets) ||
    input.verifiedBaskets > input.indexedBaskets || typeof input.complete !== "boolean" ||
    input.complete !== (input.indexedBaskets > 0 && input.verifiedBaskets === input.indexedBaskets)) return null;
  return { indexedBaskets: input.indexedBaskets, verifiedBaskets: input.verifiedBaskets, complete: input.complete };
}

function parsePosition(value: unknown): PortfolioPosition | null {
  const row = record(value);
  if (!row || !basketKey(row.basket) || !rawShares(row.share_balance)) return null;
  if (row.projectionStatus === "snapshot-verified" && row.source === "finalized-balance-snapshot") {
    const evidence = record(row.balanceEvidence);
    const observedAt = timestamp(evidence?.observedAt);
    if (!evidence || !count(evidence.slot) || !observedAt ||
      evidence.historyComplete !== false || evidence.costBasisKnown !== false) return null;
    return { basket: row.basket, share_balance: row.share_balance, kind: "snapshot",
      balanceEvidence: { slot: evidence.slot, observedAt, historyComplete: false, costBasisKnown: false },
      // A balance snapshot does not establish transaction costs or a USD valuation.
      estimatedValue: null, asOf: observedAt };
  }
  if (row.projectionStatus !== "indexed" || row.source !== "onchain-indexed" ||
    row.projection_pending === true || row.legacy_projection_pending === true) return null;
  const eligible = parseBasketDataQuality(row.dataQuality, row.quality, row.price_source).valuation.eligible;
  return { basket: row.basket, share_balance: row.share_balance, kind: "indexed", balanceEvidence: null,
    estimatedValue: eligible ? positiveUsd(row.estimatedValue) : null, asOf: timestamp(row.asOf) };
}

/** Parse row evidence independently of optional basket-name/composition enrichment. */
export function parsePortfolioData(value: unknown): PortfolioData {
  const payload = record(value), input = payload?.data;
  const coverage = parseCoverage(payload?.coverage);
  const positions: PortfolioPosition[] = [];
  let withheldPositions = 0;
  if (!Array.isArray(input) || input.length > MAX_POSITIONS) {
    return { positions, coverage: null, withheldPositions: 1, source: null, asOf: null, totalValue: null };
  }
  const occurrences = new Map<string, number>();
  for (const item of input) {
    const basket = record(item)?.basket;
    if (typeof basket === "string") occurrences.set(basket, (occurrences.get(basket) ?? 0) + 1);
  }
  for (const item of input) {
    const row = parsePosition(item);
    if (!row || occurrences.get(row.basket) !== 1) { withheldPositions++; continue; }
    if (row.share_balance !== "0") positions.push(row);
  }
  const snapshotCount = positions.filter(row => row.kind === "snapshot").length;
  const source = positions.length
    ? snapshotCount === positions.length ? "finalized balances" : snapshotCount ? "finalized balances + indexed history" : "indexed history"
    : coverage && coverage.verifiedBaskets > 0 ? "finalized balances" : null;
  const dates = positions.map(row => row.asOf);
  const asOf = dates.length && dates.every((date): date is string => date !== null)
    ? dates.reduce((oldest, date) => date < oldest ? date : oldest) : null;
  // An incomplete subset must never be labelled as the wallet's total value.
  const allPriced = positions.length > 0 && positions.every(row => row.estimatedValue !== null);
  const sum = allPriced ? positions.reduce((total, row) => total + row.estimatedValue!, 0) : NaN;
  const totalValue = coverage?.complete && withheldPositions === 0 && Number.isFinite(sum) ? sum : null;
  return { positions, coverage, withheldPositions, source, asOf, totalValue };
}

/** Fixed six-decimal share units, preserving every raw u64 digit. */
export function portfolioShareAmount(raw: string): string {
  if (!rawShares(raw)) return "—";
  const [integer, fraction] = scaledFromRaw(raw, 1, 6).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function portfolioCoverageMessage(data: PortfolioData): string {
  const coverage = data.coverage;
  if (!coverage) return "Current balance coverage is unavailable. An empty list does not establish that this wallet has no holdings.";
  const progress = `${coverage.verifiedBaskets} of ${coverage.indexedBaskets} indexed baskets checked at finalized slots.`;
  return coverage.complete && data.withheldPositions === 0 ? progress : `${progress} Current balance verification is incomplete.`;
}

export function portfolioEmptyState(data: PortfolioData): { chip: string; title: string; description: string } {
  if (data.coverage?.complete && data.withheldPositions === 0) return {
    chip: "CHECKED BASKETS", title: "No shares in checked baskets",
    description: `No basket shares were found for this wallet across the ${data.coverage.indexedBaskets} indexed baskets checked at finalized slots. This covers indexed baskets only.`,
  };
  return { chip: "INCOMPLETE", title: "Balances not fully verified",
    description: "No verified positions are available yet. Current balance verification is incomplete, so this does not establish that your wallet has no holdings." };
}

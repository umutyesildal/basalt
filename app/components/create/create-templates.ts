/**
 * create-templates.ts — "Start from template" presets for the Create wizard
 * (Dalga 3).
 *
 * This is the honest adaptation of the Cesto /labs/create embedded-template
 * pattern (docs/cesto-analiz/03-akislar-etkilesim-infra.md §5.3): presets
 * one-click-fill the wizard state. On Basalt a template is NOT a
 * recommendation or advice — it is a pre-configuration derived from tickers
 * that actually exist in the whitelist. Resolution runs against the live
 * GET /api/v1/whitelist rows at apply time: a ticker that is not an Active
 * whitelist row marks the template card unavailable instead of being silently
 * dropped, and no ticker outside the whitelist is ever invented here.
 *
 * Tickers are written with the backend catalog symbols from
 * backend/src/catalog/mockStocks.ts MOCK_XSTOCKS ("NVDAx"). Matching is
 * suffix-tolerant on purpose: the mock whitelist price_source ("mock:nvda")
 * renders the display ticker "NVDA" while a mainnet xStocks source
 * ("jupiter:NVDAx") renders "NVDAx" — both must resolve to the same template
 * row.
 *
 * Names are ours; no Cesto template names are copied.
 *
 * Fees mirror the wizard's own defaults (create-client.tsx initial state:
 * entry 100 / exit 50 / management 200 bps — all inside the on-chain caps
 * 300/100/300). A template only pre-fills; every field stays editable.
 */

import { tickerFromRow, type ConstituentDraft, type WhitelistRow } from "./types";

export interface TemplateConstituent {
  /** Catalog symbol, e.g. "NVDAx" (see module doc — matching is suffix-tolerant). */
  readonly ticker: string;
  /** Target weight in bps; every template sums to exactly 10,000. */
  readonly weightBps: number;
}

export interface TemplateFees {
  readonly entryFeeBps: number;
  readonly exitFeeBps: number;
  readonly managementFeeBps: number;
}

export interface CreateTemplate {
  readonly id: string;
  readonly name: string;
  /** One line, factual — no performance language. */
  readonly tagline: string;
  readonly constituents: readonly TemplateConstituent[];
  readonly fees: TemplateFees;
}

/** Wizard-default fees shared by every template (prefill only, not a claim). */
const WIZARD_DEFAULT_FEES: TemplateFees = {
  entryFeeBps: 100,
  exitFeeBps: 50,
  managementFeeBps: 200,
};

/**
 * The four templates — every ticker is in MOCK_XSTOCKS, every weight set
 * sums to exactly 10,000 bps (weights are asserted by the wizard's own
 * step-2 validation when applied).
 */
export const CREATE_TEMPLATES: readonly CreateTemplate[] = [
  {
    id: "mega-cap-tech",
    name: "Mega-Cap Tech",
    tagline: "Three US mega-cap technology names, equal weight.",
    // 3333 + 3333 + 3334 = 10,000
    constituents: [
      { ticker: "NVDAx", weightBps: 3333 },
      { ticker: "AAPLx", weightBps: 3333 },
      { ticker: "MSFTx", weightBps: 3334 },
    ],
    fees: WIZARD_DEFAULT_FEES,
  },
  {
    id: "index-core",
    name: "Index Core",
    tagline: "SPYx-led core with a small NVDAx tilt.",
    // Not "SPYx 100%": the factory (and step-1 validation) requires 2–20
    // constituents, so a single-stock preset would permanently block the
    // wizard. The tilt keeps the preset deployable; weights still sum
    // 8500 + 1500 = 10,000.
    constituents: [
      { ticker: "SPYx", weightBps: 8_500 },
      { ticker: "NVDAx", weightBps: 1_500 },
    ],
    fees: WIZARD_DEFAULT_FEES,
  },
  {
    id: "motion",
    name: "Motion",
    tagline: "High-beta pair — TSLAx leads, COINx follows.",
    // 6000 + 4000 = 10,000
    constituents: [
      { ticker: "TSLAx", weightBps: 6_000 },
      { ticker: "COINx", weightBps: 4_000 },
    ],
    fees: WIZARD_DEFAULT_FEES,
  },
  {
    id: "mag-six",
    name: "Mag Six",
    tagline: "Six US mega-caps, tilted toward the largest weights.",
    // Mirrors DEVNET_FLAGSHIP_BASKET (backend/src/catalog/mockStocks.ts):
    // 2500 + 2000 + 1500 + 1500 + 1250 + 1250 = 10,000
    constituents: [
      { ticker: "NVDAx", weightBps: 2_500 },
      { ticker: "AAPLx", weightBps: 2_000 },
      { ticker: "MSFTx", weightBps: 1_500 },
      { ticker: "METAx", weightBps: 1_500 },
      { ticker: "AMZNx", weightBps: 1_250 },
      { ticker: "GOOGLx", weightBps: 1_250 },
    ],
    fees: WIZARD_DEFAULT_FEES,
  },
];

export interface ResolvedTemplatePart {
  /** Template ticker as written above ("NVDAx"). */
  readonly ticker: string;
  /** Display ticker from the resolved whitelist row; falls back to `ticker`. */
  readonly displayTicker: string;
  readonly weightBps: number;
  /** Whitelist mint, or null when the ticker has no Active row. */
  readonly mint: string | null;
}

export interface ResolvedTemplate {
  readonly parts: readonly ResolvedTemplatePart[];
  /** Drafts for the parts that resolved to Active whitelist rows. */
  readonly drafts: ConstituentDraft[];
  /** Template tickers with no Active whitelist row — cards must stay disabled. */
  readonly unavailable: readonly string[];
}

/** Suffix-tolerant comparison key: "NVDAx" and "NVDA" both normalize to "NVDA". */
function baseTickerKey(ticker: string): string {
  const t = ticker.trim().toUpperCase();
  return t.length > 1 && t.endsWith("X") ? t.slice(0, -1) : t;
}

/**
 * Map a template onto the live whitelist. Only Active rows can enter a
 * basket (the factory rejects the rest with MintNotActive), so a template
 * ticker missing an Active row lands in `unavailable` — the caller disables
 * the card rather than applying a partial (misrepresenting) composition.
 */
export function resolveTemplate(
  template: CreateTemplate,
  rows: readonly WhitelistRow[],
): ResolvedTemplate {
  const byBase = new Map<string, WhitelistRow>();
  for (const row of rows) {
    if (row.status !== "Active") continue;
    byBase.set(baseTickerKey(tickerFromRow(row)), row);
  }

  const parts: ResolvedTemplatePart[] = [];
  const drafts: ConstituentDraft[] = [];
  const unavailable: string[] = [];

  for (const part of template.constituents) {
    const row = byBase.get(baseTickerKey(part.ticker));
    if (!row) {
      unavailable.push(part.ticker);
      parts.push({ ticker: part.ticker, displayTicker: part.ticker, weightBps: part.weightBps, mint: null });
      continue;
    }
    const displayTicker = tickerFromRow(row);
    parts.push({ ticker: part.ticker, displayTicker, weightBps: part.weightBps, mint: row.mint });
    drafts.push({
      mint: row.mint,
      ticker: displayTicker,
      decimals: row.decimals,
      weightBps: part.weightBps,
      seedRaw: 0n,
      priceRef: null,
    });
  }

  return { parts, drafts, unavailable };
}

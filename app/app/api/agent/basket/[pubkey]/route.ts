/**
 * Agent-facing basket view — GET /api/agent/basket/[pubkey]
 *
 * One basket rendered as `text/markdown` for AI agents (ZCode/Claude/Cursor…):
 * identity, composition, fees, latest NAV, recent verified trades, and an
 * explicit provenance line. Data comes from the same REST hooks the UI uses
 * (base URL from NEXT_PUBLIC_API via lib/api-client.ts — every path stays a
 * literal `/api/v1/...` string with the pubkey encodeURIComponent'd).
 *
 * Honesty contract (mirrors the backend): nothing is fabricated. An
 * unindexed basket is a 404 (NOT_INDEXED), a down indexer is a 503
 * (DB_UNAVAILABLE) — both answered as markdown so agents can read them.
 * Absence of trades on the latest feed page is stated as exactly that.
 *
 * See /basalt-agent-guide.md for the full reading instructions.
 */

import { apiFetch } from "@/lib/api-client";
import {
  formatAsOf,
  formatBpsAsPercent,
  formatTokenAmount,
  formatUsd,
  truncateAddress,
} from "@/lib/format";
import { PROTOCOL_FEE_SPLIT_LABEL } from "@/lib/protocol-policy";

export const dynamic = "force-dynamic";

const MARKDOWN_HEADERS: Record<string, string> = {
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "no-store",
};

/** Solana base58 pubkey shape (32-44 chars, base58 alphabet). */
const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Basket share mints are fixed 6 decimals, no ScaledUiAmount multiplier. */
const SHARE_MINT_DECIMALS = 6;

const MAX_RECENT_TRADES = 5;
const FEED_PAGE_LIMIT = 50; // backend clamps /feed limit to 50

interface NavSnapshot {
  value?: string;
  supply?: string;
  sharePrice?: string;
  asOf?: string;
  source?: string;
}

/** Defensive mirror of the backend GET /baskets/:pubkey payload. */
interface BasketDetail {
  pubkey?: string;
  creator?: string;
  share_mint?: string;
  created_at?: string;
  metadata_json?: unknown;
  constituents?: unknown;
  weights_bps?: unknown;
  entry_fee_bps?: number;
  exit_fee_bps?: number;
  management_fee_bps?: number;
  nav?: NavSnapshot | null;
  source?: string;
  asOf?: string | null;
}

interface WhitelistRow {
  mint?: string;
  ticker?: string;
  price_source?: string;
}

interface FeedTradeItem {
  kind?: string;
  ts?: string;
  wallet?: string;
  basket?: string;
  sig?: string;
  type?: string;
  shares?: number;
  usdValue?: number | null;
}

/** md-safe single-line text (pipes and newlines flattened). */
function line(value: string): string {
  return value.replace(/[\r\n|]+/g, " ").trim();
}

function metaObj(mj: unknown): Record<string, unknown> | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/** Share units from a raw share-balance string; null when not parseable. */
function shareUnits(raw: string): number | null {
  try {
    const units = Number(BigInt(raw)) / 10 ** SHARE_MINT_DECIMALS;
    return Number.isFinite(units) ? units : null;
  } catch {
    return null;
  }
}

function tickerFromWhitelist(row: WhitelistRow): string | null {
  const fromField = typeof row.ticker === "string" ? row.ticker.trim() : "";
  const fromSource =
    typeof row.price_source === "string" ? row.price_source.split(":").pop() ?? "" : "";
  const raw = fromField || fromSource;
  if (!raw) return null;
  // Same display rule as prettyTicker — inlined to keep this module server-only.
  return /^[a-z0-9_-]+$/.test(raw) ? raw.toUpperCase() : raw;
}

async function fetchJson<T>(path: string): Promise<{ res: Response; payload: T | null }> {
  const res = await apiFetch(path, { cache: "no-store", headers: { accept: "application/json" } });
  let payload: T | null = null;
  try {
    payload = (await res.json()) as T;
  } catch {
    payload = null;
  }
  return { res, payload };
}

/** Basket detail, or an error response ready to send (markdown, honest code). */
async function loadDetail(
  pubkey: string,
): Promise<{ detail: BasketDetail } | { error: Response }> {
  let res: Response;
  let payload: { data?: BasketDetail; error?: { code?: string; message?: string } } | null;
  try {
    const out = await fetchJson<{ data?: BasketDetail; error?: { code?: string; message?: string } }>(
      `/api/v1/baskets/${encodeURIComponent(pubkey)}`,
    );
    res = out.res;
    payload = out.payload;
  } catch {
    return {
      error: new Response(
        [
          "# Basket unavailable",
          "",
          `The Basalt API did not respond while fetching basket \`${pubkey}\`.`,
          "The indexer is a read-only convenience — on-chain mint and redeem still work.",
          "No data is fabricated in its place.",
          "",
        ].join("\n"),
        { status: 502, headers: MARKDOWN_HEADERS },
      ),
    };
  }
  if (!res.ok) {
    const code = payload?.error?.code ?? "";
    const message = payload?.error?.message ?? `API responded with HTTP ${res.status}`;
    const status =
      code === "NOT_INDEXED" ? 404 : code === "DB_UNAVAILABLE" ? 503 : res.status >= 400 ? res.status : 502;
    const headline =
      code === "NOT_INDEXED"
        ? "Basket not indexed"
        : code === "DB_UNAVAILABLE"
          ? "Indexer unavailable"
          : "Basket unavailable";
    return {
      error: new Response(
        [
          `# ${headline}`,
          "",
          `Code: \`${code || "UNKNOWN"}\` — ${line(message)}`,
          "",
          code === "NOT_INDEXED"
            ? "This backend has no row for this pubkey. NOT_INDEXED means \"not in the indexer\", not \"does not exist\" — verify the basket on-chain before drawing conclusions."
            : "Indexed views are unavailable right now. On-chain mint and redeem still work; retry later. No data is fabricated in the meantime.",
          "",
        ].join("\n"),
        { status, headers: MARKDOWN_HEADERS },
      ),
    };
  }
  const detail = payload?.data;
  if (!detail || typeof detail !== "object") {
    return {
      error: new Response(
        "# Basket unavailable\n\nThe API returned an empty payload for this basket.\n\n",
        { status: 502, headers: MARKDOWN_HEADERS },
      ),
    };
  }
  return { detail };
}

/** Optional mint→ticker map; failures degrade to truncated mints, quietly. */
async function loadTickers(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { res, payload } = await fetchJson<{ data?: WhitelistRow[] }>("/api/v1/whitelist");
    if (!res.ok) return map;
    for (const row of payload?.data ?? []) {
      if (typeof row.mint !== "string" || !row.mint) continue;
      const ticker = tickerFromWhitelist(row);
      if (ticker) map.set(row.mint, ticker);
    }
  } catch {
    // composition falls back to truncated mints — no fabrication
  }
  return map;
}

/**
 * Recent verified trades for this basket from the public trade feed (the
 * indexer's Minted/Redeemed ledger). Bounded by the feed page — the note says
 * so, because absence on this page is not evidence of inactivity.
 */
async function loadRecentTrades(pubkey: string): Promise<{ lines: string[]; note: string }> {
  const note = `Source: latest trade-feed page (limit ${FEED_PAGE_LIMIT}) — absence here is not a claim of inactivity.`;
  try {
    const { res, payload } = await fetchJson<{ items?: FeedTradeItem[] }>(
      `/api/v1/feed?type=trades&limit=${FEED_PAGE_LIMIT}`,
    );
    if (!res.ok) {
      return { lines: [], note: "Trade feed unavailable right now — rows omitted rather than guessed." };
    }
    const trades = (payload?.items ?? []).filter(
      (item) => item?.kind === "trade" && item.basket === pubkey,
    );
    const lines = trades.slice(0, MAX_RECENT_TRADES).map((t) => {
      const ts = t.ts ? formatAsOf(t.ts) : "unknown time";
      const shares = typeof t.shares === "number" && Number.isFinite(t.shares)
        ? formatTokenAmount(t.shares, { maximumFractionDigits: 6 })
        : "—";
      const usd = typeof t.usdValue === "number" && Number.isFinite(t.usdValue)
        ? ` · est. ${formatUsd(t.usdValue)}`
        : "";
      const who = typeof t.wallet === "string" && t.wallet ? truncateAddress(t.wallet, 4, 4) : "unknown wallet";
      const sig = typeof t.sig === "string" && t.sig ? ` — sig ${truncateAddress(t.sig, 6, 6)}` : "";
      return `- ${ts} · ${t.type ?? "Trade"} ${shares} shares by ${who}${usd}${sig}`;
    });
    return { lines, note };
  } catch {
    return { lines: [], note: "Trade feed unavailable right now — rows omitted rather than guessed." };
  }
}

function compositionRows(
  detail: BasketDetail,
  tickers: Map<string, string>,
): string[] {
  const mints = Array.isArray(detail.constituents)
    ? detail.constituents.filter((m): m is string => typeof m === "string")
    : [];
  const weights = Array.isArray(detail.weights_bps)
    ? detail.weights_bps.filter((w): w is number => typeof w === "number" && Number.isFinite(w))
    : [];
  const rows: string[] = [];
  mints.forEach((mint, i) => {
    const ticker = tickers.get(mint) ?? truncateAddress(mint, 4, 4);
    const bps = weights[i];
    const weight = Number.isFinite(bps)
      ? `${formatBpsAsPercent(bps)} (${bps} bps)`
      : "unknown weight";
    rows.push(`| ${line(ticker)} | ${weight} | \`${mint}\` |`);
  });
  return rows;
}

function renderBasketMarkdown(
  detail: BasketDetail,
  pubkey: string,
  tickers: Map<string, string>,
  trades: { lines: string[]; note: string },
): string {
  const meta = metaObj(detail.metadata_json);
  const name =
    typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : truncateAddress(pubkey, 6, 6);
  const description =
    typeof meta?.description === "string" && meta.description.trim() ? line(meta.description) : null;

  const shareMint =
    typeof detail.share_mint === "string" && detail.share_mint
      ? detail.share_mint
      : "unknown share mint";
  const creator =
    typeof detail.creator === "string" && detail.creator
      ? `\`${detail.creator}\``
      : "unknown creator";

  const out: string[] = [];
  out.push(`# ${line(name)} — Basalt strategy basket`);
  out.push("");
  if (description) {
    out.push(`> ${description}`);
    out.push("");
  }

  out.push("## Identity");
  out.push("");
  out.push(`- Basket: \`${pubkey}\``);
  out.push(`- Share mint: \`${shareMint}\` (Token-2022 receipt token, fixed 6 decimals)`);
  out.push(`- Creator: ${creator}`);
  if (detail.created_at) out.push(`- Created: ${formatAsOf(detail.created_at)}`);
  out.push("");

  out.push("## Composition");
  out.push("");
  const rows = compositionRows(detail, tickers);
  if (rows.length > 0) {
    out.push("| Ticker | Target weight | Constituent mint |");
    out.push("|---|---|---|");
    out.push(...rows);
  } else {
    out.push("Constituents are not readable from the indexed record — nothing is inferred.");
  }
  out.push("");

  out.push("## Fees");
  out.push("");
  const entry = typeof detail.entry_fee_bps === "number" ? detail.entry_fee_bps : null;
  const exit = typeof detail.exit_fee_bps === "number" ? detail.exit_fee_bps : null;
  const mgmt = typeof detail.management_fee_bps === "number" ? detail.management_fee_bps : null;
  out.push(`- Entry fee: ${entry !== null ? formatBpsAsPercent(entry) : "unknown"} (on mint)`);
  out.push(`- Exit fee: ${exit !== null ? formatBpsAsPercent(exit) : "unknown"} (on redeem)`);
  out.push(
    `- Management fee: ${
      mgmt !== null ? `${formatBpsAsPercent(mgmt)} per year` : "unknown"
    } — accrues by share dilution via a permissionless crank; creator/treasury split ${PROTOCOL_FEE_SPLIT_LABEL}`,
  );
  out.push("");

  out.push("## Latest NAV");
  out.push("");
  const nav = detail.nav ?? null;
  if (nav && typeof nav === "object") {
    const navValue = nav.value ? Number(nav.value) : NaN;
    const sharePrice = nav.sharePrice ? Number(nav.sharePrice) : NaN;
    const supplyUnits = nav.supply ? shareUnits(nav.supply) : null;
    out.push(`- Basket NAV: ${Number.isFinite(navValue) ? formatUsd(navValue) : "—"}`);
    out.push(
      `- Share price: ${Number.isFinite(sharePrice) ? formatUsd(sharePrice) : "—"} (reference, not a quote)`,
    );
    out.push(
      `- Share supply: ${supplyUnits !== null ? formatTokenAmount(supplyUnits) : "—"} shares`,
    );
    out.push(`- Snapshot: ${nav.asOf ? formatAsOf(nav.asOf) : "unknown time"}`);
  } else {
    out.push("No NAV snapshot indexed yet for this basket — figures are not extrapolated from constituent prices.");
  }
  out.push("");

  out.push("## Recent verified trades");
  out.push("");
  if (trades.lines.length > 0) {
    out.push(...trades.lines);
  } else {
    out.push("_No verified trades for this basket on the latest feed page._");
  }
  out.push("");
  out.push(`_${trades.note}_`);
  out.push("");

  out.push("## Provenance");
  out.push("");
  const source = detail.source ?? (nav?.source ?? null) ?? "unknown source";
  const asOf = detail.asOf ?? (nav?.asOf ?? null);
  out.push(
    `- Source: \`${source}\`${asOf ? ` · asOf ${formatAsOf(asOf)}` : ""} — read-only indexer data; the backend never signs transactions.`,
  );
  out.push(
    "- Status: Basalt is live on Solana devnet. The latest repository evidence is dated 2026-09-04 and records one single-key upgrade authority; no multisig, timelock, or current authority state is independently attested. Declared program IDs are not governance proof. Figures are informational, not investment advice. Basalt runs strategy baskets — not an ETF, not a fund.",
  );
  out.push(
    `- More: JSON detail at \`/api/v1/baskets/${pubkey}\` on the API base · reading guide at \`/basalt-agent-guide.md\` · basket page at \`/basket/${pubkey}\`.`,
  );
  out.push("");
  return out.join("\n");
}

/** GET /api/agent/basket/[pubkey] — the basket as markdown (or an honest markdown error). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pubkey: string }> },
): Promise<Response> {
  const { pubkey } = await params;

  if (!PUBKEY_RE.test(pubkey)) {
    return new Response(
      [
        "# Invalid basket address",
        "",
        `\`${pubkey.slice(0, 64)}\` is not a well-formed Solana pubkey (expected 32-44 base58 characters).`,
        "",
      ].join("\n"),
      { status: 400, headers: MARKDOWN_HEADERS },
    );
  }

  const loaded = await loadDetail(pubkey);
  if ("error" in loaded) return loaded.error;

  // Optional enrichments — both degrade quietly and never block the view.
  const [tickers, trades] = await Promise.all([loadTickers(), loadRecentTrades(pubkey)]);

  return new Response(renderBasketMarkdown(loaded.detail, pubkey, tickers, trades), {
    status: 200,
    headers: MARKDOWN_HEADERS,
  });
}

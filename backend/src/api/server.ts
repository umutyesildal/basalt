import { PROGRAM_NAMESPACES, namespaceProgramIds, namespaceSqlValues, validateNamespaceRegistry, type ProgramNamespace } from "../config/programNamespaces.js";
/**
 * Minimal API server — spec §8 + V0.1 price comparison. Wave B: every core
 * route reads the Postgres schema (db/client.ts connectFromEnv) instead of
 * in-memory arrays, carries explicit `source`/`asOf` markers, and degrades
 * honestly: empty DB ⇒ explicit empty list / 404 NOT_INDEXED; no DB ⇒ 503
 * DB_UNAVAILABLE. NO endpoint fabricates production-looking data.
 *
 * Run: npx tsx backend/src/index.ts  (PORT=3001)
 *
 * INTEGER-SAFETY CONVENTION: BIGINT/NUMERIC columns are returned as decimal
 * STRINGS in JSON (pg returns int8/numeric as strings) — never coerced into
 * JS numbers. `multiplier` (an f64 display factor) is the one numeric field.
 */
import http from "http";
import { currentBalancesForWallet, balanceCoverageNote, type BalanceEvidence } from "./current-balances.js";
import { DEVNET_PROGRAMS, readinessReport } from "./readiness.js";
import { basketDataQuality, basketRecoverySql } from "./data-quality.js";
import { PublicKey } from "@solana/web3.js";
import { comparePrices, getChartSeries, readMockWhitelistRows } from "../workers/priceCompare.js";
import { getXStockCatalog, getCachedXStockCatalog } from "../catalog/xstocks.js";
import { JUPITER_PRICE_URL } from "../workers/priceFetch.js";
import { XStockQuoteService } from "../workers/xstockQuotes.js";
import { XStockHistoryService } from "../workers/xstockHistory.js";
import { fetchYahooSeries } from "../workers/yahooFetch.js";
import { connectFromEnv, isPgLike, type PgLike } from "../db/client.js";
import { computeDriftExact, decimalToFixedUnits, fixedUnitsToDecimalString, NAV_SCALE, type KeyValueCache } from "../workers/navEngine.js";
import {
  BASKET_RETURN_CURRENT_SQL,
  indexedShareReturnPct,
  returnSnapshot,
  snapshotIsFresh,
  snapshotTime,
} from "./basket-returns.js";
import { unresolvedPositionRebuildCondition } from "../db/projectionGuard.js";
import { navEligibilitySql, valuationQuality, currentNavEligibilitySql, positionProjectionReadySql } from "./valuation-quality.js";
import { DEVNET_FLAGSHIP_BASKET, MOCK_XSTOCKS } from "../catalog/mockStocks.js";
import { handleZapIn, handleZapOut, type QuoteContext } from "./quotes.js";
import { tryHandleSocialRoute } from "./social.js";
import { tryHandleBasketShareRoute } from "./basket-shares.js";
import { socialAuthSecret, isValidWalletPubkey } from "./auth.js";
import { JsonBodyError, readJsonBody } from "./json-body.js";
import { ApiResourceLimits, ApiResourceLimitError } from "./resource-limits.js";

export const API_VERSION = "0.1.0";

export interface SubsystemStatus {
  positionsRpc?: Record<string,unknown>;
  rpcRequests?: Record<string,unknown>;
  positionsSync?: Record<string,unknown>;
  db: { connected: boolean; schemaApplied: boolean | null };
  indexer: { enabled: boolean; running: boolean; collection?: Record<string,unknown>; rpc?: Record<string,unknown>; positionsSync?: Record<string,unknown>; discovery?: { programIds: string[]; genesisHash: string | null; finalizedSlot: number | null; completedAt: string | null } };
  navEngine: { enabled: boolean; running: boolean };
  feeCrank: { enabled: boolean; running: boolean };
  userSnapshot: { enabled: boolean; running: boolean };
}

export interface ApiContext {
  /** Postgres client (null ⇒ DB-less mode: DB routes answer 503). */
  db: PgLike | null;
  /** Optional key/value cache shared with the NAV engine + quotes. */
  cache?: KeyValueCache | null;
  /** Injectable fetch for quote tests. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Subsystem enabled/running report for /health (wired by index.ts). */
  status?: () => SubsystemStatus;
  xstockQuotes?: XStockQuoteService;
  xstockHistory?: XStockHistoryService;
  /** Resolved once at startup; the production entrypoint validates before workers start. */
  authSecret?: string;
  /** One process-local budget for this API instance (injectable for tests). */
  resourceLimits?: ApiResourceLimits;
}

// --- helpers -----------------------------------------------------------------

type Res = http.ServerResponse;

function sendJson(res: Res, status: number, payload: unknown): void {
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function sendError(res: Res, status: number, code: string, message: string, extra?: Record<string, unknown>): void {
  sendJson(res, status, { error: { code, message, ...extra } });
}

const SUPPORTED_SORTS = ["aum", "return_24h", "return_7d", "return_30d", "holders", "mint_count"] as const;
type SortKey = (typeof SUPPORTED_SORTS)[number];

const NAV_INTERVALS: Record<string, string> = {
  "1m": "60 seconds",
  "5m": "300 seconds",
  "15m": "900 seconds",
  "1h": "3600 seconds",
  "1d": "86400 seconds",
};

/**
 * nav_history queries — one FULLY STATIC literal per (bucketing × time-window)
 * variant. Every dynamic value is a bound parameter; no SQL text is ever
 * assembled from request input.
 */
const NAV_HISTORY_BIN_ALL_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        (array_agg(share_price ORDER BY ts))[1]::text AS share_price_open,
        (array_agg(share_price ORDER BY ts DESC))[1]::text AS share_price,
        COUNT(*) AS points
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $2
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_FROM_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        (array_agg(share_price ORDER BY ts))[1]::text AS share_price_open,
        (array_agg(share_price ORDER BY ts DESC))[1]::text AS share_price,
        COUNT(*) AS points
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $2 AND ts >= $3
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_TO_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        (array_agg(share_price ORDER BY ts))[1]::text AS share_price_open,
        (array_agg(share_price ORDER BY ts DESC))[1]::text AS share_price,
        COUNT(*) AS points
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $2 AND ts <= $3
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_BIN_FROM_TO_SQL = `SELECT date_bin($1::interval, ts, TIMESTAMPTZ '2000-01-01') AS bucket,
        (array_agg(nav ORDER BY ts))[1]::text AS open,
        (array_agg(nav ORDER BY ts DESC))[1]::text AS close,
        MIN(nav)::text AS low, MAX(nav)::text AS high,
        AVG(nav)::text AS avg, MAX(supply)::text AS supply,
        (array_agg(share_price ORDER BY ts))[1]::text AS share_price_open,
        (array_agg(share_price ORDER BY ts DESC))[1]::text AS share_price,
        COUNT(*) AS points
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $2 AND ts >= $3 AND ts <= $4
 GROUP BY bucket ORDER BY bucket ASC LIMIT 5000`;
const NAV_HISTORY_RAW_ALL_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_FROM_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1 AND ts >= $2
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_TO_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1 AND ts <= $2
 ORDER BY ts ASC LIMIT 5000`;
const NAV_HISTORY_RAW_FROM_TO_SQL = `SELECT ts, nav::text AS nav, supply::text AS supply, share_price::text AS share_price, price_source
 FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1 AND ts >= $2 AND ts <= $3
 ORDER BY ts ASC LIMIT 5000`;

function isValidPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
}

/**
 * Trust-boundary sanitizers for values that crossed in from HTTP input.
 * Each one re-checks the FINAL value right before it is used (throwing on
 * mismatch), so nothing unvalidated reaches the DB/fetch layer.
 */

/** Throws unless `value` is a well-formed base58 pubkey; returns it unchanged. */
function assertPubkey(value: string): string {
  if (!isValidPubkey(value)) {
    throw new Error(`invalid pubkey ${JSON.stringify(value.slice(0, 64))}`);
  }
  return value;
}

/**
 * Chart-range allowlist: the value handed to any price-fetch helper is the
 * array constant at the matched index (miss ⇒ "1mo") — the raw query string
 * itself never travels any further than this lookup.
 */
const CHART_RANGE_NAMES = ["1d", "5d", "1mo", "3mo", "6mo", "1y"] as const;

/** Valid sort query values map to themselves; anything else passes through
 * raw so listBaskets still answers 400 INVALID_SORT for it. */
const SUPPORTED_SORT_PARAMS: Record<string, string> = {
  aum: "aum",
  return_24h: "return_24h",
  return_7d: "return_7d",
  return_30d: "return_30d",
  holders: "holders",
  mint_count: "mint_count",
};

/**
 * Resolve the DB for a request: an explicit context client (wired at boot) or
 * a memoized connectFromEnv() client (null when DATABASE_URL is unset).
 */
async function resolveDb(ctx: ApiContext): Promise<PgLike | null> {
  if (ctx.db) return isPgLike(ctx.db) ? ctx.db : null;
  return await connectFromEnv();
}

// --- route implementations (exported for tests) ------------------------------

const BASKETS_LIST_SQL = `
  SELECT b.pubkey, b.creator, b.share_mint,
         b.constituents, b.weights_bps, b.metadata_json,
         cur.nav::text AS nav, cur.supply::text AS supply,
         cur.share_price::text AS share_price,
         COALESCE(r.mint_count,0) AS mint_count, r.refreshed_at, cur.ts AS nav_as_of, cur.valuation_eligible, cur.valuation_status, vq.status AS current_status, vq.reason AS current_reason, vq.missing_price_mints, ${currentNavEligibilitySql("cur.basket", "cur")} AS current_eligible,
         NOT (COALESCE(vq.status='complete' AND vq.last_complete_at=cur.ts,false) AND cur.ts <= NOW() AND cur.ts >= NOW() - interval '15 minutes') AS stale,
         CASE WHEN ${BASKET_RETURN_CURRENT_SQL} AND h24.supply > 0 AND h24.share_price > 0 AND h24.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
           THEN (cur.share_price - h24.share_price) / NULLIF(h24.share_price, 0) END AS return_24h,
         CASE WHEN ${BASKET_RETURN_CURRENT_SQL} AND h168.supply > 0 AND h168.share_price > 0 AND h168.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
           THEN (cur.share_price - h168.share_price) / NULLIF(h168.share_price, 0) END AS return_7d,
         CASE WHEN ${BASKET_RETURN_CURRENT_SQL} AND h720.supply > 0 AND h720.share_price > 0 AND h720.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
           THEN (cur.share_price - h720.share_price) / NULLIF(h720.share_price, 0) END AS return_30d,
         CASE WHEN ${positionProjectionReadySql("b.pubkey")} THEN COALESCE(h.holders,0) END AS holders,
         ${basketRecoverySql("b.pubkey")}
  FROM baskets b
  LEFT JOIN basket_rankings r ON r.pubkey=b.pubkey
  LEFT JOIN basket_valuation_state vq ON vq.basket=b.pubkey
  LEFT JOIN LATERAL (
    SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = b.pubkey ORDER BY ts DESC LIMIT 1
  ) cur ON true
  LEFT JOIN LATERAL (
    SELECT supply, share_price, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = b.pubkey
      AND ts <= cur.ts - interval '24 hours'
      AND ts >= cur.ts - interval '24 hours' - interval '1 hour' ORDER BY ts DESC LIMIT 1
  ) h24 ON true
  LEFT JOIN LATERAL (
    SELECT supply, share_price, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = b.pubkey
      AND ts <= cur.ts - interval '7 days'
      AND ts >= cur.ts - interval '7 days' - interval '1 hour' ORDER BY ts DESC LIMIT 1
  ) h168 ON true
  LEFT JOIN LATERAL (
    SELECT supply, share_price, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = b.pubkey
      AND ts <= cur.ts - interval '30 days'
      AND ts >= cur.ts - interval '30 days' - interval '1 hour' ORDER BY ts DESC LIMIT 1
  ) h720 ON true
  LEFT JOIN (
    SELECT basket, COUNT(*)::int AS holders FROM user_positions WHERE share_balance > 0 GROUP BY basket
  ) h ON h.basket = b.pubkey
`;

/** Shared WHERE — every request value is bound, never interpolated. */
const BASKETS_LIST_WHERE = `
    WHERE ($1::text IS NULL OR b.creator = $1)
      AND ($2::numeric IS NULL OR (${BASKET_RETURN_CURRENT_SQL} AND cur.nav >= $2::numeric))
      AND ($3::text IS NULL OR b.pubkey ILIKE '%' || $3 || '%' OR b.creator ILIKE '%' || $3 || '%' OR b.share_mint ILIKE '%' || $3 || '%')`;

/** Static SQL per allowlisted sort. All return fields stay fractional ratios. */
const BASKETS_LIST_SQL_BY_SORT: Record<SortKey, string> = {
  aum: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY CASE WHEN ${BASKET_RETURN_CURRENT_SQL} THEN cur.nav END DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
  return_24h: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY return_24h DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
  return_7d: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY return_7d DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
  return_30d: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY return_30d DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
  holders: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY holders DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
  mint_count: `${BASKETS_LIST_SQL}${BASKETS_LIST_WHERE}
    ORDER BY r.mint_count DESC NULLS LAST, b.pubkey ASC
    LIMIT $4`,
};

/** GET /baskets — basket_rankings matview + filters (spec §8). */
export async function listBaskets(
  db: PgLike,
  params: { sort?: string | null; creator?: string | null; minAUM?: string | null; search?: string | null; limit?: number },
): Promise<{ status: number; payload: unknown }> {
  const sortKey = (params.sort || "aum") as SortKey;
  if (!(SUPPORTED_SORTS as readonly string[]).includes(sortKey)) {
    return {
      status: 400,
      payload: {
        error: {
          code: "INVALID_SORT",
          message: `sort must be one of ${SUPPORTED_SORTS.join("|")}`,
          supported: SUPPORTED_SORTS,
        },
      },
    };
  }
  const minAUM = params.minAUM ? Number(params.minAUM) : null;
  if (params.minAUM && (!Number.isFinite(minAUM) || (minAUM ?? 0) < 0)) {
    return { status: 400, payload: { error: { code: "INVALID_MIN_AUM", message: "minAUM must be a non-negative number" } } };
  }
  // Trust boundary: free-text params are UTF-8-normalized and only ever
  // passed as bound parameters $1/$3; the executed SQL is a fully static
  // literal selected by the (validated) sort key; limit is a clamped number.
  const creator = params.creator ? Buffer.from(params.creator, "utf8").toString("utf8") : null;
  const search = params.search ? Buffer.from(params.search, "utf8").toString("utf8") : null;
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  // sortKey is validated above; the executed text is a constant per key.
  const sql = BASKETS_LIST_SQL_BY_SORT[sortKey] ?? BASKETS_LIST_SQL_BY_SORT.aum;
  const res = await db.query(sql, [creator, minAUM === null ? null : String(minAUM), search, limit]);
  const rows = res.rows as Array<Record<string, unknown>>;
  const data = rows.map((row) => {
    const quality=valuationQuality({...row,ts:row.nav_as_of});
    return {
      ...row,
      // Retained historical observations keep their asOf/quality; consumers
      // must not present them as current when eligible is false.
      source:"onchain-indexed",
      asOf:snapshotTime(row.nav_as_of),
      quality,
      dataQuality:basketDataQuality(row),
    };
  });
  return {
    status: 200,
    payload: {
      data,
      count: data.length,
      sort: sortKey,
      source: "onchain-indexed",
      note: "Indexed baskets remain visible when USD values are unavailable. Missing prices and unverified history are never fabricated.",
    },
  };
}

/** GET /baskets/:pubkey — baskets row + latest NAV + holdings + drift. */
export async function basketDetail(db: PgLike, pubkey: string): Promise<{ status: number; payload: unknown }> {
  assertPubkey(pubkey);
  const bRes = await db.query(
    `SELECT pubkey, factory, creator, treasury, share_mint, nonce, created_at,
            metadata_hash, metadata_json, num_constituents, constituents,
            weights_bps, entry_fee_bps, exit_fee_bps, management_fee_bps,
            last_fee_accrual_ts,
            (SELECT status FROM basket_valuation_state WHERE basket=$1) AS current_status,
            (SELECT reason FROM basket_valuation_state WHERE basket=$1) AS current_reason,
            (SELECT missing_price_mints FROM basket_valuation_state WHERE basket=$1) AS missing_price_mints,
            ${basketRecoverySql("$1")}
     FROM baskets WHERE pubkey = $1`,
    [pubkey],
  );
  const basket = bRes.rows[0] as Record<string, unknown> | undefined;
  if (!basket) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const navRes = await db.query(
    `SELECT nav::text AS nav, supply::text AS supply, share_price::text AS share_price,
            price_source, ts, valuation_eligible, valuation_status, (SELECT CASE WHEN status='complete' AND last_complete_at=ns.ts THEN 'complete' ELSE 'incomplete' END FROM basket_valuation_state WHERE basket=$1) AS current_status, (SELECT reason FROM basket_valuation_state WHERE basket=$1) AS current_reason FROM nav_snapshots ns WHERE ${navEligibilitySql()} AND basket = $1 ORDER BY ts DESC LIMIT 1`,
    [pubkey],
  );
  const hRes = await db.query(
    `SELECT mint, raw_amount::text AS raw_amount, multiplier::text AS multiplier,
            scaled_amount::text AS scaled_amount, decimals, updated_at, authenticated
     FROM vault_holdings WHERE basket = $1`,
    [pubkey],
  );
  const byMint = new Map(hRes.rows.map((row) => [row.mint, row]));
  const holdings = ((basket.constituents as string[]) ?? []).map((mint) => byMint.get(mint)).filter((row): row is Record<string, any> => Boolean(row));
  const weights = (basket.weights_bps as number[]) ?? [];
  const holdingsComplete = holdings.length === weights.length && holdings.every((h) => h.authenticated === true && Date.now() - new Date(h.updated_at).getTime() >= 0 && Date.now() - new Date(h.updated_at).getTime() <= 300_000);
  const drift = holdingsComplete ? computeDriftExact(holdings.map((h) => h.scaled_amount), weights) : null;
  const navRow = (navRes.rows[0] ?? null) as Record<string, unknown> | null;
  return {
    status: 200,
    payload: {
      data: {
        ...basket,
        nav: navRow
          ? {
              value: navRow.nav,
              supply: navRow.supply,
              sharePrice: navRow.share_price,
              priceSource: navRow.price_source,
              asOf: navRow.ts,
              source: "onchain-indexed",
              quality: valuationQuality({ ...navRow, current_eligible: holdingsComplete && navRow.current_status === "complete" }),
            }
          : null,
        dataQuality: basketDataQuality({ ...basket, ...(navRow ?? {}), nav_as_of: navRow?.ts, current_eligible: holdingsComplete && navRow?.current_status === "complete" }),
        drift: drift ? { actualWeightsBps: drift.actualWeightsBps, driftBps: drift.driftBps, basis: "vault_holdings.scaled_amount vs baskets.weights_bps (AGENTS §17)" } : null,
        holdings: holdings.map((h) => ({ ...h, source: "onchain-indexed" })),
        source: "onchain-indexed",
        asOf: navRow?.ts ?? (basket.created_at as string),
      },
    },
  };
}

/** GET /baskets/:pubkey/holdings — raw + multiplier + scaled + decimals. */
export async function basketHoldings(db: PgLike, pubkey: string): Promise<{ status: number; payload: unknown }> {
  assertPubkey(pubkey);
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const res = await db.query(
    `SELECT mint, raw_amount::text AS raw_amount, multiplier::text AS multiplier,
            scaled_amount::text AS scaled_amount, decimals, updated_at, authenticated
     FROM vault_holdings WHERE basket = $1 ORDER BY mint`,
    [pubkey],
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, multiplier: Number(r.multiplier), source: "onchain-indexed", asOf: r.updated_at })),
      count: rows.length,
      note: "raw_amount/scaled_amount are decimal strings (integer-safe); scaled = raw × multiplier / 10^decimals",
    },
  };
}

/** GET /baskets/:pubkey/nav/history?interval=&from=&to= */
export async function navHistory(
  db: PgLike,
  pubkey: string,
  params: { interval?: string | null; from?: string | null; to?: string | null },
): Promise<{ status: number; payload: unknown }> {
  assertPubkey(pubkey);
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (params.from) {
    fromDate = new Date(params.from);
    if (Number.isNaN(fromDate.getTime())) {
      return { status: 400, payload: { error: { code: "INVALID_TIME_RANGE", message: `from is not a valid ISO date: ${params.from}` } } };
    }
  }
  if (params.to) {
    toDate = new Date(params.to);
    if (Number.isNaN(toDate.getTime())) {
      return { status: 400, payload: { error: { code: "INVALID_TIME_RANGE", message: `to is not a valid ISO date: ${params.to}` } } };
    }
  }
  const interval = params.interval || null;
  if (interval && !NAV_INTERVALS[interval]) {
    return { status: 400, payload: { error: { code: "INVALID_INTERVAL", message: `interval must be one of ${Object.keys(NAV_INTERVALS).join("|")}`, supported: Object.keys(NAV_INTERVALS) } } };
  }

  let rows: Array<Record<string, unknown>>;
  if (interval) {
    // Bucketed series (OHLC-style aggregation per interval via date_bin).
    // Fully static SQL per time-window variant — never assembled from input.
    const binInterval = NAV_INTERVALS[interval] ?? NAV_INTERVALS["1d"];
    if (fromDate && toDate) {
      const res = await db.query(NAV_HISTORY_BIN_FROM_TO_SQL, [binInterval, pubkey, fromDate, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (fromDate) {
      const res = await db.query(NAV_HISTORY_BIN_FROM_SQL, [binInterval, pubkey, fromDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (toDate) {
      const res = await db.query(NAV_HISTORY_BIN_TO_SQL, [binInterval, pubkey, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else {
      const res = await db.query(NAV_HISTORY_BIN_ALL_SQL, [binInterval, pubkey]);
      rows = res.rows as Array<Record<string, unknown>>;
    }
  } else {
    if (fromDate && toDate) {
      const res = await db.query(NAV_HISTORY_RAW_FROM_TO_SQL, [pubkey, fromDate, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (fromDate) {
      const res = await db.query(NAV_HISTORY_RAW_FROM_SQL, [pubkey, fromDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else if (toDate) {
      const res = await db.query(NAV_HISTORY_RAW_TO_SQL, [pubkey, toDate]);
      rows = res.rows as Array<Record<string, unknown>>;
    } else {
      const res = await db.query(NAV_HISTORY_RAW_ALL_SQL, [pubkey]);
      rows = res.rows as Array<Record<string, unknown>>;
    }
  }

  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, source: "onchain-indexed" })),
      count: rows.length,
      interval: interval ?? "raw",
      source: "onchain-indexed",
    },
  };
}

/** GET /baskets/:pubkey/performance — reference share-price returns. */
export async function basketPerformance(
  db: PgLike,
  pubkey: string,
  now: () => Date = () => new Date(),
): Promise<{ status: number; payload: unknown }> {
  assertPubkey(pubkey);
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const res = await db.query(
    `WITH cur AS (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots
       WHERE ${navEligibilitySql()} AND basket = $1 ORDER BY ts DESC LIMIT 1
     )
     SELECT cur.nav::text AS latest_nav, cur.supply::text AS latest_supply,
            cur.share_price::text AS latest_share_price, cur.ts AS latest_ts, cur.valuation_eligible AS latest_valuation_eligible, cur.valuation_status AS latest_valuation_status,
            NOW() AS evaluated_at, vq.status AS current_status, vq.reason AS current_reason, ${currentNavEligibilitySql("cur.basket", "cur")} AS current_eligible,
            h24.nav::text AS b24_nav, h24.supply::text AS b24_supply,
            h24.share_price::text AS b24_share_price, h24.ts AS b24_ts, h24.valuation_eligible AS b24_valuation_eligible, h24.valuation_status AS b24_valuation_status,
            h7.nav::text AS b7d_nav, h7.supply::text AS b7d_supply,
            h7.share_price::text AS b7d_share_price, h7.ts AS b7d_ts, h7.valuation_eligible AS b7d_valuation_eligible, h7.valuation_status AS b7d_valuation_status,
            h30.nav::text AS b30d_nav, h30.supply::text AS b30d_supply,
            h30.share_price::text AS b30d_share_price, h30.ts AS b30d_ts, h30.valuation_eligible AS b30d_valuation_eligible, h30.valuation_status AS b30d_valuation_status,
            h90.nav::text AS b90d_nav, h90.supply::text AS b90d_supply,
            h90.share_price::text AS b90d_share_price, h90.ts AS b90d_ts, h90.valuation_eligible AS b90d_valuation_eligible, h90.valuation_status AS b90d_valuation_status,
            first.nav::text AS b_inception_nav, first.supply::text AS b_inception_supply,
            first.share_price::text AS b_inception_share_price, first.ts AS b_inception_ts, first.valuation_eligible AS b_inception_valuation_eligible, first.valuation_status AS b_inception_valuation_status
     FROM cur
     LEFT JOIN basket_valuation_state vq ON vq.basket=cur.basket
     LEFT JOIN LATERAL (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
       AND ts <= cur.ts - interval '24 hours'
       AND ts >= cur.ts - interval '24 hours' - interval '1 hour' ORDER BY ts DESC LIMIT 1
     ) h24 ON true
     LEFT JOIN LATERAL (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
       AND ts <= cur.ts - interval '7 days'
       AND ts >= cur.ts - interval '7 days' - interval '1 hour' ORDER BY ts DESC LIMIT 1
     ) h7 ON true
     LEFT JOIN LATERAL (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
       AND ts <= cur.ts - interval '30 days'
       AND ts >= cur.ts - interval '30 days' - interval '1 hour' ORDER BY ts DESC LIMIT 1
     ) h30 ON true
     LEFT JOIN LATERAL (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
       AND ts <= cur.ts - interval '90 days'
       AND ts >= cur.ts - interval '90 days' - interval '1 hour' ORDER BY ts DESC LIMIT 1
     ) h90 ON true
     LEFT JOIN LATERAL (
       SELECT basket, nav, supply, share_price, ts, valuation_eligible, valuation_status FROM nav_snapshots WHERE ${navEligibilitySql()} AND basket = $1
       AND supply > 0 AND nav >= 0 AND share_price > 0
       AND nav::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
       ORDER BY ts ASC LIMIT 1
     ) first ON true
     `,
    [pubkey],
  );
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const latest = row ? returnSnapshot(row, "latest_") : null;
  if (latest && (row?.current_status !== "complete" || row.current_eligible !== true)) latest.valuationEligible = false;
  if (!row || !latest || latest.nav === null || latest.ts === null) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `no usable NAV snapshots indexed yet for ${pubkey}` } } };
  }
  const evaluatedAt = snapshotTime(row.evaluated_at);
  const evaluatedNow = evaluatedAt === null ? now() : new Date(evaluatedAt);
  const periods = [
    ["24h", "b24_", 24 * 60 * 60_000],
    ["7d", "b7d_", 7 * 24 * 60 * 60_000],
    ["30d", "b30d_", 30 * 24 * 60 * 60_000],
    ["90d", "b90d_", 90 * 24 * 60 * 60_000],
    ["inception", "b_inception_", null],
  ] as const;
  const windows = Object.fromEntries(periods.map(([window, prefix, duration]) => {
    const baseline = returnSnapshot(row, prefix);
    return [window, {
      window,
      pct: indexedShareReturnPct(latest, baseline, evaluatedNow, duration),
      baselineNav: baseline.nav, // total-NAV context, not the return operand
      baselineSharePrice: baseline.sharePrice,
      baselineSupply: baseline.supply,
      baselineTs: baseline.ts,
    }];
  }));
  return {
    status: 200,
    payload: {
      data: {
        basket: pubkey,
        latest,
        windows,
        basis: "reference share-price return: (latest share_price - baseline share_price) / baseline share_price; pct is percent, share_price is USD per raw share unit",
        source: "onchain-indexed",
        asOf: latest.ts,
        stale: !latest.valuationEligible || !snapshotIsFresh(latest, evaluatedNow),
        currentStatus: row.current_status ?? "unknown",
        currentReason: row.current_reason ?? null,
      },
    },
  };
}

/**
 * Events ledger query — one fully static literal per variant; every dynamic
 * value is a bound parameter. `data` is JSONB (pg parses it to a JS object)
 * and `slot` stays a BIGINT decimal string (integer-safe convention).
 */
const EVENTS_BY_BASKET_SQL = `SELECT sig, log_index, slot, basket, type, data, ts
 FROM events WHERE log_index >= 0 AND basket = $1 ORDER BY ts DESC, slot DESC, sig ASC, log_index ASC LIMIT $2`;
const EVENTS_BY_BASKET_TYPE_SQL = `SELECT sig, log_index, slot, basket, type, data, ts
 FROM events WHERE log_index >= 0 AND basket = $1 AND type = $2 ORDER BY ts DESC, slot DESC, sig ASC, log_index ASC LIMIT $3`;

const EVENT_TYPES = ["BasketCreated", "Minted", "Redeemed", "FeeAccrued"] as const;

/**
 * GET /events?basket=&type=&limit= — the indexer `events` ledger for one
 * basket (spec §8). `basket` is required and canonicalized to base58 by the
 * handler; `type` is allowlisted against the events-table CHECK constraint;
 * `limit` is clamped to 1..500. A basket with no `baskets` row answers 404
 * NOT_INDEXED exactly like the other basket routes; an indexed basket with
 * zero events answers 200 with an explicit empty list — never fabricated.
 */
export async function basketEvents(
  db: PgLike,
  pubkey: string,
  params: { type?: string | null; limit?: number },
): Promise<{ status: number; payload: unknown }> {
  assertPubkey(pubkey);
  if (params.type && !(EVENT_TYPES as readonly string[]).includes(params.type)) {
    return {
      status: 400,
      payload: {
        error: {
          code: "INVALID_TYPE",
          message: `type must be one of ${EVENT_TYPES.join("|")}`,
          supported: EVENT_TYPES,
        },
      },
    };
  }
  if (params.limit !== undefined && (!Number.isFinite(params.limit) || !Number.isInteger(params.limit))) {
    return { status: 400, payload: { error: { code: "INVALID_LIMIT", message: "limit must be an integer" } } };
  }
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const exists = await db.query("SELECT 1 FROM baskets WHERE pubkey = $1", [pubkey]);
  if (exists.rows.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `basket ${pubkey} is not indexed by this backend` } } };
  }
  const res = params.type
    ? await db.query(EVENTS_BY_BASKET_TYPE_SQL, [pubkey, params.type, limit])
    : await db.query(EVENTS_BY_BASKET_SQL, [pubkey, limit]);
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, source: "onchain-indexed", asOf: r.ts })),
      count: rows.length,
      basket: pubkey,
      ...(params.type ? { type: params.type } : {}),
      limit,
      source: "onchain-indexed",
      note: "Rows come from the indexer events ledger ((sig, log_index)-deduped, u64 amounts as decimal strings in data). Empty list means no events indexed for this basket yet — never fabricated.",
    },
  };
}

/** GET /whitelist — whitelisted_mints. */
export async function listWhitelist(db: PgLike, namespaceId=PROGRAM_NAMESPACES[0].id,namespaces:readonly ProgramNamespace[]=PROGRAM_NAMESPACES): Promise<{ status: number; payload: unknown }> {
  const namespace=validateNamespaceRegistry(namespaces).find(entry=>entry.id===namespaceId);
  if(!namespace) return {status:400,payload:{error:{code:"UNSUPPORTED_NAMESPACE",message:"Only reviewed devnet namespaces are supported"}}};
  const res = await db.query(
    `SELECT wm.mint,admission.decimals,admission.status,admission.price_source,wm.multiplier::text AS multiplier,
      admission.observed_at AS updated_at,admission.namespace_id,admission.whitelist_program,admission.account_pubkey
     FROM whitelisted_mints wm JOIN namespace_whitelisted_mints admission ON admission.mint=wm.mint
     WHERE admission.namespace_id=$1 AND admission.whitelist_program=$2 AND admission.authenticated IS TRUE
       AND admission.reason IS NULL AND admission.observed_at BETWEEN NOW()-interval '5 minutes' AND NOW()
     ORDER BY wm.mint`,[namespace.id,namespace.programs.whitelist],
  );
  const rows = res.rows as Array<Record<string, unknown>>;
  return {
    status: 200,
    payload: {
      data: rows.map((r) => ({ ...r, multiplier: Number(r.multiplier), source: "onchain-indexed", asOf: r.updated_at })),
      count: rows.length,
      namespace:{id:namespace.id,factory:namespace.factoryConfig,programIds:namespaceProgramIds(namespace),whitelistProgram:namespace.programs.whitelist},
      source: "onchain-indexed",
    },
  };
}

/** GET /creators/:pubkey — creator_stats + created baskets. */
export async function creatorDetail(db: PgLike, creator: string): Promise<{ status: number; payload: unknown }> {
  const statsRes = await db.query(
    `SELECT basket_count, total_aum::text AS total_aum, total_fees_earned::text AS total_fees_earned, updated_at
     FROM creator_stats WHERE creator = $1`,
    [creator],
  );
  const basketsRes = await db.query(
    `SELECT b.pubkey, b.share_mint, b.created_at, cur.nav::text AS nav, cur.ts AS nav_as_of,
            cur.valuation_eligible, cur.valuation_status, vq.status AS current_status,
            vq.reason AS current_reason, ${currentNavEligibilitySql("cur.basket","cur")} AS current_eligible,
            r.refreshed_at
     FROM baskets b
     LEFT JOIN basket_rankings r ON r.pubkey = b.pubkey
     LEFT JOIN LATERAL (
       SELECT basket,nav,ts,valuation_eligible,valuation_status FROM nav_snapshots
       WHERE basket=b.pubkey AND ${navEligibilitySql()} ORDER BY ts DESC LIMIT 1
     ) cur ON true
     LEFT JOIN basket_valuation_state vq ON vq.basket=b.pubkey
     WHERE b.creator = $1 ORDER BY b.created_at ASC`,
    [creator],
  );
  const baskets = basketsRes.rows as Array<Record<string, unknown>>;
  const stats = (statsRes.rows[0] ?? null) as Record<string, unknown> | null;
  if (!stats && baskets.length === 0) {
    return { status: 404, payload: { error: { code: "NOT_INDEXED", message: `creator ${creator} has no indexed baskets` } } };
  }
  const observed = baskets.flatMap((b) => {
    const ts = snapshotTime(b.nav_as_of);
    return ts === null ? [] : [Date.parse(ts)];
  });
  const statsAsOf = stats ? snapshotTime(stats.updated_at) : null;
  return {
    status: 200,
    payload: {
      data: {
        creator,
        // Cached creator totals do not establish current valuation provenance.
        stats: stats ? { ...stats, source:"onchain-indexed", asOf:statsAsOf,
          quality:valuationQuality({ts:stats.updated_at,valuation_eligible:false,valuation_status:"aggregate-unverified"}) } : null,
        baskets: baskets.map((b) => ({ ...b, source:"onchain-indexed", asOf:snapshotTime(b.nav_as_of),
          quality:valuationQuality({...b,ts:b.nav_as_of}) })),
        source: "onchain-indexed",
        asOf: observed.length ? new Date(Math.max(...observed)).toISOString() : statsAsOf,
      },
    },
  };
}

/** GET /users/:pubkey/portfolio — user_positions + latest nav per basket. */
export async function userPortfolio(db: PgLike, user: string): Promise<{ status: number; payload: unknown }> {
  const res = await db.query(
    `SELECT up.basket, up.share_balance::text AS share_balance, up.cost_basis::text AS cost_basis, up.updated_at, EXISTS(SELECT 1 FROM position_rebuild_required pr WHERE pr.basket=up.basket AND ${unresolvedPositionRebuildCondition("pr")}) AS legacy_projection_pending, NOT (${positionProjectionReadySql("up.basket")}) AS projection_pending
     FROM user_positions up WHERE up."user" = $1 AND up.share_balance > 0 ORDER BY up.basket`,
    [user],
  );
  const snapshots = await currentBalancesForWallet(db,user);
  const positions = (res.rows as Array<Record<string, unknown>>).filter(row=>!snapshots.covered.has(row.basket as string));
  const navs = await db.query(
    `SELECT DISTINCT ON (ns.basket) ns.basket, nav::text AS nav, supply::text AS supply,
            share_price::text AS share_price, ts, valuation_eligible, valuation_status,
            vq.status AS current_status, vq.reason AS current_reason, ${currentNavEligibilitySql("ns.basket", "ns")} AS current_eligible
     FROM nav_snapshots ns LEFT JOIN basket_valuation_state vq ON vq.basket=ns.basket WHERE ${navEligibilitySql()} AND ns.basket = ANY($1) ORDER BY ns.basket, ts DESC`,
    [positions.map((p) => p.basket as string)],
  );
  const navByBasket = new Map((navs.rows as Array<Record<string, unknown>>).map((n) => [n.basket as string, n]));
  const data = positions.map((p) => {
    const nav = navByBasket.get(p.basket as string) ?? null;
    const balance = BigInt(p.share_balance as string);
    const sharePrice = nav ? decimalToFixedUnits(nav.share_price as string, NAV_SCALE) : 0n;
    return {
      ...p,
      basket:p.basket as string,
      cost_basis:p.projection_pending ? null : p.cost_basis,
      nav: nav ? { value: nav.nav, supply: nav.supply, asOf: nav.ts } : null,
      // value estimate in the same raw terms as share_price = nav/supply
      estimatedValue: nav && !p.projection_pending && sharePrice > 0n ? fixedUnitsToDecimalString(balance * sharePrice, NAV_SCALE) : null,
      projectionStatus: p.legacy_projection_pending ? "rebuild-required" : p.projection_pending ? "history-pending" : "indexed",
      quality: valuationQuality(nav ?? {}),
      source: "onchain-indexed",
      asOf: nav?.ts ?? p.updated_at,
    };
  });
  const verified = snapshots.rows.map(row=>({basket:row.basket,share_balance:row.shares,cost_basis:null,
    updated_at:row.evidence.observedAt,nav:null,estimatedValue:null,projectionStatus:"snapshot-verified",
    quality:{eligible:false,complete:false,status:"history-incomplete",stale:false,asOf:row.evidence.observedAt},
    source:"finalized-balance-snapshot",asOf:row.evidence.observedAt,balanceEvidence:row.evidence}));
  const allData=[...data,...verified].sort((a,b)=>String(a.basket).localeCompare(String(b.basket)));
  return { status: 200, payload: { data:allData, count:allData.length,
    source:verified.length||snapshots.coverage.verifiedBaskets?"finalized-balance-snapshot":"onchain-indexed",
    coverage:snapshots.coverage,note:balanceCoverageNote(snapshots.coverage.complete) } };
}

/**
 * Static SQL for GET /positions?wallet= — one literal, every dynamic value a
 * bound parameter. Joins user_positions with baskets (symbol from off-chain
 * metadata when present) and the latest nav_snapshots.share_price; value_usd
 * is computed IN POSTGRES from the raw balance × share_price (exact NUMERIC —
 * never a JS-number product). share_price = nav / supply_raw, i.e. USD per
 * raw base unit, matching cost_basis units in indexer/positions.ts.
 */
const POSITIONS_BY_WALLET_SQL = `
  SELECT up.basket,
         b.metadata_json->>'symbol' AS basket_symbol,
         up.share_balance::text AS share_balance,
         up.cost_basis::text AS cost_basis,
         up.cost_basis_source AS cost_basis_source,
         EXISTS(SELECT 1 FROM position_rebuild_required pr WHERE pr.basket=up.basket AND ${unresolvedPositionRebuildCondition("pr")}) AS legacy_projection_pending, NOT (${positionProjectionReadySql("up.basket")}) AS projection_pending,
         sp.share_price::text AS share_price,
         sp.ts AS share_price_as_of, sp.valuation_eligible, sp.valuation_status, sp.current_status, sp.current_reason, sp.current_eligible,
         (up.share_balance * sp.share_price)::text AS value_usd,
         up.updated_at
  FROM user_positions up
  JOIN baskets b ON b.pubkey = up.basket
  LEFT JOIN LATERAL (
    SELECT share_price, ts, valuation_eligible, valuation_status, (SELECT status FROM basket_valuation_state WHERE basket=up.basket) AS current_status, ${currentNavEligibilitySql("up.basket", "ns")} AS current_eligible, (SELECT reason FROM basket_valuation_state WHERE basket=up.basket) AS current_reason FROM nav_snapshots ns WHERE ${navEligibilitySql()} AND basket = up.basket ORDER BY ts DESC LIMIT 1
  ) sp ON true
  WHERE up."user" = $1 AND up.share_balance > 0
  ORDER BY up.basket`;

export interface WalletPositionItem {
  basket: string;
  /** Display symbol from baskets.metadata_json (null when metadata is absent). */
  basketSymbol: string | null;
  /** Raw u64 base units as a decimal string (integer-safe). */
  shareBalance: string;
  /** Latest nav_snapshots.share_price (USD per raw unit) or null (no NAV yet). */
  sharePrice: string | null;
  /** share_balance × share_price, exact NUMERIC string, or null (no NAV yet). */
  valueUsd: string | null;
  /** Event-derived cost basis (USD) or null when unknown. */
  costBasis: string | null;
  /** cost_basis provenance: 'reference' | 'balance-sync' | null (unknown). */
  source: string | null;
  /** Freshness of sharePrice. */
  sharePriceAsOf: string | null;
  quality: ReturnType<typeof valuationQuality>;
  projectionStatus: "rebuild-required" | "history-pending" | "indexed" | "snapshot-verified";
  balanceEvidence?: BalanceEvidence;
}

/**
 * GET /positions?wallet= — the "did my tx land" Portfolio source of truth:
 * the wallet's user_positions (kept reconciled to chain by the indexer's
 * positions sync) joined with basket symbols + current NAV share price.
 * Static SQL + bound params only.
 */
export async function userPositionsByWallet(
  db: PgLike,
  wallet: string,
): Promise<{ status: number; payload: unknown }> {
  const res = await db.query(POSITIONS_BY_WALLET_SQL, [wallet]);
  const snapshots = await currentBalancesForWallet(db,wallet);
  const rows = (res.rows as Array<Record<string, unknown>>).filter(row=>!snapshots.covered.has(row.basket as string));
  const data: WalletPositionItem[] = rows.map((r) => ({
    basket: r.basket as string,
    basketSymbol: (r.basket_symbol as string | null) ?? null,
    shareBalance: r.share_balance as string,
    sharePrice: (r.share_price as string | null) ?? null,
    valueUsd: r.projection_pending ? null : (r.value_usd as string | null) ?? null,
    costBasis: r.projection_pending ? null : (r.cost_basis as string | null) ?? null,
    source: (r.cost_basis_source as string | null) ?? null,
    sharePriceAsOf: r.share_price_as_of ? new Date(r.share_price_as_of as string).toISOString() : null,
    quality: valuationQuality({ ...r, ts: r.share_price_as_of }),
    projectionStatus: r.legacy_projection_pending ? "rebuild-required" : r.projection_pending ? "history-pending" : "indexed",
  }));
  for (const row of snapshots.rows) data.push({basket:row.basket,basketSymbol:row.symbol,shareBalance:row.shares,
    sharePrice:null,valueUsd:null,costBasis:null,source:"finalized-balance-snapshot",sharePriceAsOf:null,
    quality:valuationQuality({}),projectionStatus:"snapshot-verified",balanceEvidence:row.evidence});
  data.sort((a,b)=>a.basket.localeCompare(b.basket));
  return {
    status: 200,
    payload: {
      data,
      count: data.length,
      coverage:snapshots.coverage,
      wallet,
      asOf: new Date().toISOString(),
      source: "onchain-indexed",
      note: balanceCoverageNote(snapshots.coverage.complete),
    },
  };
}

/** GET /health — indexer lag, last slot, holdings staleness (spec §8). */
export async function healthReport(
  db: PgLike | null,
  status: () => SubsystemStatus,
  now: () => Date = () => new Date(),
): Promise<{ status: number; payload: unknown }> {
  const base = {
    ok: true,
    version: API_VERSION,
    ts: now().toISOString(),
    subsystems: status(),
  };
  if (!isPgLike(db)) {
    return {
      status: 200,
      payload: { ...base, db: { connected: false, note: "DB-less mode: API serves no indexed data" } },
    };
  }
  try {
    const res = await db.query(
      `SELECT (SELECT COUNT(*) FROM baskets) AS basket_count,
              (SELECT MAX(slot) FROM events) AS last_slot,
              (SELECT COUNT(*) FROM current_balance_snapshots WHERE status='verified' AND history_complete IS FALSE AND EXISTS(SELECT 1 FROM baskets cb JOIN (VALUES ${namespaceSqlValues()}) AS cbns(factory,program_ids) ON cbns.factory=cb.factory WHERE cb.pubkey=current_balance_snapshots.basket AND cbns.program_ids=current_balance_snapshots.program_ids) AND observed_at BETWEEN NOW()-interval '5 minutes' AND NOW()) AS current_balance_baskets,
              (SELECT MIN(observed_at) FROM current_balance_snapshots WHERE status='verified' AND history_complete IS FALSE AND EXISTS(SELECT 1 FROM baskets cb JOIN (VALUES ${namespaceSqlValues()}) AS cbns(factory,program_ids) ON cbns.factory=cb.factory WHERE cb.pubkey=current_balance_snapshots.basket AND cbns.program_ids=current_balance_snapshots.program_ids) AND observed_at BETWEEN NOW()-interval '5 minutes' AND NOW()) AS current_balance_oldest_at,
              (SELECT MAX(ts) FROM events) AS last_event_ts,
              (SELECT COUNT(*) FROM vault_holdings) AS holdings_rows,
              (SELECT MAX(updated_at) FROM vault_holdings WHERE authenticated IS TRUE) AS holdings_updated_at,
              (SELECT COUNT(*) FROM indexer_signature_queue WHERE status='pending') AS pending_signatures,
              (SELECT COUNT(*) FROM indexer_signature_queue WHERE status='pending' AND canonical_collected_at IS NULL) AS pending_evidence,
              (SELECT COUNT(*) FROM indexer_signature_queue WHERE status='pending' AND canonical_collected_at IS NOT NULL) AS collected_pending_effects,
              (SELECT COUNT(*) FROM indexer_signature_queue WHERE status='pending' AND projection_blocked_basket IS NOT NULL) AS projection_blocked_signatures,
              (SELECT COUNT(DISTINCT sig) FROM indexer_signature_queue WHERE status='quarantined') AS quarantined_transactions,
              (SELECT MIN(discovered_at) FROM indexer_signature_queue WHERE status='pending') AS oldest_pending_at,
              (SELECT MIN(block_time) FROM indexer_signature_queue WHERE status='pending') AS oldest_pending_chain_at,
              (SELECT COUNT(*) FROM indexer_signature_queue WHERE status='quarantined') AS quarantined_signatures,
              (SELECT COUNT(*) FROM indexer_program_state) AS indexed_programs,
              (SELECT array_agg(program_id ORDER BY program_id) FROM indexer_program_state) AS indexed_program_ids,
              (SELECT MIN(finalized_through_slot) FROM indexer_program_state) AS finalized_through_slot,
              (SELECT COUNT(*) FROM indexer_program_state WHERE finalized_through_slot IS NULL) AS missing_coverage,
              (SELECT COUNT(*) FROM basket_valuation_state WHERE status='complete' AND last_complete_at <= NOW() AND last_complete_at >= NOW() - interval '15 minutes') AS current_valuations,
              (SELECT COUNT(*) FROM indexer_program_state WHERE history_complete IS NOT TRUE OR scan_before IS NOT NULL OR scan_head IS NOT NULL) AS history_scans_pending,
              (SELECT COUNT(*) FROM position_rebuild_required pr WHERE ${unresolvedPositionRebuildCondition("pr")}) AS rebuild_required_baskets,
              (SELECT COUNT(*) FROM position_rebuild_runs WHERE status='activated') AS activated_recovery_runs`,
    );
    const row = res.rows[0] as Record<string, unknown>;
    const lastEventTs = row.last_event_ts ? new Date(row.last_event_ts as string) : null;
    const holdingsUpdatedAt = row.holdings_updated_at ? new Date(row.holdings_updated_at as string) : null;
    const nowMs = now().getTime();
    return {
      status: 200,
      payload: {
        ...base,
        db: {
          connected: true,
          basketCount: Number(row.basket_count),
          currentValuations: Number(row.current_valuations ?? 0),
          currentBalances: {verifiedBaskets:Number(row.current_balance_baskets ?? 0),
            indexedBaskets:Number(row.basket_count),oldestObservedAt:row.current_balance_oldest_at ?? null,
            historyComplete:false,costBasisKnown:false},
          lastSlot: row.last_slot ?? null,
          lastEventTs: lastEventTs?.toISOString() ?? null,
          indexerLagSeconds: lastEventTs ? Math.floor((nowMs - lastEventTs.getTime()) / 1000) : null,
          history: {
            pendingSignatures: Number(row.pending_signatures ?? 0),
            pendingEvidence: Number(row.pending_evidence ?? 0),
            collectedPendingEffects: Number(row.collected_pending_effects ?? 0),
            projectionBlockedSignatures: Number(row.projection_blocked_signatures ?? 0),
            quarantinedTransactions: Number(row.quarantined_transactions ?? 0),
            oldestPendingAt: row.oldest_pending_at ?? null,
            oldestPendingChainAt: row.oldest_pending_chain_at ?? null,
            quarantinedSignatures: Number(row.quarantined_signatures ?? 0),
            scansPending: Number(row.history_scans_pending ?? 0),
            indexedPrograms: Number(row.indexed_programs ?? 0),
            programIds: row.indexed_program_ids ?? [],
            finalizedThroughSlot: row.finalized_through_slot ?? null,
            missingCoverage: Number(row.missing_coverage ?? 0),
            rebuildRequiredBaskets: Number(row.rebuild_required_baskets ?? 0),
            reconciliationWritesEnabled: true,
            reconciliationGuarded: true,
            automaticActivationEnabled: false,
            activatedRecoveryRuns: Number(row.activated_recovery_runs ?? 0),
          },
          holdings: {
            rows: Number(row.holdings_rows),
            lastUpdatedAt: holdingsUpdatedAt?.toISOString() ?? null,
            staleSeconds: holdingsUpdatedAt ? Math.floor((nowMs - holdingsUpdatedAt.getTime()) / 1000) : null,
          },
        },
      },
    };
  } catch (err) {
    return {
      status: 200,
      payload: {
        ...base,
        db: { connected: true, degraded: true, note: "HEALTH_QUERY_FAILED" },
      },
    };
  }
}

// --- handler -----------------------------------------------------------------

export function createHandler(ctx: ApiContext = { db: null }) {
  const authSecret = ctx.authSecret ?? socialAuthSecret();
  const limits = ctx.resourceLimits ?? new ApiResourceLimits();
  const xstockQuotes = ctx.xstockQuotes ?? new XStockQuoteService({ fetchImpl: ctx.fetchImpl, now: ctx.now, cachePath: null });
  const xstockHistory = ctx.xstockHistory ?? new XStockHistoryService({ fetchImpl: ctx.fetchImpl, now: ctx.now, ...(ctx.fetchImpl ? { cachePath: null } : {}) });
  const dispatch = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const pathname = url.pathname;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }

    const authAction = req.method === "POST" && pathname === "/api/v1/auth/nonce" ? "auth-nonce"
      : req.method === "POST" && pathname === "/api/v1/auth/verify" ? "auth-verify" : null;
    const isQuote = req.method === "POST" && (pathname === "/api/v1/quotes/zap-in" || pathname === "/api/v1/quotes/zap-out");
    // Socket peers cannot be forged with Forwarded/X-Forwarded-For headers.
    // Behind Caddy this budget is shared by its clients; wallet quotas remain independent.
    if (authAction || isQuote) limits.consumeIp(authAction ?? "quote", req.socket?.remoteAddress ?? "unknown-peer");
    const readSocialBody = async (request: http.IncomingMessage): Promise<Record<string, unknown> | null> => {
      const body = await readJsonBody(request);
      if (authAction && typeof body?.wallet === "string" && isValidWalletPubkey(body.wallet)) {
        limits.consumeWallet(authAction, body.wallet);
      }
      return body;
    };

    if (await tryHandleBasketShareRoute({ getDb: () => resolveDb(ctx), limits }, req, res, url)) return;

    // --- Social layer (profiles / follows / posts / feed / leaderboard /
    // wallet-signature auth). Falls through for non-social paths. ---
    if (await tryHandleSocialRoute(
      { getDb: () => resolveDb(ctx), readJsonBody: readSocialBody, authSecret },
      req,
      res,
      url,
    )) {
      return;
    }

    // --- Health ---
    if ((pathname === "/api/v1/health" || pathname === "/api/v1/ready") && req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      const db = await resolveDb(ctx);
      const report = await healthReport(db, ctx.status ?? defaultStatus, ctx.now);
      const result = pathname === "/api/v1/ready" ? readinessReport(report.payload) : report;
      sendJson(res, result.status, result.payload);
      return;
    }

    // Official discovery metadata is separate from the protocol whitelist.
    if (pathname === "/api/v1/providers" && req.method === "GET") {
      sendJson(res, 200, { data: [
        { id: "backed", name: "xStocks", type: "xstock", url: "https://docs.xstocks.fi/developers" },
        { id: "jupiter", name: "Jupiter Price V3", type: "price", url: JUPITER_PRICE_URL },
        { id: "yahoo", name: "Yahoo Finance", type: "underlying-reference", url: "https://query2.finance.yahoo.com" },
      ] });
      return;
    }
    if (pathname === "/api/v1/xstocks" && req.method === "GET") {
      sendJson(res, 200, await getXStockCatalog({ fetchImpl: ctx.fetchImpl, now: ctx.now }));
      return;
    }
    // Explicit historical reads remain available outside the live NYSE refresh session.
    if (pathname === "/api/v1/xstocks/history" && req.method === "GET") {
      const mints = [...new Set((url.searchParams.get("mints") ?? "").split(",").filter(Boolean))];
      const range = url.searchParams.get("range") ?? "7d";
      if (mints.length === 0 || mints.length > 24 || (range !== "7d" && range !== "30d") || mints.some(mint => {
        try { return new PublicKey(mint).toBase58() !== mint; } catch { return true; }
      })) { sendError(res, 400, "INVALID_HISTORY_QUERY", "Provide 1-24 Solana mints and range 7d or 30d."); return; }
      const official = new Set(getCachedXStockCatalog(ctx.now).data.map(asset => asset.mint));
      if (mints.some(mint => !official.has(mint))) { sendError(res, 400, "UNKNOWN_XSTOCK", "One or more mints are not in the Solana xStocks catalog."); return; }
      sendJson(res, 200, await xstockHistory.getHistories(mints, range));
      return;
    }
    if (pathname === "/api/v1/xstocks/prices" && req.method === "GET") {
      const mints = [...new Set((url.searchParams.get("mints") ?? "").split(",").filter(Boolean))];
      if (mints.length === 0 || mints.length > 100 || mints.some(mint => {
        try { return new PublicKey(mint).toBase58() !== mint; } catch { return true; }
      })) {
        sendError(res, 400, "INVALID_MINTS", "Provide between 1 and 100 Solana mint addresses.");
        return;
      }
      // Known issuer mints can be priced without waiting for all 13 metadata pages.
      // New mints require a fresh complete issuer lookup before their quote is read.
      let catalog = getCachedXStockCatalog(ctx.now);
      let official = new Set(catalog.data.map(asset => asset.mint));
      if (xstockQuotes.marketSession().isOpen && mints.some(mint => !official.has(mint))) {
        catalog = await getXStockCatalog({ fetchImpl: ctx.fetchImpl, now: ctx.now });
        official = new Set(catalog.data.map(asset => asset.mint));
      }
      if (mints.some(mint => !official.has(mint))) {
        sendError(res, 400, "UNKNOWN_XSTOCK", "One or more mints are not in the Solana xStocks catalog.");
        return;
      }
      const data = await xstockQuotes.getQuotes(mints);
      sendJson(res, 200, { data, meta: { ...xstockQuotes.metadata(), catalogStale: catalog.meta.stale } });
      return;
    }

    // --- Mock xStock catalog (devnet demo universe, 12 stocks) ---
    // Deterministic dev-catalog prices for whitelisted mints labeled
    // "mock:<slug>" — NOT live market data. Mint addresses are per-deploy
    // Token-2022 keypairs, discovered via GET /api/v1/whitelist on devnet.
    if (pathname === "/api/v1/xstocks/mock" && req.method === "GET") {
      sendJson(res, 200, {
        data: MOCK_XSTOCKS.map((s) => ({
          ticker: s.symbol,
          priceSource: s.priceSource,
          priceUsd: s.priceUsd,
          decimals: 6,
          provider: "mock",
          status: "Active",
          mint: null,
        })),
        flagship: DEVNET_FLAGSHIP_BASKET,
        source: "dev-catalog",
        note: "Deterministic mock xStock prices (source: mock) for devnet demo baskets — not live market data.",
      });
      return;
    }

    // Token spot and underlying reference remain separate; no equity fallback.
    if (pathname === "/api/v1/prices/compare" && req.method === "GET") {
      const tickersParam = url.searchParams.get("tickers");
      const tickers = tickersParam ? tickersParam.split(",") : undefined;
      if (tickers && tickers.length > 20) {
        sendError(res, 400, "TOO_MANY_TICKERS", "Request at most 20 tickers.");
        return;
      }
      const db = await resolveDb(ctx);
      const data = await comparePrices(tickers, {
        market: url.searchParams.get("network") === "devnet" ? "devnet" : "mainnet",
        mockRows: db && url.searchParams.get("network") === "devnet" ? await readMockWhitelistRows(db) : [],
        fetchImpl: ctx.fetchImpl, now: ctx.now,
      });
      sendJson(res, 200, { data, ts: new Date().toISOString(), note: "diffBps = (jupiter - yahoo)/yahoo*10000, LEGAL: xStock is structured instrument" });
      return;
    }

    // --- Chart series: xStock + Yahoo + Nasdaq overlay ---
    // GET /api/v1/prices/chart?tickers=TSLAx&range=1mo
    if (pathname === "/api/v1/prices/chart" && req.method === "GET") {
      const ticker = Buffer.from(url.searchParams.get("ticker") || "TSLAx", "utf8").toString("utf8");
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
      const series = await getChartSeries(ticker, range);
      sendJson(res, 200, { data: series });
      return;
    }

    // --- Yahoo proxy: GET /api/v1/prices/yahoo?symbol=TSLA&range=1mo ---
    if (pathname === "/api/v1/prices/yahoo" && req.method === "GET") {
      const symbol = Buffer.from(url.searchParams.get("symbol") || "TSLA", "utf8").toString("utf8");
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
      try {
        const s = await fetchYahooSeries(symbol, range, "1d");
        sendJson(res, 200, { data: s });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        sendError(res, 502, "YAHOO_FETCH_FAILED", message);
      }
      return;
    }

    // --- Market overview: Nasdaq (QQQ, SPY, DIA) ---
    if (pathname === "/api/v1/market/overview" && req.method === "GET") {
      const rangeIndex = (CHART_RANGE_NAMES as readonly string[]).indexOf(url.searchParams.get("range") ?? "");
      const range = CHART_RANGE_NAMES[rangeIndex === -1 ? 2 : rangeIndex];
      const symbols = ["QQQ", "SPY", "DIA", "^IXIC"];
      const results = await Promise.all(symbols.map((s) => fetchYahooSeries(s, range, "1d").catch(() => ({ symbol: s, candles: [] })) ));
      // compute % change from first close
      const overview = results.map((r) => {
        const first = r.candles[0]?.close ?? 0;
        const last = r.candles[r.candles.length - 1]?.close ?? 0;
        const changePct = first ? (last - first) / first * 100 : 0;
        return { symbol: r.symbol, first, last, changePct, candles: r.candles, count: r.candles.length };
      });
      sendJson(res, 200, { data: overview, range });
      return;
    }

    // --- Core spec §8 routes (DB-backed) ---
    if (pathname === "/api/v1/baskets" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed basket data is unavailable (never fabricated)"); return; }
      try {
        const sortRaw = url.searchParams.get("sort");
        const creatorRaw = url.searchParams.get("creator");
        const searchRaw = url.searchParams.get("search");
        const minAUMRaw = url.searchParams.get("minAUM");
        const out = await listBaskets(db, {
          sort: sortRaw !== null ? (SUPPORTED_SORT_PARAMS[sortRaw] ?? sortRaw) : null,
          creator: creatorRaw === null ? null : Buffer.from(creatorRaw, "utf8").toString("utf8"),
          // Numeric round-trip: the bound value is String(Number(x)) — a plain
          // finite decimal or "NaN" (which listBaskets answers 400 to).
          minAUM: minAUMRaw === null ? null : String(Number(minAUMRaw)),
          search: searchRaw === null ? null : Buffer.from(searchRaw, "utf8").toString("utf8"),
          limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
        });
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "basket list query failed");
      }
      return;
    }

    const basketsMatch = /^\/api\/v1\/baskets\/([^/]+)(\/(holdings|nav\/history|performance))?$/.exec(pathname);
    if (basketsMatch && req.method === "GET") {
      const sub = basketsMatch[3] ?? null;
      // Canonicalize + guard (400) before dispatch — the canonical base58 form
      // of a valid key equals the input; invalid keys answer 400 here and can
      // never reach the DB layer.
      let pubkey: string;
      try {
        pubkey = new PublicKey(decodeURIComponent(basketsMatch[1])).toBase58();
      } catch {
        sendError(res, 400, "INVALID_PUBKEY", `not a valid Solana pubkey: ${basketsMatch[1].slice(0, 64)}`);
        return;
      }
      if (!isValidPubkey(pubkey)) {
        sendError(res, 400, "INVALID_PUBKEY", `not a valid Solana pubkey: ${pubkey}`);
        return;
      }
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed basket data is unavailable (never fabricated)"); return; }
      try {
        let out: { status: number; payload: unknown };
        if (sub === "holdings") out = await basketHoldings(db, pubkey);
        else if (sub === "nav/history") {
          out = await navHistory(db, pubkey, {
            interval: url.searchParams.get("interval"),
            from: url.searchParams.get("from"),
            to: url.searchParams.get("to"),
          });
        } else if (sub === "performance") out = await basketPerformance(db, pubkey, ctx.now);
        else out = await basketDetail(db, pubkey);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "basket query failed");
      }
      return;
    }

    // --- Events ledger (spec §8): GET /api/v1/events?basket=&type=&limit= ---
    if (pathname === "/api/v1/events" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed event data is unavailable (never fabricated)"); return; }
      // Canonicalize + guard (400) before dispatch — same trust boundary as
      // the basket/positions routes: only canonical base58 reaches the DB.
      const basketRaw = url.searchParams.get("basket");
      let pubkey: string;
      try {
        if (!basketRaw) throw new Error("missing basket");
        pubkey = new PublicKey(decodeURIComponent(basketRaw)).toBase58();
      } catch {
        sendError(res, 400, "INVALID_PUBKEY", `basket query parameter must be a valid Solana pubkey${basketRaw ? `: ${basketRaw.slice(0, 64)}` : " (missing)"}`);
        return;
      }
      if (!isValidPubkey(pubkey)) {
        sendError(res, 400, "INVALID_PUBKEY", `basket query parameter must be a valid Solana pubkey: ${pubkey}`);
        return;
      }
      try {
        const limitRaw = url.searchParams.get("limit");
        const out = await basketEvents(db, pubkey, {
          type: url.searchParams.get("type"),
          limit: limitRaw !== null ? Number(limitRaw) : undefined,
        });
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "events query failed");
      }
      return;
    }

    if (pathname === "/api/v1/whitelist" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed whitelist data is unavailable (never fabricated)"); return; }
      try {
        const out = await listWhitelist(db,url.searchParams.get("namespace") ?? PROGRAM_NAMESPACES[0].id);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "whitelist query failed");
      }
      return;
    }

    const creatorsMatch = /^\/api\/v1\/creators\/([^/]+)$/.exec(pathname);
    if (creatorsMatch && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed creator data is unavailable (never fabricated)"); return; }
      try {
        const out = await creatorDetail(db, decodeURIComponent(creatorsMatch[1]));
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "creator query failed");
      }
      return;
    }

    const portfolioMatch = /^\/api\/v1\/users\/([^/]+)\/portfolio$/.exec(pathname);
    if (portfolioMatch && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed portfolio data is unavailable (never fabricated)"); return; }
      try {
        const out = await userPortfolio(db, decodeURIComponent(portfolioMatch[1]));
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "portfolio query failed");
      }
      return;
    }

    // --- Positions by wallet ("did my tx land" — Portfolio source of truth) ---
    // GET /api/v1/positions?wallet=<pubkey>
    if (pathname === "/api/v1/positions" && req.method === "GET") {
      const db = await resolveDb(ctx);
      if (!isPgLike(db)) { sendError(res, 503, "DB_UNAVAILABLE", "no Postgres configured — indexed position data is unavailable (never fabricated)"); return; }
      // Canonicalize + guard (400) before dispatch — same trust boundary as
      // the basket routes: only canonical base58 reaches the DB layer.
      const walletRaw = url.searchParams.get("wallet");
      let wallet: string;
      try {
        if (!walletRaw) throw new Error("missing wallet");
        wallet = new PublicKey(decodeURIComponent(walletRaw)).toBase58();
      } catch {
        sendError(res, 400, "INVALID_PUBKEY", `wallet query parameter must be a valid Solana pubkey${walletRaw ? `: ${walletRaw.slice(0, 64)}` : " (missing)"}`);
        return;
      }
      if (!isValidPubkey(wallet)) {
        sendError(res, 400, "INVALID_PUBKEY", `wallet query parameter must be a valid Solana pubkey: ${wallet}`);
        return;
      }
      try {
        const out = await userPositionsByWallet(db, wallet);
        sendJson(res, out.status, out.payload);
      } catch (err) {
        sendError(res, 503, "DB_UNAVAILABLE", err instanceof Error ? err.message : "positions query failed");
      }
      return;
    }

    // --- Zap quotes (spec §8; Jupiter legs, never fabricated) ---
    if (isQuote) {
      const body = await readJsonBody(req);
      if (body === null) { sendError(res, 400, "INVALID_JSON", "request body must be a JSON object"); return; }
      const release = limits.acquireQuote();
      try {
        let upstreamRejection: ApiResourceLimitError | undefined;
        const originalFetch = ctx.fetchImpl ?? fetch;
        const budgetedFetch: typeof fetch = async (...args) => {
          try {
            limits.consumeQuoteUpstream();
          } catch (error) {
            if (error instanceof ApiResourceLimitError) upstreamRejection = error;
            throw error;
          }
          return originalFetch(...args);
        };
        const qctx: QuoteContext = { db: ctx.db, cache: ctx.cache ?? null, fetchImpl: budgetedFetch, now: ctx.now };
        // Quotes resolve the DB lazily like the GET routes (null → handlers 503).
        if (!qctx.db) qctx.db = await connectFromEnv();
        const out = pathname.endsWith("zap-in")
          ? await handleZapIn(qctx, body)
          : await handleZapOut(qctx, body);
        // Quote helpers turn failed legs into 503; retain the quota's precise 429.
        if (upstreamRejection) throw upstreamRejection;
        sendJson(res, out.status, out.payload);
      } catch (err) {
        if (err instanceof ApiResourceLimitError) throw err;
        sendError(res, 500, "QUOTE_ERROR", err instanceof Error ? err.message : "quote handler failed");
      } finally {
        release();
      }
      return;
    }

    sendError(res, 404, "NOT_FOUND", `no route for ${req.method} ${pathname}`);
  };
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    try {
      await dispatch(req, res);
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      // Reject without draining an arbitrarily large/slow request. Node closes
      // the connection after flushing the error response.
      req.pause();
      res.shouldKeepAlive = false;
      res.setHeader("Connection", "close");
      if (error instanceof JsonBodyError) {
        sendError(res, error.status, error.code, error.message);
      } else if (error instanceof ApiResourceLimitError) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
        sendError(res, error.status, error.code, error.message);
      } else {
        sendError(res, 500, "INTERNAL_ERROR", "request failed");
      }
    }
  };
}

function defaultStatus(): SubsystemStatus {
  return {
    db: { connected: false, schemaApplied: null },
    indexer: { enabled: false, running: false },
    navEngine: { enabled: false, running: false },
    feeCrank: { enabled: false, running: false },
    userSnapshot: { enabled: false, running: false },
  };
}

if (process.argv[1]?.endsWith("server.ts")) {
  const handler = createHandler();
  http.createServer(handler).listen(3001, () => console.log("Basalt API on :3001 (DB-backed + providers + price compare)"));
}

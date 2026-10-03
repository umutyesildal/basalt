import { fetchPriceQuotes } from "./priceFetch.js";
import { getXStockCatalog, getCachedXStockCatalog, findXStockAsset } from "../catalog/xstocks.js";
import { fetchYahooSeries, fetchYahooPrice } from "./yahooFetch.js";
import {
  realisticMockQuote,
  realisticMockPricesEnabled,
  type RealisticQuote,
} from "./realisticMockPrices.js";
import {
  MOCK_SLUG_TO_TICKER,
  isMockPriceSource,
  mockPriceForPriceSource,
} from "../catalog/mockStocks.js";
import { getNyseMarketSession, type MarketSession } from "./marketSession.js";
import type { PgLike } from "../db/client.js";

/**
 * One row of GET /api/v1/prices/compare. `source` (optional, additive — the
 * Create wizard only reads ticker/mint/jupiter) says where `jupiter` came
 * from:
 *   "jupiter"     — live Jupiter Price V3 (real mainnet xStock mints)
 *   "yahoo"       — REAL US-equity market spot quote (guarded Yahoo chart API);
 *                   on devnet the mock:<slug> mints track their real equity, so
 *                   both legs reference the same real quote (diffBps 0)
 *   "mock"        — deterministic dev catalog (Yahoo unavailable)
 *   "unavailable" — no real quote AND no catalog price (never fabricated)
 */
export interface CompareTick {
  ticker: string;
  mint: string;
  jupiter: number | null;
  yahoo: number | null;
  diffBps: number | null;
  source?: "jupiter" | "yahoo" | "mock" | "unavailable";
}

// --- mock-mint resolution (devnet "mock:<slug>" whitelist rows) --------------

/** Indexed whitelist label for one mint ("mock:<slug>"). */
export interface MockMintRow {
  mint: string;
  price_source: string;
}

interface MockIndexEntry {
  mint: string;
  slug: string;
  priceSource: string;
}

/**
 * Read the mock-labeled whitelist rows for /prices/compare (read-only). The
 * SQL is a fully static literal — nothing from the request is interpolated —
 * and fails open to [] so a DB hiccup degrades to catalog fallback, not 500s.
 */
export async function readMockWhitelistRows(db: PgLike): Promise<MockMintRow[]> {
  try {
    const res = await db.query(
      "SELECT mint, price_source FROM whitelisted_mints WHERE price_source LIKE 'mock:%'",
    );
    const rows: MockMintRow[] = [];
    for (const row of res.rows) {
      const mint = (row as { mint?: unknown }).mint;
      const priceSource = (row as { price_source?: unknown }).price_source;
      if (typeof mint === "string" && typeof priceSource === "string") {
        rows.push({ mint, price_source: priceSource });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/**
 * Index mock whitelist rows by every ticker shape a client may send: the real
 * equity ticker ("TSLA" — what the Create wizard derives from "mock:tsla") and
 * the display symbol ("TSLAx").
 */
function buildMockIndex(rows: MockMintRow[]): Record<string, MockIndexEntry> {
  const idx: Record<string, MockIndexEntry> = {};
  for (const row of rows) {
    if (!isMockPriceSource(row.price_source)) continue;
    const slug = row.price_source.slice("mock:".length);
    const ticker = MOCK_SLUG_TO_TICKER[slug];
    if (!ticker) continue; // slug outside the catalog never resolves
    const entry: MockIndexEntry = { mint: row.mint, slug, priceSource: row.price_source };
    idx[ticker.toUpperCase()] = entry;
    idx[`${ticker.toUpperCase()}X`] = entry;
  }
  return idx;
}

/** Real quote for one mock entry via the guarded Yahoo path (60s TTL cache,
 *  spaced fetches — the same cache the NAV engine uses). Null on any failure. */
async function realQuoteForEntry(entry: MockIndexEntry): Promise<RealisticQuote | null> {
  if (!realisticMockPricesEnabled()) return null;
  try {
    return await realisticMockQuote(entry.slug);
  } catch {
    return null; // fail-open — the catalog fallback decides next
  }
}

/** Compare row for a devnet mock mint: real Yahoo price → catalog → unavailable. */
async function mockCompareTick(ticker: string, entry: MockIndexEntry): Promise<CompareTick> {
  const quote = await realQuoteForEntry(entry);
  if (quote && Number.isFinite(quote.price) && quote.price > 0) {
    return {
      ticker,
      mint: entry.mint,
      jupiter: quote.price,
      yahoo: quote.price,
      diffBps: 0,
      source: "yahoo",
    };
  }
  const catalog = mockPriceForPriceSource(entry.priceSource);
  if (catalog !== null && catalog > 0) {
    return {
      ticker,
      mint: entry.mint,
      jupiter: catalog,
      yahoo: null,
      diffBps: null,
      source: "mock",
    };
  }
  return { ticker, mint: entry.mint, jupiter: null, yahoo: null, diffBps: null, source: "unavailable" };
}

export interface CompareOptions {
  /**
   * Indexed whitelisted_mints rows (mock-labeled). Requested tickers that are
   * not real Backed mints resolve against these — a devnet "mock:tsla" mint
   * is quoted from the REAL market via the guarded Yahoo path, falling back to
   * the deterministic catalog, then to null (never fabricated).
   */
  mockRows?: MockMintRow[];
  market?: "mainnet" | "devnet";
  fetchUnderlyingPrice?: typeof fetchYahooPrice;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  marketSession?: (now: Date) => MarketSession;
}

export async function comparePrices(
  tickers: string[] = ["TSLAx", "AAPLx", "NVDAx", "SPYx"],
  opts: CompareOptions = {},
): Promise<CompareTick[]> {
  // Dev fixtures require an explicit market choice; never cross-fill a mainnet quote.
  if (opts.market === "devnet") {
    const mockIndex = buildMockIndex(opts.mockRows ?? []);
    return Promise.all(tickers.map(ticker => {
      const entry = mockIndex[ticker.trim().toUpperCase()];
      return entry ? mockCompareTick(ticker, entry)
        : { ticker, mint: "", jupiter: null, yahoo: null, diffBps: null, source: "unavailable" as const };
    }));
  }
  const open = () => (opts.marketSession ?? getNyseMarketSession)((opts.now ?? (() => new Date()))()).isOpen;
  const catalog = open() ? await getXStockCatalog({ fetchImpl: async (input, init) => {
    if (!open()) throw new Error("NYSE session closed");
    return (opts.fetchImpl ?? fetch)(input, init);
  }, now: opts.now }) : getCachedXStockCatalog(opts.now);
  const assets = tickers.map(ticker => findXStockAsset(catalog, ticker));
  const quotes = await fetchPriceQuotes(assets.flatMap(asset => asset ? [asset.mint] : []), {
    fetchImpl: opts.fetchImpl, now: opts.now, fallback: "none", marketSession: opts.marketSession,
  });
  return Promise.all(tickers.map(async (ticker, index): Promise<CompareTick> => {
    const asset = assets[index];
    if (!asset) {
      return { ticker, mint: "", jupiter: null, yahoo: null, diffBps: null, source: "unavailable" };
    }
    const yahoo = open() ? await (opts.fetchUnderlyingPrice ?? fetchYahooPrice)(asset.underlyingSymbol).catch(() => null) : null;
    const jupiter = quotes[asset.mint]?.price ?? null;
    const diffBps = jupiter !== null && yahoo !== null && yahoo > 0
      ? Math.round((jupiter - yahoo) / yahoo * 10000) : null;
    return { ticker: asset.symbol, mint: asset.mint, jupiter, yahoo, diffBps,
      source: jupiter !== null ? "jupiter" : "unavailable" };
  }));
}

/** Underlying price history is a reference only. We do not manufacture token OHLC. */
export async function getChartSeries(ticker: string, range = "1mo") {
  const asset = findXStockAsset(await getXStockCatalog(), ticker);
  const underlying = asset?.underlyingSymbol;
  const [yahoo, nasdaq] = await Promise.all([
    underlying ? fetchYahooSeries(underlying, range, "1d").catch(() => ({ symbol: underlying, candles: [] })) : { symbol: "", candles: [] },
    fetchYahooSeries("QQQ", range, "1d").catch(() => ({ symbol: "QQQ", candles: [] })),
  ]);
  return { ticker: asset?.symbol ?? ticker, mint: asset?.mint ?? null, yahoo,
    xStock: { symbol: asset?.symbol ?? ticker, candles: [], source: "unavailable" },
    nasdaq, historySource: "underlying-reference" };
}
export async function getOHLCSeries(ticker: string, range = "1mo") {
  const asset = findXStockAsset(await getXStockCatalog(), ticker);
  const underlying = asset?.underlyingSymbol ?? ticker;
  return fetchYahooSeries(underlying, range, "1d").catch(() => ({ symbol: underlying, candles: [] }));
}

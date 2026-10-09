/**
 * workers/navEngine.ts — real NAV engine (spec §7, AGENTS.md §17).
 *
 * Two layers:
 *
 * 1. Pure math (integer-safe, Wave B): NAV = Σ(scaled_holding × price) and
 *    drift = actual_weight_bps − target_weight_bps are computed in BigInt
 *    fixed point so u64-scale holdings never lose precision to f64 rounding.
 *    INTEGER-SAFETY CONVENTION (AGENTS.md §2 #7): scaled amounts and supplies
 *    cross this module as DECIMAL STRINGS; prices are f64 by nature (Jupiter)
 *    and are converted to fixed point once, at NAV_SCALE digits.
 *
 * 2. NavEngine worker: one pass loads baskets + vault_holdings from Postgres,
 *    prices them via fetchPriceQuotes (workers/priceFetch.ts — Jupiter Price
 *    v6, source-marked), reads share supply from an authenticated finalized Token-2022 mint
 *    (events-derived estimates are ineligible for persisted NAV), persists nav_snapshots (with per-mint
 *    price provenance in price_source JSONB), caches nav:{basket} (Redis when
 *    REDIS_URL is set, else an in-memory TTL map), and REFRESHes the
 *    basket_rankings materialized view on its own ~5m cadence (spec §7).
 *
 * Degrades honestly without DB: runOnce() is a no-op returning reason "no-db";
 * without prices nothing is persisted (never a fabricated NAV=0 snapshot).
 */

import { PublicKey, type AccountInfo } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint } from "@solana/spl-token";
import { isPgLike, type PgLike } from "../db/client.js";
import { fetchPriceQuotes, type PriceQuoteMap } from "./priceFetch.js";
import { createMockAwareQuoteFetcher } from "./mockPriceFill.js";
import { withRpcBackoff, createPacer } from "../rpc/backoff.js";
import { deriveVaultAuthority } from "../indexer/holdingsSync.js";
import { createReadOnlyRpcConnection } from "../rpc/requestBudget.js";
import { NAV_INPUT_MAX_AGE_MS, recordValuationAttempt } from "../api/valuation-quality.js";

// ---------------------------------------------------------------------------
// Legacy numeric API — kept byte-for-byte compatible (existing vitest suite
// pins exact Number math incl. basalt/mega/super tests). New code should use
// the exact string-math layer below.
// ---------------------------------------------------------------------------

export interface NavInput {
  scaledAmounts: number[]; // per constituent
  prices: number[]; // USD per scaled unit
  supply: number; // share supply (6 decimals -> human)
  targetWeightsBps: number[];
}

export function computeNav(scaledAmounts: number[], prices: number[]): number {
  let nav = 0;
  for (let i = 0; i < scaledAmounts.length; i++) nav += scaledAmounts[i] * (prices[i] ?? 0);
  return nav;
}

export function computeSharePrice(nav: number, supply: number): number {
  if (supply === 0) return 0;
  return nav / supply;
}

export function computeDrift(scaledAmounts: number[], targetBps: number[]): number[] {
  const total = scaledAmounts.reduce((a, b) => a + b, 0);
  if (total === 0) return targetBps.map(() => 0);
  return scaledAmounts.map((s, i) => {
    const actualBps = Math.round((s / total) * 10_000);
    return actualBps - targetBps[i];
  });
}

// Example (§5): TSLA 50/30/20, scaled 500/300/200, prices 250/100/180
// NAV = 500*250 +300*100 +200*180 =125k+30k+36k=191k; supply 10 => price 19.1k

// ---------------------------------------------------------------------------
// Exact fixed-point core (decimal-string math, no float drift on big values)
// ---------------------------------------------------------------------------

/** Fixed-point digits used for NAV / share-price / return values (USD). */
export const NAV_SCALE = 12;
/** Digits used when normalizing scaled-amount strings for weight math. */
const WEIGHT_SCALE = 18;
const BPS_DENOM = 10_000n;

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse a decimal string (or f64 via its shortest round-trip repr, which may
 * use exponent notation) into a BigInt of `scale` fractional digits.
 * Half-up rounding when the input has more precision than `scale`.
 * Throws on malformed input — callers pass already-validated DB values.
 */
export function decimalToFixedUnits(value: string | number, scale: number): bigint {
  const s = typeof value === "number" ? (() => {
    if (!Number.isFinite(value)) throw new Error(`decimalToFixedUnits: non-finite number ${value}`);
    return String(value);
  })() : value;
  const m = DECIMAL_RE.exec(s.trim());
  if (!m) throw new Error(`decimalToFixedUnits: invalid decimal ${JSON.stringify(value)}`);
  const negative = m[1] === "-";
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  const exp = m[4] ? BigInt(m[4]) : 0n;
  const digits = BigInt((intPart + fracPart) === "" ? "0" : intPart + fracPart);
  const fracLen = BigInt(fracPart.length);
  const shift = exp - fracLen + BigInt(scale);
  let units: bigint;
  if (shift >= 0n) {
    units = digits * 10n ** shift;
  } else {
    const div = 10n ** -shift;
    const q = digits / div;
    const r = digits % div;
    units = r * 2n >= div ? q + 1n : q; // half-up
  }
  return negative ? -units : units;
}

/** Format a `scale`-digit fixed-point BigInt as a plain decimal string. */
export function fixedUnitsToDecimalString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  if (scale <= 0) return `${negative ? "-" : ""}${abs}`;
  const den = 10n ** BigInt(scale);
  const whole = abs / den;
  const frac = abs % den;
  if (frac === 0n) return `${negative ? "-" : ""}${whole}`;
  const fracStr = frac.toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}.${fracStr}`;
}

/**
 * a × b where both are `scale`-digit fixed-point; result at the same scale.
 * Half-up rounding (sign-preserving).
 */
export function mulFixed(a: bigint, b: bigint, scale: number): bigint {
  const product = a * b;
  const den = 10n ** BigInt(scale);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const q = abs / den;
  const r = abs % den;
  const rounded = r * 2n >= den ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * num / den scaled to `scale` fractional digits. Half-up rounding
 * (sign-preserving). den === 0 throws (callers guard).
 */
export function divFixed(num: bigint, den: bigint, scale: number): bigint {
  if (den === 0n) throw new Error("divFixed: division by zero");
  const negative = num < 0n !== den < 0n;
  const a = num < 0n ? -num : num;
  const b = den < 0n ? -den : den;
  const shifted = a * 10n ** BigInt(scale);
  const q = shifted / b;
  const r = shifted % b;
  const rounded = r * 2n >= b ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/**
 * NAV = Σ(scaled_i × price_i) in exact fixed point.
 * scaledAmounts are exact decimal strings (human units — vault_holdings.
 * scaled_amount); prices are f64 USD (null/NaN/missing ⇒ 0 contribution, the
 * price_source provenance on the snapshot records what was used).
 */
export function computeNavExact(
  scaledAmounts: Array<string | number>,
  prices: Array<number | null | undefined>,
): string {
  const n = Math.min(scaledAmounts.length, prices.length);
  let total = 0n;
  for (let i = 0; i < n; i++) {
    const price = prices[i];
    if (price === null || price === undefined || !Number.isFinite(price)) continue;
    const scaledUnits = decimalToFixedUnits(scaledAmounts[i], NAV_SCALE);
    if (scaledUnits === 0n) continue;
    const priceUnits = decimalToFixedUnits(price, NAV_SCALE);
    total += mulFixed(scaledUnits, priceUnits, NAV_SCALE);
  }
  return fixedUnitsToDecimalString(total, NAV_SCALE);
}

/**
 * share_price = nav / supply exactly (spec §7: `share_price NUMERIC — nav /
 * supply`, supply in raw u64 base units, matching the basket_rankings matview
 * formula). Supply 0 ⇒ "0".
 */
export function computeSharePriceExact(nav: string | number, supplyRaw: string | number): string {
  const supply = BigInt(supplyRaw);
  if (supply === 0n) return "0";
  const navUnits = decimalToFixedUnits(nav, NAV_SCALE);
  // nav is at NAV_SCALE, supply at scale 0 → the quotient lands at NAV_SCALE.
  return fixedUnitsToDecimalString(divFixed(navUnits, supply, 0), NAV_SCALE);
}

/**
 * Drift per AGENTS.md §17: actual_weight_bps = scaled_i/Σscaled × 10_000
 * (half-up rounding), drift = actual − target. Computed in BigInt on the
 * exact decimal strings so huge holdings round deterministically. Constituents
 * with a target but no indexed holding count as 0 actual weight (honest
 * −target drift instead of silently dropping them).
 */
export function computeDriftExact(
  scaledAmounts: Array<string | number>,
  targetBps: number[],
): { actualWeightsBps: number[]; driftBps: number[] } {
  const units = scaledAmounts.map((s) => decimalToFixedUnits(s, WEIGHT_SCALE));
  const total = units.reduce((acc, u) => acc + (u > 0n ? u : -u), 0n);
  const n = Math.max(units.length, targetBps.length);
  if (total === 0n) {
    // No holdings → no weight information; report zeros (matches the legacy
    // computeDrift behavior) rather than fabricated -target drift.
    return {
      actualWeightsBps: Array.from({ length: n }, () => 0),
      driftBps: Array.from({ length: n }, () => 0),
    };
  }
  const actual: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = units[i] ?? 0n;
    const abs = u > 0n ? u : -u;
    actual.push(Number(divFixed(abs * BPS_DENOM, total, 0)));
  }
  const driftBps = actual.map((a, i) => a - (targetBps[i] ?? 0));
  return { actualWeightsBps: actual, driftBps };
}

/**
 * Percentage return (latest vs baseline) in exact fixed point, as a decimal
 * string. Returns null when the baseline is missing or ≤ 0 — callers surface
 * "insufficient data" instead of a fabricated number.
 */
export function pctReturnExact(latest: string | number, baseline: string | number): string | null {
  const latestUnits = decimalToFixedUnits(latest, NAV_SCALE);
  const baseUnits = decimalToFixedUnits(baseline, NAV_SCALE);
  if (baseUnits <= 0n) return null;
  // pct = (latest − baseline) × 100 / baseline — both operands at NAV_SCALE,
  // ×100 folded into the numerator, result formatted at NAV_SCALE.
  return fixedUnitsToDecimalString(divFixed((latestUnits - baseUnits) * 100n, baseUnits, NAV_SCALE), NAV_SCALE);
}

export interface PerformanceWindow {
  window: string;
  pct: string | null; // exact decimal string, e.g. "4.231" (%) — null = insufficient data
  baselineNav: string | null;
  baselineTs: string | null;
}

/**
 * Build the performance response (spec §8: 24h/7d/30d/90d/inception) from the
 * SQL-fetched window baselines + latest snapshot. Pure — unit-tested.
 */
export function computePerformanceFromBaselines(
  latest: { nav: string; ts: string } | null,
  baselines: Array<{ window: string; nav: string | null; ts: string | null }>,
): { latest: { nav: string; ts: string } | null; windows: Record<string, PerformanceWindow> } {
  const windows: Record<string, PerformanceWindow> = {};
  for (const b of baselines) {
    windows[b.window] = {
      window: b.window,
      pct: latest && b.nav ? pctReturnExact(latest.nav, b.nav) : null,
      baselineNav: b.nav,
      baselineTs: b.ts,
    };
  }
  return { latest, windows };
}

// ---------------------------------------------------------------------------
// NAV cache — Redis when REDIS_URL is set, else an in-memory TTL map
// ---------------------------------------------------------------------------

export interface KeyValueCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export interface InMemoryCacheOptions {
  maxEntries?: number;
  maxBytes?: number;
  cleanupBatchSize?: number;
}
interface MemoryCacheEntry { value: string; expiresAt: number; bytes: number }

/** Optional cache writes are dropped at capacity; live entries are never evicted. */
export class InMemoryCache implements KeyValueCache {
  private readonly store = new Map<string, MemoryCacheEntry>();
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly cleanupBatchSize: number;
  private cleanupIterator: IterableIterator<[string, MemoryCacheEntry]> | undefined;
  private bytes = 0;
  constructor(private readonly now: () => number = () => Date.now(), options: InMemoryCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1024;
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
    this.cleanupBatchSize = options.cleanupBatchSize ?? 16;
    for (const [name,value] of Object.entries({maxEntries:this.maxEntries,maxBytes:this.maxBytes,cleanupBatchSize:this.cleanupBatchSize})) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive safe integer`);
    }
  }
  get entryCount(): number { return this.store.size; }
  get storedBytes(): number { return this.bytes; }

  private remove(key: string, entry: MemoryCacheEntry): void {
    this.store.delete(key);
    this.bytes -= entry.bytes;
  }
  private pruneExpired(now: number): void {
    this.cleanupIterator ??= this.store.entries();
    for (let inspected=0; inspected<this.cleanupBatchSize; inspected++) {
      const item = this.cleanupIterator.next();
      if (item.done) { this.cleanupIterator = undefined; break; }
      const [key,entry] = item.value;
      if (entry.expiresAt <= now) this.remove(key,entry);
    }
  }
  async get(key: string): Promise<string | null> {
    const now = this.now();
    this.pruneExpired(now);
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= now) {
      this.remove(key,hit);
      return null;
    }
    return hit.value;
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    const now = this.now();
    this.pruneExpired(now);
    const expiresAt = now + ttlSeconds * 1000;
    if (!Number.isFinite(expiresAt) || ttlSeconds <= 0) return;
    const bytes = Buffer.byteLength(key,"utf8") + Buffer.byteLength(value,"utf8");
    const existing = this.store.get(key);
    if ((!existing && this.store.size >= this.maxEntries) || bytes > this.maxBytes ||
        this.bytes - (existing?.bytes ?? 0) + bytes > this.maxBytes) return;
    this.store.set(key,{value,expiresAt,bytes});
    this.bytes += bytes - (existing?.bytes ?? 0);
  }
}

/** Minimal structural slice of ioredis used here. */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export class RedisCache implements KeyValueCache {
  private warned = false;
  constructor(
    private readonly client: RedisLike,
    private readonly fallback: KeyValueCache = new InMemoryCache(),
  ) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.warnOnce(err);
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, value, "EX", ttlSeconds);
    } catch (err) {
      this.warnOnce(err);
      await this.fallback.set(key, value, ttlSeconds);
    }
  }

  private warnOnce(err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn("[navCache] Redis unavailable — serving from in-memory fallback:",
      err instanceof Error ? err.message : err);
  }
}

/**
 * Redis-backed cache from REDIS_URL, else an in-memory TTL map (spec §7).
 * Never throws — a broken Redis degrades to in-memory.
 */
export async function createCacheFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<KeyValueCache> {
  const url = env.REDIS_URL;
  if (!url) return new InMemoryCache();
  try {
    const mod = (await import("ioredis")) as unknown as { default: new (url: string) => RedisLike };
    const Redis = mod.default;
    const client = new Redis(url);
    client.on("error", (err: unknown) => {
      console.warn("[navCache] Redis error:", err instanceof Error ? err.message : err);
    });
    console.log(`[navCache] Redis cache enabled (${url})`);
    return new RedisCache(client);
  } catch (err) {
    console.warn("[navCache] Redis unavailable — using in-memory cache:",
      err instanceof Error ? err.message : err);
    return new InMemoryCache();
  }
}

// ---------------------------------------------------------------------------
// NavEngine worker
// ---------------------------------------------------------------------------

/** Genesis share supply minted at basket creation (programs/basket GENESIS_SHARES). */
const GENESIS_SHARES_RAW = 1_000_000n;

export interface SupplyFetch {
  supply: string; // raw u64 base units, decimal string
  source: "rpc" | "events-derived";
  authenticated?: boolean;
}

export type SupplyFetcher = (shareMint: string, basket: string) => Promise<SupplyFetch | null>;

/** Structural slice of @solana/web3.js Connection used for supply reads. */
export interface SupplyRpc {
  getAccountInfo(mint: PublicKey, commitment?: "finalized"): Promise<AccountInfo<Buffer> | null>;
}

/** Real on-chain supply via getTokenSupply (u64 → decimal string). 429s go
 *  through the shared RPC backoff before the events-derived fallback runs. */
export async function fetchSupplyRawFromRpc(rpc: SupplyRpc, shareMint: string, basket: string): Promise<SupplyFetch | null> {
  try {
    const address = new PublicKey(shareMint);
    const info = await withRpcBackoff(() => rpc.getAccountInfo(address, "finalized"), {
      logKey: "navEngine:getShareMint",
    });
    if (!info || info.executable || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
    const mint = unpackMint(address, info, TOKEN_2022_PROGRAM_ID);
    if (!mint.isInitialized || info.data[45] !== 1 || mint.decimals !== 6 ||
        !mint.mintAuthority?.equals(deriveVaultAuthority(new PublicKey(basket)))) return null;
    return { supply: mint.supply.toString(), source: "rpc", authenticated: true };
  } catch (err) {
    console.warn(`[navEngine] getTokenSupply failed for ${shareMint}:`,
      err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Events-derived supply estimate when RPC is unavailable:
 *   supply = GENESIS(1M) + Σ Minted.grossShares − Σ Redeemed.sharesBurned
 *          + Σ FeeAccrued.sharesMinted
 * (u64 values live in events.data JSONB as decimal strings; numeric casts are
 * summed in SQL and returned as text). Marked "events-derived" — accurate only
 * when the indexer saw every event since creation.
 */
export async function fetchSupplyFromEvents(db: PgLike, basket: string): Promise<SupplyFetch | null> {
  try {
    const res = await db.query(
      `SELECT (1000000
         + COALESCE(SUM((data->>'grossShares')::numeric)   FILTER (WHERE type = 'Minted'), 0)
         - COALESCE(SUM((data->>'sharesBurned')::numeric)  FILTER (WHERE type = 'Redeemed'), 0)
         + COALESCE(SUM((data->>'sharesMinted')::numeric)  FILTER (WHERE type = 'FeeAccrued'), 0)
       )::text AS supply
       FROM events WHERE basket = $1`,
      [basket],
    );
    const supply = res.rows[0]?.supply;
    if (typeof supply !== "string" || supply === "") return null;
    return { supply, source: "events-derived" };
  } catch (err) {
    console.warn(`[navEngine] events-derived supply failed for ${basket}:`,
      err instanceof Error ? err.message : err);
    return null;
  }
}

export interface NavEngineDeps {
  db: PgLike | null;
  cache?: KeyValueCache | null;
  /** Price provider — defaults to fetchPriceQuotes (Jupiter v6, source-marked). */
  fetchQuotes?: (mints: string[]) => Promise<PriceQuoteMap>;
  /** Supply provider — defaults to RPC when wired, else events-derived from DB. */
  fetchSupply?: SupplyFetcher;
  now?: () => Date;
  /** NAV pass cadence ms (spec §7: nav_snapshot queue every 60s). */
  intervalMs?: number;
  /** basket_rankings REFRESH cadence ms (spec §7: ~5m). */
  rankingsRefreshMs?: number;
  inputMaxAgeMs?: number;
  log?: (msg: string) => void;
}

export interface BasketNavComputation {
  basket: string;
  nav: string;
  supplyRaw: string;
  supplySource: "rpc" | "events-derived";
  sharePrice: string;
  actualWeightsBps: number[];
  driftBps: number[];
  priceSource: Record<string, { price: number; source: string; asOf: string; unit?: "scaled-ui"; blockId?: number }>;
  asOf: string;
  /** Why nothing was persisted (holdings/supply/prices missing). */
  skipReason?: string;
  quality: {
    eligible: boolean;
    complete: boolean;
    status: string;
    expectedConstituents: number;
    authenticatedHoldings: number;
    validQuotes: number;
    supplyAuthenticated: boolean;
    missingHoldings: string[];
    invalidHoldings: string[];
    invalidQuotes: string[];
    holdingsObservedAt: Record<string, string>;
  };
}

export interface NavRunSummary {
  basketsConsidered: number;
  computations: BasketNavComputation[];
  snapshotsPersisted: number;
  cacheWrites: number;
  rankingsRefreshed: boolean;
  reason?: string; // set when the whole pass was skipped (e.g. "no-db")
}

export const NAV_SNAPSHOT_TTL_SECONDS = 15; // spec §7: nav:{basket} TTL 15s
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_RANKINGS_REFRESH_MS = 300_000;
/**
 * Minimum spacing between the NAV engine's sequential RPC supply reads
 * (getTokenSupply per basket). The 60s NAV cadence is unchanged; the reads
 * inside one pass are staggered so they cannot land as a burst.
 */
const NAV_SUPPLY_RPC_GAP_MS = 150;

interface BasketCoreRow {
  pubkey: string;
  share_mint: string;
  constituents: string[];
  weights_bps: number[];
}

interface HoldingsRowLite {
  mint: string;
  scaled_amount: string;
  authenticated: boolean;
  updated_at: Date | string;
}

export class NavEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRankingsRefreshMs = 0;
  private passInFlight: Promise<NavRunSummary> | null = null;

  constructor(private readonly deps: NavEngineDeps) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const interval = this.deps.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => {
        console.warn("[navEngine] runOnce failed:", err instanceof Error ? err.message : err);
      });
    }, interval);
    this.timer.unref?.();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One NAV pass. With no DB this degrades honestly: nothing is computed
   * against real holdings, so we persist nothing and say so.
   */
  async runOnce(): Promise<NavRunSummary> {
    if (this.passInFlight) return this.passInFlight;
    const pass = this.runPass();
    this.passInFlight = pass;
    try { return await pass; }
    finally { if (this.passInFlight === pass) this.passInFlight = null; }
  }

  private async runPass(): Promise<NavRunSummary> {
    const db = this.deps.db;
    const now = this.deps.now ?? (() => new Date());
    const summary: NavRunSummary = {
      basketsConsidered: 0,
      computations: [],
      snapshotsPersisted: 0,
      cacheWrites: 0,
      rankingsRefreshed: false,
    };
    if (!isPgLike(db)) {
      summary.reason = "no-db";
      return summary;
    }

    let baskets: BasketCoreRow[];
    try {
      const res = await db.query(
        "SELECT pubkey, share_mint, constituents, weights_bps FROM baskets ORDER BY created_at ASC",
      );
      baskets = res.rows as BasketCoreRow[];
    } catch (err) {
      summary.reason = `baskets query failed: ${err instanceof Error ? err.message : err}`;
      return summary;
    }
    summary.basketsConsidered = baskets.length;

    const asOf = now().toISOString();
    for (const basket of baskets) {
      const computation = await this.computeForBasket(db, basket, asOf);
      summary.computations.push(computation);
      if (!computation.skipReason) {
        const persisted = await this.persistSnapshot(db, computation);
        if (persisted) summary.snapshotsPersisted++;
        else {
          computation.skipReason = "snapshot-persist-failed";
          computation.quality.eligible = false;
          computation.quality.complete = false;
        }
      }
      try {
        const stateRecorded = await recordValuationAttempt(db, basket.pubkey, {
          complete: !computation.skipReason,
          reason: computation.skipReason ?? null,
          attemptedAt: computation.asOf,
          missingPriceMints: computation.quality.invalidQuotes,
        });
        if (!stateRecorded) {
          computation.skipReason = "newer-valuation-state";
          computation.quality.eligible = false;
        }
      } catch (error) {
        computation.skipReason = "valuation-state-write-failed";
        computation.quality.eligible = false;
        console.warn(`[navEngine] valuation state write failed for ${basket.pubkey}:`, error instanceof Error ? error.message : error);
      }
    }

    // Cache nav:{basket} for every computation that produced a NAV (even
    // skipped-persist ones carry computable values — they are labeled).
    const cache = this.deps.cache;
    if (cache) {
      for (const c of summary.computations) {
        if (c.skipReason || !c.quality.eligible) continue;
        try {
          await cache.set(
            `nav:${c.basket}`,
            JSON.stringify({
              basket: c.basket,
              nav: c.nav,
              supply: c.supplyRaw,
              supplySource: c.supplySource,
              sharePrice: c.sharePrice,
              driftBps: c.driftBps,
              priceSource: c.priceSource,
              asOf: c.asOf,
              source: "onchain-indexed",
              skipped: c.skipReason ?? null,
              valuation: c.quality,
            }),
            NAV_SNAPSHOT_TTL_SECONDS,
          );
          summary.cacheWrites++;
        } catch (err) {
          console.warn(`[navEngine] cache write failed for ${c.basket}:`,
            err instanceof Error ? err.message : err);
        }
      }
    }

    // Refresh basket_rankings on its own cadence (first pass refreshes).
    const refreshMs = this.deps.rankingsRefreshMs ?? DEFAULT_RANKINGS_REFRESH_MS;
    const nowMs = now().getTime();
    if (nowMs - this.lastRankingsRefreshMs >= refreshMs) {
      this.lastRankingsRefreshMs = nowMs;
      summary.rankingsRefreshed = await this.refreshRankings(db);
    }

    return summary;
  }

  /** Value one basket from its indexed holdings + prices + supply. */
  async computeForBasket(db: PgLike, basket: BasketCoreRow, asOf: string): Promise<BasketNavComputation> {
    const base: BasketNavComputation = {
      basket: basket.pubkey,
      nav: "0",
      supplyRaw: "0",
      supplySource: "rpc",
      sharePrice: "0",
      actualWeightsBps: [],
      driftBps: [],
      priceSource: {},
      asOf,
      quality: {
        eligible: false, complete: false, status: "incomplete", expectedConstituents: basket.constituents?.length ?? 0,
        authenticatedHoldings: 0, validQuotes: 0, supplyAuthenticated: false,
        missingHoldings: [], invalidHoldings: [], invalidQuotes: [], holdingsObservedAt: {},
      },
    };

    let holdings: HoldingsRowLite[];
    try {
      const res = await db.query(
        "SELECT mint, scaled_amount::text AS scaled_amount, authenticated, updated_at FROM vault_holdings WHERE basket = $1",
        [basket.pubkey],
      );
      holdings = res.rows as HoldingsRowLite[];
    } catch (err) {
      return { ...base, skipReason: `holdings query failed: ${err instanceof Error ? err.message : err}` };
    }
    if (holdings.length === 0) {
      return { ...base, skipReason: "no-holdings" };
    }

    const mints = basket.constituents;
    let valuationTime = Date.parse(asOf);
    const maxAge = this.deps.inputMaxAgeMs ?? NAV_INPUT_MAX_AGE_MS;
    const fresh = (value: Date | string): boolean => {
      const timestamp = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
      const age = valuationTime - timestamp;
      return Number.isFinite(age) && age >= 0 && age <= maxAge;
    };
    if (!Array.isArray(mints) || mints.length < 2 || mints.length > 20 || new Set(mints).size !== mints.length ||
        !Array.isArray(basket.weights_bps) || basket.weights_bps.length !== mints.length ||
        basket.weights_bps.some((weight) => !Number.isInteger(weight) || weight <= 0) ||
        basket.weights_bps.reduce((total, weight) => total + weight, 0) !== 10_000) {
      return { ...base, skipReason: "invalid-constituents" };
    }
    const byMint = new Map(holdings.map((holding) => [holding.mint, holding]));
    base.quality.missingHoldings = mints.filter((mint) => !byMint.has(mint));
    base.quality.invalidHoldings = mints.filter((mint) => {
      const holding = byMint.get(mint);
      if (!holding) return false;
      try {
        return holding.authenticated !== true || !fresh(holding.updated_at) ||
          decimalToFixedUnits(holding.scaled_amount, NAV_SCALE) < 0n;
      } catch { return true; }
    });
    base.quality.authenticatedHoldings = mints.length - base.quality.missingHoldings.length - base.quality.invalidHoldings.length;
    if (byMint.size !== holdings.length || holdings.some((holding) => !mints.includes(holding.mint)) ||
        base.quality.missingHoldings.length || base.quality.invalidHoldings.length) {
      return { ...base, skipReason: "incomplete-holdings" };
    }
    holdings = mints.map((mint) => byMint.get(mint)!);
    base.quality.holdingsObservedAt = Object.fromEntries(holdings.map((holding) => [holding.mint, new Date(holding.updated_at).toISOString()]));
    const fetchQuotes = this.deps.fetchQuotes ?? ((ms: string[]) => fetchPriceQuotes(ms));
    let quotes: PriceQuoteMap;
    try { quotes = await fetchQuotes(mints); }
    catch { return { ...base, skipReason: "prices-unavailable" }; }
    valuationTime = Math.max(valuationTime, (this.deps.now?.() ?? new Date()).getTime());
    base.asOf = new Date(valuationTime).toISOString();

    // price_source JSONB: map of mint → {price, source, asOf} (spec §7), with
    // absent mints explicitly labeled source "missing" so a partial NAV is
    // self-describing instead of silently understated.
    const priceSource: BasketNavComputation["priceSource"] = {};
    const prices: Array<number | null> = [];
    for (const mint of mints) {
      const q = quotes[mint];
      if (q && q.mint === mint && q.source === "jupiter" && q.unit === "scaled-ui" &&
          Number.isFinite(q.price) && q.price > 0 && fresh(q.asOf)) {
        priceSource[mint] = { price: q.price, source: q.source, asOf: q.asOf,
          ...(q.unit ? { unit: q.unit } : {}), ...(q.blockId ? { blockId: q.blockId } : {}) };
        prices.push(q.price);
      } else {
        base.quality.invalidQuotes.push(mint);
        prices.push(null);
      }
    }
    base.quality.validQuotes = mints.length - base.quality.invalidQuotes.length;
    if (base.quality.invalidQuotes.length) {
      return { ...base, priceSource, skipReason: base.quality.validQuotes ? "incomplete-prices" : "no-prices" };
    }

    const fetchSupply = this.deps.fetchSupply ?? (async () => null);
    let supplyFetch: SupplyFetch | null;
    try { supplyFetch = await fetchSupply(basket.share_mint, basket.pubkey); }
    catch { supplyFetch = null; }
    if (!supplyFetch || supplyFetch.source !== "rpc" || supplyFetch.authenticated !== true ||
        !/^\d{1,20}$/.test(supplyFetch.supply) || BigInt(supplyFetch.supply) <= 0n || BigInt(supplyFetch.supply) > 18_446_744_073_709_551_615n) {
      return { ...base, priceSource, skipReason: "unauthenticated-supply" };
    }
    base.quality.supplyAuthenticated = true;
    valuationTime = Math.max(valuationTime, (this.deps.now?.() ?? new Date()).getTime());
    base.asOf = new Date(valuationTime).toISOString();
    if (holdings.some((holding) => !fresh(holding.updated_at)) || mints.some((mint) => !fresh(quotes[mint].asOf))) {
      return { ...base, priceSource, skipReason: "inputs-expired-during-read" };
    }

    const nav = computeNavExact(
      holdings.map((h) => h.scaled_amount),
      prices,
    );
    const sharePrice = computeSharePriceExact(nav, supplyFetch.supply);
    const drift = computeDriftExact(
      holdings.map((h) => h.scaled_amount),
      basket.weights_bps ?? [],
    );

    return {
      ...base,
      nav,
      supplyRaw: supplyFetch.supply,
      supplySource: supplyFetch.source,
      sharePrice,
      actualWeightsBps: drift.actualWeightsBps,
      driftBps: drift.driftBps,
      priceSource,
      quality: { ...base.quality, eligible: true, complete: true, status: "complete" },
    };
  }

  private async persistSnapshot(db: PgLike, c: BasketNavComputation): Promise<boolean> {
    try {
      const result = await db.query(
        `INSERT INTO nav_snapshots (basket, ts, nav, supply, share_price, price_source, valuation_eligible, valuation_status)
         SELECT $1, $2, $3, $4, $5, $6, true, 'complete'
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_each_text($7::jsonb) expected
           LEFT JOIN vault_holdings h ON h.basket=$1 AND h.mint=expected.key
           WHERE h.authenticated IS DISTINCT FROM true
             OR h.updated_at IS DISTINCT FROM expected.value::timestamptz
         )`,
        [c.basket, new Date(c.asOf), c.nav, c.supplyRaw, c.sharePrice,
          JSON.stringify({ ...c.priceSource, __valuation: c.quality }), JSON.stringify(c.quality.holdingsObservedAt)],
      );
      return result.rowCount === 1;
    } catch (err) {
      console.warn(`[navEngine] snapshot insert failed for ${c.basket}:`,
        err instanceof Error ? err.message : err);
      return false;
    }
  }

  /**
   * REFRESH MATERIALIZED VIEW CONCURRENTLY basket_rankings — legal because the
   * schema creates the unique index (schema.sql basket_rankings_pubkey_idx).
   */
  private async refreshRankings(db: PgLike): Promise<boolean> {
    try {
      await db.query("REFRESH MATERIALIZED VIEW CONCURRENTLY basket_rankings");
      return true;
    } catch (err) {
      console.warn("[navEngine] basket_rankings refresh failed:",
        err instanceof Error ? err.message : err);
      return false;
    }
  }
}

/**
 * Env-gated factory: NAV engine enabled only with a DB (holdings are its
 * input) unless NAV_ENGINE=0 forces it off. RPC_URL additionally enables the
 * real on-chain supply read; without it supply falls back to the events-derived
 * estimate (marked as such).
 */
export function createNavEngineFromEnv(opts: {
  db: PgLike | null;
  cache?: KeyValueCache | null;
  env?: NodeJS.ProcessEnv;
  rpcUrl?: string | null;
}): NavEngine | null {
  const env = opts.env ?? process.env;
  if (env.NAV_ENGINE === "0") {
    console.warn("[navEngine] disabled by NAV_ENGINE=0");
    return null;
  }
  if (!isPgLike(opts.db)) {
    console.warn("[navEngine] disabled — no Postgres (DB-less mode)");
    return null;
  }
  const db = opts.db;
  let fetchSupply: SupplyFetcher;
  const rpcUrl = opts.rpcUrl ?? env.RPC_URL ?? null;
  if (rpcUrl) {
    // Real on-chain supply first; events-derived estimate as fallback.
    // Sequential reads are staggered (NAV_SUPPLY_RPC_GAP_MS) so a multi-basket
    // pass spreads its RPC load instead of bursting it.
    const conn = createReadOnlyRpcConnection(rpcUrl);
    const supplyPacer = createPacer(NAV_SUPPLY_RPC_GAP_MS);
    fetchSupply = async (shareMint: string, basket: string) => {
      await supplyPacer.wait();
      return (await fetchSupplyRawFromRpc(conn, shareMint, basket)) ?? fetchSupplyFromEvents(db, basket);
    };
  } else {
    fetchSupply = (_shareMint: string, basket: string) => fetchSupplyFromEvents(db, basket);
  }
  const intervalMs = Number(env.NAV_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const rankingsRefreshMs = Number(env.NAV_RANKINGS_REFRESH_MS || DEFAULT_RANKINGS_REFRESH_MS);
  console.log(`[navEngine] enabled (interval ${intervalMs}ms, rankings refresh ${rankingsRefreshMs}ms)`);
  // Mock-aware prices: Jupiter first; mints whose whitelisted_mints row is
  // labeled "mock:<slug>" (devnet mock xStocks) are filled — with
  // REALISTIC_MOCK_PRICES on — from the real equity market (source "yahoo",
  // workers/realisticMockPrices.ts), falling back per-symbol to the
  // deterministic dev catalog (source "mock", workers/mockPriceFill.ts).
  const fetchQuotes = createMockAwareQuoteFetcher(db, { env });
  return new NavEngine({
    db,
    cache: opts.cache ?? null,
    fetchQuotes,
    fetchSupply,
    intervalMs,
    rankingsRefreshMs,
  });
}

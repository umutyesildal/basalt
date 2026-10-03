/** Cached, read-only Solana token quotes. Never authorizes trades or changes raw balances. */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getCachedXStockCatalog, getXStockCatalog, type CatalogResult } from "../catalog/xstocks.js";
import { fetchPriceQuoteResults, restoreLastValidPriceQuotes, type PricePoint, type PriceQuoteResult, type PriceRefreshOutcome } from "./priceFetch.js";
import { getPriceBlockTimes } from "./priceBlockTime.js";
import { getNyseMarketSession, type MarketSession } from "./marketSession.js";

export const XSTOCK_FULL_REFRESH_MS = 5 * 60_000;
export const XSTOCK_HOT_REFRESH_MS = 60_000;
export const XSTOCK_HOT_TTL_MS = 10 * 60_000;
const MAX_HOT_MINTS = 500;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;
export interface CachedXStockQuote {
  mint: string;
  priceUsd: number | null;
  source: "jupiter" | "unavailable";
  fetchedAt: string | null;
  observedAt: string | null;
  blockId: number | null;
  decimals: number | null;
  unit: "scaled-ui";
  change24hPct: number | null;
  status: "available" | "unavailable";
  stale: boolean;
  freshness: "fresh" | "stale" | "unavailable";
  /** Most recent provider attempt. It never replaces fetchedAt or observedAt. */
  refreshedAt: string | null;
  refreshReason: PriceRefreshOutcome | null;
}
interface Entry { point: PricePoint | null; observedAt: string | null; refreshedAt: string; outcome: PriceRefreshOutcome; restored?: boolean }
export interface XStockQuoteOptions {
  now?: () => Date;
  fetchImpl?: typeof fetch;
  /** null disables disk persistence (tests/embedded handlers). */
  cachePath?: string | null;
  catalog?: () => CatalogResult;
  refreshCatalog?: () => Promise<CatalogResult>;
  fetchQuotes?: (mints: string[], signal: AbortSignal) => Promise<Record<string, PriceQuoteResult>>;
  blockTimes?: (slots: number[], signal: AbortSignal) => Promise<Record<number, string | null>>;
  fullRefreshMs?: number;
  hotRefreshMs?: number;
  hotTtlMs?: number;
  minRequestIntervalMs?: number;
  coldWaitMs?: number;
  /** Injectable session clock for deterministic tests; production always uses NYSE cash hours. */
  marketSession?: (now: Date) => MarketSession;
}
function interval(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}
function timestamp(value: unknown, now: number): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 && Date.parse(value) <= now + 60_000;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

export class XStockQuoteService {
  private readonly entries = new Map<string, Entry>();
  private readonly hot = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly jobs = new Set<Promise<void>>();
  private readonly clock: () => Date;
  private readonly cachePath: string | null;
  private readonly readCatalog: () => CatalogResult;
  private readonly loadCatalog: () => Promise<CatalogResult>;
  private readonly quoteProvider: NonNullable<XStockQuoteOptions["fetchQuotes"]>;
  private readonly blockProvider: NonNullable<XStockQuoteOptions["blockTimes"]>;
  private readonly requestIntervalMs: number;
  readonly fullRefreshMs: number;
  readonly hotRefreshMs: number;
  private readonly hotTtlMs: number;
  private readonly coldWaitMs: number;
  private initialLoad: Promise<void> | null = null;
  private persistence: Promise<void> = Promise.resolve();
  private turn: Promise<void> = Promise.resolve();
  private lastRequestStarted = 0;
  private providerRetryAt = 0;
  private controller = new AbortController();
  private fullTimer: ReturnType<typeof setInterval> | null = null;
  private hotTimer: ReturnType<typeof setInterval> | null = null;
  private marketTimer: ReturnType<typeof setTimeout> | null = null;
  private fullJob: Promise<void> | null = null;
  private hotJob: Promise<void> | null = null;
  private running = false;
  private stopped = false;
  private lastFullRefreshAt: string | null = null;
  private lastFullPass: { requested: number; priced: number; omitted: number; outage: number } | null = null;

  constructor(private readonly opts: XStockQuoteOptions = {}) {
    this.clock = opts.now ?? (() => new Date());
    this.cachePath = opts.cachePath !== undefined ? opts.cachePath : process.env.XSTOCK_PRICE_CACHE_PATH === "0" ? null
      : process.env.XSTOCK_PRICE_CACHE_PATH || fileURLToPath(new URL("../../.cache/xstocks-prices.json", import.meta.url));
    this.readCatalog = opts.catalog ?? (() => getCachedXStockCatalog(this.clock));
    this.loadCatalog = opts.refreshCatalog ?? (() => getXStockCatalog({ fetchImpl: async (input, init) => {
      if (!this.marketSession().isOpen || this.stopped) throw new Error("NYSE session closed");
      const signal = init?.signal ? AbortSignal.any([init.signal, this.controller.signal]) : this.controller.signal;
      return (opts.fetchImpl ?? fetch)(input, { ...init, signal });
    }, now: this.clock }));
    this.fullRefreshMs = opts.fullRefreshMs ?? interval(process.env.XSTOCK_PRICE_FULL_REFRESH_MS, XSTOCK_FULL_REFRESH_MS, 60_000);
    this.hotRefreshMs = opts.hotRefreshMs ?? interval(process.env.XSTOCK_PRICE_HOT_REFRESH_MS, XSTOCK_HOT_REFRESH_MS, 30_000);
    this.hotTtlMs = opts.hotTtlMs ?? XSTOCK_HOT_TTL_MS;
    this.requestIntervalMs = opts.minRequestIntervalMs ?? (opts.fetchImpl ? 0 : 2_100);
    this.coldWaitMs = opts.coldWaitMs ?? 6_500;
    this.quoteProvider = opts.fetchQuotes ?? ((mints, signal) => fetchPriceQuoteResults(mints, {
      fetchImpl: opts.fetchImpl, now: this.clock, forceRefresh: true, fallback: "none", signal, timeoutMs: 4_000, marketSession: now => (this.opts.marketSession ?? getNyseMarketSession)(now),
    }));
    this.blockProvider = opts.blockTimes ?? ((slots, signal) => getPriceBlockTimes(slots, {
      fetchImpl: opts.fetchImpl, now: this.clock, signal, timeoutMs: 1_500,
    }));
  }

  /** Only persisted public data is awaited. No startup network requirement. */
  initialize(): Promise<void> {
    if (!this.initialLoad) this.initialLoad = this.loadSnapshot();
    return this.initialLoad;
  }

  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.scheduleMarketBoundary();
    void this.initialize().then(() => { if (!this.stopped) void this.refreshAll(); });
    this.fullTimer = setInterval(() => { void this.refreshAll(); }, this.fullRefreshMs);
    this.hotTimer = setInterval(() => { void this.refreshHot(); }, this.hotRefreshMs);
    this.fullTimer.unref(); this.hotTimer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true; this.running = false;
    if (this.fullTimer) clearInterval(this.fullTimer);
    if (this.hotTimer) clearInterval(this.hotTimer);
    if (this.marketTimer) clearTimeout(this.marketTimer);
    this.controller.abort();
    await Promise.allSettled([...this.jobs, ...(this.fullJob ? [this.fullJob] : []), ...(this.hotJob ? [this.hotJob] : [])]);
    await this.persistence;
  }

  get isRunning(): boolean { return this.running; }

  marketSession(): MarketSession { return (this.opts.marketSession ?? getNyseMarketSession)(this.clock()); }

  /** Wake at the opening bell, not at an arbitrary five-minute timer boundary. */
  private scheduleMarketBoundary(): void {
    if (this.marketTimer) clearTimeout(this.marketTimer);
    if (!this.running || this.stopped) return;
    const session = this.marketSession();
    if (!session.isOpen) this.controller.abort();
    else if (this.controller.signal.aborted) this.controller = new AbortController();
    const boundary = session.isOpen ? session.closesAt : session.nextOpenAt;
    if (!boundary) return;
    const delay = Math.max(1, Math.min(86_400_000, Date.parse(boundary) - this.clock().getTime()));
    this.marketTimer = setTimeout(() => {
      this.scheduleMarketBoundary();
      if (this.marketSession().isOpen) void this.refreshAll();
    }, delay);
    this.marketTimer.unref();
  }

  private view(mint: string): CachedXStockQuote {
    const entry = this.entries.get(mint);
    const point = entry?.point;
    const now = this.clock().getTime();
    const age = point ? now - Date.parse(point.asOf) : Infinity;
    const ttl = this.hot.has(mint) ? this.hotRefreshMs : this.fullRefreshMs;
    const stale = !!point && (!this.marketSession().isOpen || !!entry?.restored || entry?.outcome !== "priced" || age < 0 || age >= ttl);
    return { mint, priceUsd: point?.price ?? null, source: point ? "jupiter" : "unavailable",
      fetchedAt: point?.asOf ?? null, observedAt: entry?.observedAt ?? null,
      blockId: point?.blockId ?? null, decimals: point?.decimals ?? null, unit: "scaled-ui",
      change24hPct: point?.change24hPct ?? null, status: point ? "available" : "unavailable",
      stale, freshness: point ? stale ? "stale" : "fresh" : "unavailable",
      refreshedAt: entry?.refreshedAt ?? null, refreshReason: entry?.outcome ?? null };
  }

  metadata() {
    const catalog = this.readCatalog();
    const official = new Set(catalog.data.map(asset => asset.mint));
    let cachedAssetCount = 0;
    let pricedAssetCount = 0;
    for (const [mint, entry] of this.entries) {
      if (!official.has(mint) || !entry.point) continue;
      cachedAssetCount++;
      if (entry.outcome === "priced" && !entry.restored) pricedAssetCount++;
    }
    return { source: "jupiter-v3", unit: "scaled-ui", catalogStale: catalog.meta.stale,
      refreshIntervalMs: this.fullRefreshMs, hotRefreshIntervalMs: this.hotRefreshMs,
      lastFullRefreshAt: this.lastFullRefreshAt, catalogAssetCount: official.size,
      pricedAssetCount, cachedAssetCount, refreshing: this.jobs.size > 0 || !!this.fullJob,
      lastFullPass: this.lastFullPass, marketSession: this.marketSession() };
  }

  async getQuotes(mints: string[]): Promise<CachedXStockQuote[]> {
    await this.initialize();
    const now = this.clock().getTime();
    const official = new Set(this.readCatalog().data.map(asset => asset.mint));
    const unique = [...new Set(mints)].filter(mint => official.has(mint));
    for (const mint of unique) { this.hot.delete(mint); this.hot.set(mint, now); }
    this.pruneHot();
    const missing = unique.filter(mint => !this.entries.has(mint));
    const due = unique.filter(mint => {
      const entry = this.entries.get(mint);
      return !entry || entry.restored || now - Date.parse(entry.refreshedAt) >= this.hotRefreshMs;
    });
    if (due.length && !this.stopped && this.marketSession().isOpen) {
      if (this.controller.signal.aborted) this.controller = new AbortController();
      const refresh = this.refresh(due);
      if (missing.length) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([refresh, new Promise<void>(resolve => { timer = setTimeout(resolve, this.coldWaitMs); })]);
        if (timer) clearTimeout(timer);
      }
    }
    return unique.map(mint => this.view(mint));
  }

  private pruneHot(): void {
    const now = this.clock().getTime();
    for (const [mint, seen] of this.hot) if (now - seen >= this.hotTtlMs) this.hot.delete(mint);
    while (this.hot.size > MAX_HOT_MINTS) this.hot.delete(this.hot.keys().next().value!);
  }

  /** One paced background batch at a time leaves room for new visible requests. */
  refreshAll(): Promise<void> {
    if (this.fullJob) return this.fullJob;
    if (this.stopped || !this.marketSession().isOpen) return Promise.resolve();
    const job = (async () => {
      await this.initialize();
      if (this.stopped || !this.marketSession().isOpen) return;
      if (this.controller.signal.aborted) this.controller = new AbortController();
      // Refresh metadata independently; existing verified mints can start immediately.
      void this.loadCatalog().catch(() => {});
      const mints = this.readCatalog().data.map(asset => asset.mint);
      for (let i = 0; i < mints.length && !this.stopped && this.marketSession().isOpen; i += 50) await this.refresh(mints.slice(i, i + 50));
      if (!this.stopped && this.marketSession().isOpen) {
        const outcomes = mints.map(mint => this.entries.get(mint)?.outcome);
        this.lastFullPass = { requested: mints.length, priced: outcomes.filter(outcome => outcome === "priced").length,
          omitted: outcomes.filter(outcome => outcome === "omitted").length, outage: outcomes.filter(outcome => outcome === "outage").length };
        this.lastFullRefreshAt = this.clock().toISOString();
        await this.persist();
      }
    })();
    this.fullJob = job;
    void job.finally(() => { if (this.fullJob === job) this.fullJob = null; }).catch(() => {});
    return job;
  }

  refreshHot(): Promise<void> {
    if (this.hotJob) return this.hotJob;
    if (this.stopped || !this.marketSession().isOpen) return Promise.resolve();
    this.pruneHot();
    const now = this.clock().getTime();
    const mints = [...this.hot.keys()].filter(mint => {
      const entry = this.entries.get(mint);
      return !entry || entry.restored || now - Date.parse(entry.refreshedAt) >= this.hotRefreshMs;
    });
    const job = this.refresh(mints);
    this.hotJob = job;
    void job.finally(() => { if (this.hotJob === job) this.hotJob = null; }).catch(() => {});
    return job;
  }

  private async waitForTurn(): Promise<void> {
    const previous = this.turn;
    let release!: () => void;
    this.turn = new Promise<void>(resolve => { release = resolve; });
    try {
      await previous;
      while (!this.stopped && this.marketSession().isOpen) {
        const delay = Math.max(0, this.lastRequestStarted + this.requestIntervalMs - Date.now(), this.providerRetryAt - Date.now());
        if (delay === 0) break;
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); this.controller.signal.removeEventListener("abort", finish); resolve(); };
          const timer = setTimeout(finish, delay);
          this.controller.signal.addEventListener("abort", finish, { once: true });
        });
        // A concurrent request may have learned a later429reset while we waited.
      }
      this.lastRequestStarted = Date.now();
    } finally { release(); }
  }

  private async refresh(mints: string[]): Promise<void> {
    const existing = [...new Set(mints.flatMap(mint => this.pending.get(mint) ? [this.pending.get(mint)!] : []))];
    const missing = [...new Set(mints)].filter(mint => !this.pending.has(mint));
    const jobs: Promise<void>[] = [...existing];
    // Sequential chunks avoid reserving the whole catalog ahead of visible requests.
    for (let i = 0; i < missing.length && !this.stopped && this.marketSession().isOpen; i += 50) {
      const batch = missing.slice(i, i + 50).filter(mint => !this.pending.has(mint));
      if (!batch.length) continue;
      const job = this.refreshBatch(batch);
      this.jobs.add(job);
      for (const mint of batch) this.pending.set(mint, job);
      jobs.push(job);
      try { await job; } finally {
        this.jobs.delete(job);
        for (const mint of batch) if (this.pending.get(mint) === job) this.pending.delete(mint);
      }
    }
    await Promise.all(jobs);
  }

  private async refreshBatch(mints: string[]): Promise<void> {
    await this.waitForTurn();
    if (this.stopped || !this.marketSession().isOpen) return;
    let results: Record<string, PriceQuoteResult>;
    try { results = await this.quoteProvider(mints, this.controller.signal); }
    catch { results = Object.fromEntries(mints.map(mint => [mint, { point: null, outcome: "outage", refreshedAt: this.clock().toISOString() }])); }
    if (this.stopped || !this.marketSession().isOpen) return;
    for (const result of Object.values(results)) if (result.retryAfterMs) this.providerRetryAt = Math.max(this.providerRetryAt, Date.now() + result.retryAfterMs);
    const slots = [...new Set(mints.flatMap(mint => results[mint]?.point?.blockId ? [results[mint].point!.blockId!] : []))];
    let blockTimes: Record<number, string | null> = {};
    try { if (slots.length) blockTimes = await this.blockProvider(slots, this.controller.signal); } catch { /* Preserve unknown source time. */ }
    if (this.stopped || !this.marketSession().isOpen) return;
    for (const mint of mints) {
      const result = results[mint] ?? { point: null, outcome: "omitted" as const, refreshedAt: this.clock().toISOString() };
      const old = this.entries.get(mint);
      const point = result.point;
      const regressed = !!point?.blockId && !!old?.point?.blockId && point.blockId < old.point.blockId;
      // A lagging upstream replica must not replace a newer observed trade.
      if (!regressed && point && point.source === "jupiter" && point.unit === "scaled-ui" && point.mint === mint && Number.isFinite(point.price) && point.price > 0) {
        this.entries.set(mint, { point: { ...point }, observedAt: point.blockId ? blockTimes[point.blockId] ?? (old?.point?.blockId === point.blockId ? old.observedAt : null) : null,
          refreshedAt: result.refreshedAt, outcome: "priced" });
      } else {
        // Last valid quote retains its original retrieval and source timestamps.
        this.entries.set(mint, { point: old?.point ?? null, observedAt: old?.observedAt ?? null,
          refreshedAt: result.refreshedAt, outcome: result.outcome === "outage" ? "outage" : "omitted" });
      }
    }
    await this.persist();
  }

  private async loadSnapshot(): Promise<void> {
    if (!this.cachePath) return;
    try {
      if ((await stat(this.cachePath)).size > MAX_SNAPSHOT_BYTES) return;
      const data: unknown = JSON.parse(await readFile(this.cachePath, "utf8"));
      if (!object(data) || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 4096) return;
      const official = new Set(this.readCatalog().data.map(asset => asset.mint));
      const now = this.clock().getTime();
      for (const row of data.entries) {
        if (!object(row) || !object(row.point)) continue;
        const point = row.point;
        if (typeof point.mint !== "string" || !official.has(point.mint) || this.entries.has(point.mint)
          || point.source !== "jupiter" || point.unit !== "scaled-ui" || typeof point.price !== "number" || !Number.isFinite(point.price) || point.price <= 0
          || !timestamp(point.asOf, now) || !timestamp(row.refreshedAt, now)) continue;
        const blockId = Number.isSafeInteger(point.blockId) && (point.blockId as number) > 0 ? point.blockId as number : undefined;
        const clean: PricePoint = { mint: point.mint, price: point.price, source: "jupiter", unit: "scaled-ui", asOf: point.asOf,
          ...(blockId ? { blockId } : {}),
          ...(Number.isInteger(point.decimals) && (point.decimals as number) >= 0 && (point.decimals as number) <= 18 ? { decimals: point.decimals as number } : {}),
          ...(typeof point.change24hPct === "number" && Number.isFinite(point.change24hPct) ? { change24hPct: point.change24hPct } : {}) };
        const observedAt = blockId && timestamp(row.observedAt, now) && Date.parse(row.observedAt) <= Date.parse(clean.asOf) + 60_000 ? row.observedAt : null;
        restoreLastValidPriceQuotes([clean]);
        this.entries.set(clean.mint, { point: clean, observedAt, refreshedAt: row.refreshedAt,
          outcome: row.outcome === "omitted" || row.outcome === "outage" ? row.outcome : "priced", restored: true });
      }
    } catch { /* Missing or invalid persisted quotes never prevent the API from starting. */ }
  }

  private persist(): Promise<void> {
    if (!this.cachePath) return Promise.resolve();
    const path = this.cachePath;
    const payload = JSON.stringify({ version: 1, savedAt: this.clock().toISOString(),
      entries: [...this.entries.values()].filter(entry => entry.point).map(({ point, observedAt, refreshedAt, outcome }) => ({ point, observedAt, refreshedAt, outcome })) });
    this.persistence = this.persistence.then(async () => {
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, payload, { mode: 0o600 });
        await rename(`${path}.tmp`, path);
      } catch { /* In-memory quotes remain usable on read-only hosts. */ }
    });
    return this.persistence;
  }
}

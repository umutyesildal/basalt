/** Exact-mint Solana DEX history. Historical reads are independent of live quote scheduling.
 * GeckoTerminal reports USD per unscaled token (verified against raw swap deltas).
 * Each completed daily close is divided by the issuer multiplier active at that boundary.
 */
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { getCachedXStockCatalog, type XStockAsset } from "../catalog/xstocks.js";
export const HISTORY_DAY_MS = 86_400_000;
export const GECKO_HISTORY_BASE = "https://api.geckoterminal.com/api/v2";
const ISSUER_BASE = "https://api.xstocks.fi/api/v2/public/assets";
const CASH_MINTS = new Set(["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "So11111111111111111111111111111111111111112"]);
const TTL = 6 * 60 * 60_000;
const RETRY_MS = 60_000;
const MAX_PENDING = 96;
export type HistoryRange = "7d" | "30d";
export interface HistoryPoint { timestamp: string; priceUsd: number }
export interface XStockHistory {
  mint: string; range: HistoryRange; windowEnd: string; points: HistoryPoint[];
  change7dPct: number | null; change30dPct: number | null;
  source: "geckoterminal" | "unavailable"; unit: "scaled-ui"; interval: "1d";
  /** Completed UTC candle boundary, not an exact last-trade timestamp. */
  observedAt: string | null; fetchedAt: string | null;
  status: "available" | "unavailable" | "loading"; refreshing: boolean; poolAddress: string | null;
  timestampSemantics: "completed-utc-day-close";
}
export interface HistoryPool { address: string; base: string; quote: string; liquidityUsd: number; volume24hUsd: number; createdAt: number }
export interface MultiplierEvent { at: number; multiplier: number; previousMultiplier: number }
interface StoredHistory { mint: string; points: HistoryPoint[]; windowEnd: string; fetchedAt: string; poolAddress: string }
interface CacheEntry { history: StoredHistory | null; checkedAt: number; failed?: boolean }
interface HistoryOptions {
  fetchImpl?: typeof fetch; now?: () => Date; cachePath?: string | null; minRequestIntervalMs?: number; waitMs?: number;
  assets?: () => readonly XStockAsset[];
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function positive(value: unknown): number | null { const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN; return Number.isFinite(n) && n > 0 ? n : null; }
function nonnegative(value: unknown): number | null { const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN; return Number.isFinite(n) && n >= 0 ? n : null; }
function mintAddress(value: unknown): value is string { if (typeof value !== "string") return false; try { return new PublicKey(value).toBase58() === value; } catch { return false; } }
function relationship(value: unknown): string | null {
  if (!record(value) || !record(value.data) || typeof value.data.id !== "string" || !value.data.id.startsWith("solana_")) return null;
  const mint = value.data.id.slice(7); return mintAddress(mint) ? mint : null;
}
export function selectHistoryPool(payload: unknown, mint: string, windowEnd: number): HistoryPool | null {
  if (!record(payload) || !Array.isArray(payload.data)) throw new Error("Invalid pool response");
  const candidates: HistoryPool[] = [];
  for (const row of payload.data) {
    if (!record(row) || !record(row.attributes) || !record(row.relationships)) continue;
    const a = row.attributes, r = row.relationships;
    const base = relationship(r.base_token), quote = relationship(r.quote_token);
    if (!base || !quote || (base !== mint && quote !== mint)) continue;
    const other = base === mint ? quote : base;
    const liquidity = positive(a.reserve_in_usd), volume = record(a.volume_usd) ? nonnegative(a.volume_usd.h24) : null;
    if (!CASH_MINTS.has(other) || !mintAddress(a.address) || row.id !== `solana_${a.address}` || !liquidity || liquidity < 1000 || volume === null) continue;
    const createdAt = typeof a.pool_created_at === "string" ? Date.parse(a.pool_created_at) : NaN;
    if (!Number.isFinite(createdAt) || createdAt > windowEnd) continue;
    candidates.push({ address: a.address, base, quote, liquidityUsd: liquidity, volume24hUsd: volume, createdAt });
  }
  // Prefer a sufficiently old pool for a complete month, then the strongest current liquidity.
  candidates.sort((a, b) => Number(b.createdAt <= windowEnd - 31 * HISTORY_DAY_MS) - Number(a.createdAt <= windowEnd - 31 * HISTORY_DAY_MS) || b.liquidityUsd - a.liquidityUsd || b.volume24hUsd - a.volume24hUsd);
  return candidates[0] ?? null;
}
export function parseMultiplierEvents(nodes: unknown[]): MultiplierEvent[] {
  const events: MultiplierEvent[] = [];
  for (const node of nodes) {
    if (!record(node)) throw new Error("Invalid multiplier history");
    const at = typeof node.activationDateTime === "string" ? Date.parse(node.activationDateTime) : NaN;
    const multiplier = positive(node.multiplier), previousMultiplier = positive(node.previousMultiplier);
    if (!Number.isFinite(at) || at <= 0 || !multiplier || !previousMultiplier) throw new Error("Invalid multiplier history");
    events.push({ at, multiplier, previousMultiplier });
  }
  events.sort((a, b) => a.at - b.at);
  let previous = 1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if ((i > 0 && events[i - 1].at === event.at) || Math.abs(event.previousMultiplier - previous) > Math.max(1, previous) * 1e-9) throw new Error("Incomplete multiplier history");
    previous = event.multiplier;
  }
  // A complete empty issuer history means the documented launch multiplier 1.
  return events;
}
export function historicalMultiplier(events: readonly MultiplierEvent[], at: number): number {
  let value = 1;
  for (const event of events) { if (event.at > at) break; value = event.multiplier; }
  return value;
}
export function normalizedHistoryPoints(payload: unknown, pool: HistoryPool, mint: string, events: readonly MultiplierEvent[], windowEnd: number): HistoryPoint[] {
  if (!record(payload) || !record(payload.data) || !record(payload.data.attributes) || !Array.isArray(payload.data.attributes.ohlcv_list)
    || !record(payload.meta) || !record(payload.meta.base) || !record(payload.meta.quote)) throw new Error("Invalid candle response");
  const addresses = [payload.meta.base.address, payload.meta.quote.address];
  if (!addresses.includes(mint) || !addresses.includes(pool.base) || !addresses.includes(pool.quote)) throw new Error("Candle mint mismatch");
  const rows = payload.data.attributes.ohlcv_list;
  if (rows.length > 1000) throw new Error("Oversized candle response");
  const points = new Map<number, number>();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0, 6).some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Invalid OHLCV row");
    const [start, open, high, low, close, volume] = row as number[];
    if (!Number.isSafeInteger(start) || start <= 0 || start % 86400 !== 0 || open <= 0 || high <= 0 || low <= 0 || close <= 0 || volume < 0
      || high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error("Invalid OHLCV values");
    const end = (start + 86400) * 1000;
    if (end > windowEnd || end < windowEnd - 30 * HISTORY_DAY_MS || volume === 0) continue;
    const price = close / historicalMultiplier(events, end);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid scaled price");
    if (points.has(end) && points.get(end) !== price) throw new Error("Conflicting candles");
    points.set(end, price);
  }
  return [...points].sort(([a], [b]) => a - b).map(([at, priceUsd]) => ({ timestamp: new Date(at).toISOString(), priceUsd }));
}
export function historyReturn(points: readonly HistoryPoint[], windowEnd: number, days: 7 | 30): number | null {
  const end = points.find(point => Date.parse(point.timestamp) === windowEnd)?.priceUsd;
  const start = points.find(point => Date.parse(point.timestamp) === windowEnd - days * HISTORY_DAY_MS)?.priceUsd;
  return end && start ? (end / start - 1) * 100 : null;
}

export class XStockHistoryService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly queue: Array<() => Promise<void>> = [];
  private active = 0;
  private turn = Promise.resolve();
  private lastRequest = 0;
  private retryAt = 0;
  private consecutive429 = 0;
  private load: Promise<void> | null = null;
  private writes = Promise.resolve();
  private readonly clock: () => Date;
  private readonly fetchImpl: typeof fetch;
  private readonly assetList: () => readonly XStockAsset[];
  private readonly path: string | null;
  private readonly pace: number;
  constructor(private readonly opts: HistoryOptions = {}) {
    this.clock = opts.now ?? (() => new Date()); this.fetchImpl = opts.fetchImpl ?? fetch;
    this.assetList = opts.assets ?? (() => getCachedXStockCatalog(this.clock).data);
    this.path = opts.cachePath !== undefined ? opts.cachePath : process.env.XSTOCK_HISTORY_CACHE_PATH === "0" ? null : process.env.XSTOCK_HISTORY_CACHE_PATH || fileURLToPath(new URL("../../.cache/xstocks-history.json", import.meta.url));
    this.pace = opts.minRequestIntervalMs ?? (opts.fetchImpl ? 0 : 2100);
  }
  private windowEnd(): number { return Math.floor(this.clock().getTime() / HISTORY_DAY_MS) * HISTORY_DAY_MS; }
  async getHistories(mints: string[], range: HistoryRange) {
    if (!this.load) this.load = this.loadSnapshot(); await this.load;
    const assets = new Map(this.assetList().map(asset => [asset.mint, asset]));
    const now = this.clock().getTime(), end = this.windowEnd();
    const unique = [...new Set(mints)].filter(mint => assets.has(mint));
    const requests: Promise<void>[] = [];
    for (const mint of unique) {
      const old = this.cache.get(mint);
      const due = !old || now - old.checkedAt >= (old.history && !old.failed ? TTL : RETRY_MS)
        || (old.history && Date.parse(old.history.windowEnd) !== end && (old.checkedAt < end || now - old.checkedAt >= RETRY_MS));
      if (due) requests.push(this.enqueue(assets.get(mint)!));
      else if (this.pending.has(mint)) requests.push(this.pending.get(mint)!);
    }
    if (requests.length && unique.some(mint => !this.cache.get(mint)?.history)) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([Promise.all(requests), new Promise<void>(resolve => { timer = setTimeout(resolve, this.opts.waitMs ?? 7500); })]);
      if (timer) clearTimeout(timer);
    }
    return { data: unique.map(mint => this.view(mint, range, end)), meta: { source: "geckoterminal", unit: "scaled-ui", interval: "1d", range,
      windowEnd: new Date(end).toISOString(), pending: unique.filter(mint => this.pending.has(mint)).length, timestampSemantics: "completed-utc-day-close" } };
  }
  private view(mint: string, range: HistoryRange, end: number): XStockHistory {
    const history = this.cache.get(mint)?.history;
    const all = history?.points ?? [];
    const points = all.filter(point => Date.parse(point.timestamp) >= end - (range === "7d" ? 7 : 30) * HISTORY_DAY_MS && Date.parse(point.timestamp) <= end);
    return { mint, range, windowEnd: new Date(end).toISOString(), points, change7dPct: historyReturn(all, end, 7), change30dPct: historyReturn(all, end, 30),
      source: points.length ? "geckoterminal" : "unavailable", unit: "scaled-ui", interval: "1d", observedAt: points.at(-1)?.timestamp ?? null,
      fetchedAt: history?.fetchedAt ?? null, status: points.length ? "available" : this.pending.has(mint) ? "loading" : "unavailable",
      refreshing: this.pending.has(mint), poolAddress: history?.poolAddress ?? null, timestampSemantics: "completed-utc-day-close" };
  }
  private enqueue(asset: XStockAsset): Promise<void> {
    const current = this.pending.get(asset.mint); if (current) return current;
    if (this.pending.size >= MAX_PENDING) return Promise.resolve();
    let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; });
    this.pending.set(asset.mint, promise);
    this.queue.push(async () => {
      try { await this.refresh(asset); } finally { this.pending.delete(asset.mint); resolve(); }
    });
    this.drain(); return promise;
  }
  private drain(): void {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!; this.active++;
      void job().catch(() => {}).finally(() => { this.active--; this.drain(); });
    }
  }
  private async gecko(path: string): Promise<unknown> {
    const prior = this.turn; let release!: () => void; this.turn = new Promise<void>(resolve => { release = resolve; });
    try {
      await prior;
      for (;;) {
        const wait = Math.max(0, this.lastRequest + this.pace - Date.now(), this.retryAt - Date.now());
        if (!wait) break;
        await new Promise(resolve => setTimeout(resolve, wait));
      }
      this.lastRequest = Date.now();
    } finally { release(); }
    const response = await this.fetchImpl(`${GECKO_HISTORY_BASE}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000), redirect: "error" });
    if (!response.ok) {
      if (response.status === 429) {
        this.consecutive429++;
        const retry = Number(response.headers.get("retry-after"));
        const delay = retry > 0 ? retry * 1000 : Math.min(60_000, 5000 * 2 ** Math.min(this.consecutive429, 4));
        this.retryAt = Math.max(this.retryAt, Date.now() + Math.min(120_000, delay));
      }
      throw new Error(`History provider HTTP${response.status}`);
    }
    this.consecutive429 = 0;
    return response.json();
  }
  private async multipliers(symbol: string): Promise<MultiplierEvent[]> {
    const nodes: unknown[] = [];
    for (let page = 0; page < 10; page++) {
      const url = `${ISSUER_BASE}/${encodeURIComponent(symbol)}/multiplier/history?network=Solana&page=${page}&pageSize=100`;
      const response = await this.fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(7000), redirect: "error" });
      if (!response.ok) throw new Error("Multiplier history unavailable");
      const body: unknown = await response.json();
      if (!record(body) || !Array.isArray(body.nodes) || body.nodes.length > 100 || !record(body.page) || body.page.currentPage !== page || typeof body.page.hasNextPage !== "boolean"
        || (body.page.hasNextPage && body.nodes.length === 0)) throw new Error("Incomplete multiplier history");
      nodes.push(...body.nodes);
      if (!body.page.hasNextPage) return parseMultiplierEvents(nodes);
    }
    throw new Error("Multiplier history pagination limit");
  }
  private async refresh(asset: XStockAsset): Promise<void> {
    const end = this.windowEnd();
    const old = this.cache.get(asset.mint);
    try {
      const [pools, events] = await Promise.all([this.gecko(`/networks/solana/tokens/${asset.mint}/pools`), this.multipliers(asset.symbol)]);
      const pool = selectHistoryPool(pools, asset.mint, end);
      if (!pool) throw new Error("No verified liquid pool");
      const candles = await this.gecko(`/networks/solana/pools/${pool.address}/ohlcv/day?aggregate=1&before_timestamp=${end / 1000}&limit=40&currency=usd&token=${asset.mint}&include_empty_intervals=false`);
      const points = normalizedHistoryPoints(candles, pool, asset.mint, events, end);
      const history: StoredHistory | null = points.length ? { mint: asset.mint, points, windowEnd: new Date(end).toISOString(), fetchedAt: this.clock().toISOString(), poolAddress: pool.address } : null;
      this.cache.set(asset.mint, { history: history ?? old?.history ?? null, checkedAt: this.clock().getTime(), failed: !history });
    } catch { this.cache.set(asset.mint, { history: old?.history ?? null, checkedAt: this.clock().getTime(), failed: true }); }
    while (this.cache.size > 4096) this.cache.delete(this.cache.keys().next().value!);
    await this.persist();
  }
  private async loadSnapshot(): Promise<void> {
    if (!this.path) return;
    try {
      if ((await stat(this.path)).size > 8 * 1024 * 1024) return;
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (!record(value) || value.version !== 1 || value.source !== "geckoterminal" || value.unit !== "scaled-ui" || value.normalization !== "historical-issuer-multiplier" || !Array.isArray(value.histories) || value.histories.length > 4096) return;
      const official = new Set(this.assetList().map(asset => asset.mint)); const now = this.clock().getTime();
      for (const row of value.histories) {
        if (!record(row) || typeof row.mint !== "string" || !official.has(row.mint) || !mintAddress(row.poolAddress) || !Array.isArray(row.points) || row.points.length > 31
          || typeof row.windowEnd !== "string" || !Number.isFinite(Date.parse(row.windowEnd)) || Date.parse(row.windowEnd) % HISTORY_DAY_MS !== 0 || Date.parse(row.windowEnd) > this.windowEnd()
          || typeof row.fetchedAt !== "string" || !Number.isFinite(Date.parse(row.fetchedAt)) || Date.parse(row.fetchedAt) < Date.parse(row.windowEnd) || Date.parse(row.fetchedAt) > now + 60_000) continue;
        const points: HistoryPoint[] = []; let previous = 0;
        for (const point of row.points) {
          if (!record(point) || typeof point.timestamp !== "string" || typeof point.priceUsd !== "number" || !Number.isFinite(point.priceUsd) || point.priceUsd <= 0) break;
          const at = Date.parse(point.timestamp);
          if (!Number.isFinite(at) || at <= previous || at % HISTORY_DAY_MS || at > Date.parse(row.windowEnd) || at < Date.parse(row.windowEnd) - 30 * HISTORY_DAY_MS) break;
          points.push({ timestamp: point.timestamp, priceUsd: point.priceUsd }); previous = at;
        }
        if (points.length !== row.points.length || !points.length) continue;
        this.cache.set(row.mint, { history: { mint: row.mint, points, windowEnd: row.windowEnd, fetchedAt: row.fetchedAt, poolAddress: row.poolAddress }, checkedAt: Date.parse(row.fetchedAt) });
      }
    } catch { /* Invalid persisted public data never becomes a chart. */ }
  }
  private persist(): Promise<void> {
    if (!this.path) return Promise.resolve();
    const path = this.path;
    const data = JSON.stringify({ version: 1, source: "geckoterminal", unit: "scaled-ui", normalization: "historical-issuer-multiplier", histories: [...this.cache.values()].flatMap(row => row.history ? [row.history] : []) });
    this.writes = this.writes.then(async () => { try { await mkdir(dirname(path), { recursive: true }); await writeFile(`${path}.tmp`, data, { mode: 0o600 }); await rename(`${path}.tmp`, path); } catch { /* Memory cache still works. */ } });
    return this.writes;
  }
}

import { performance } from "node:perf_hooks";

export type ApiResourceAction = "auth-nonce" | "auth-verify" | "quote";
export type AuthResourceAction = Exclude<ApiResourceAction, "quote">;

export class ApiResourceLimitError extends Error {
  readonly status = 429;

  constructor(
    readonly code: "RATE_LIMITED" | "RESOURCE_CAPACITY",
    readonly retryAfterSeconds: number,
  ) {
    super(code === "RATE_LIMITED" ? "Too many requests" : "Request capacity reached");
    this.name = "ApiResourceLimitError";
  }
}

export interface ApiResourceLimitsOptions {
  now?: () => number;
  windowMs?: number;
  maxBuckets?: number;
  cleanupBatchSize?: number;
  maxConcurrentQuotes?: number;
  maxQuoteUpstreamRequests?: number;
  ipLimits?: Partial<Record<ApiResourceAction, number>>;
  walletLimits?: Partial<Record<AuthResourceAction, number>>;
}

interface Bucket {
  count: number;
  expiresAt: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

/**
 * Per-process API budgets. All buckets have the same fixed window and a
 * monotonic clock, so insertion order is also expiry order. Cleanup inspects
 * at most cleanupBatchSize entries; a new identity never evicts a live limit.
 * Consume the socket-peer budget before reading a body, then the wallet budget
 * only after validating the wallet. Forwarded headers are not identities.
 */
export class ApiResourceLimits {
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly cleanupBatchSize: number;
  private readonly maxConcurrentQuotes: number;
  private readonly maxQuoteUpstreamRequests: number;
  private readonly ipLimits: Record<ApiResourceAction, number>;
  private readonly walletLimits: Record<AuthResourceAction, number>;
  private lastNow = -Infinity;
  private activeQuotes = 0;
  private quoteUpstreamBudget: Bucket | undefined;

  constructor(options: ApiResourceLimitsOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.windowMs = positiveInteger(options.windowMs ?? 60_000, "windowMs");
    this.maxBuckets = positiveInteger(options.maxBuckets ?? 10_000, "maxBuckets");
    this.cleanupBatchSize = positiveInteger(options.cleanupBatchSize ?? 16, "cleanupBatchSize");
    this.maxConcurrentQuotes = positiveInteger(options.maxConcurrentQuotes ?? 4, "maxConcurrentQuotes");
    this.maxQuoteUpstreamRequests = positiveInteger(options.maxQuoteUpstreamRequests ?? 120, "maxQuoteUpstreamRequests");
    this.ipLimits = { "auth-nonce": 30, "auth-verify": 60, quote: 30, ...options.ipLimits };
    this.walletLimits = { "auth-nonce": 5, "auth-verify": 10, ...options.walletLimits };
    for (const [action, limit] of Object.entries(this.ipLimits)) {
      positiveInteger(limit, `ipLimits.${action}`);
    }
    for (const [action, limit] of Object.entries(this.walletLimits)) {
      positiveInteger(limit, `walletLimits.${action}`);
    }
  }

  get bucketCount(): number {
    return this.buckets.size;
  }

  get activeQuoteCount(): number {
    return this.activeQuotes;
  }

  consumeIp(action: ApiResourceAction, peer: string): void {
    this.consume(`${action}:ip:${this.identity(peer)}`, this.ipLimits[action]);
  }

  consumeWallet(action: AuthResourceAction, wallet: string): void {
    this.consume(`${action}:wallet:${this.identity(wallet)}`, this.walletLimits[action]);
  }

  /** Consume only for actual upstream fetches, after any quote-cache lookup. */
  consumeQuoteUpstream(count = 1): void {
    positiveInteger(count, "quote upstream count");
    const now = this.readNow();
    if (!this.quoteUpstreamBudget || this.quoteUpstreamBudget.expiresAt <= now) {
      this.quoteUpstreamBudget = { count: 0, expiresAt: now + this.windowMs };
    }
    if (count > this.maxQuoteUpstreamRequests - this.quoteUpstreamBudget.count) {
      throw new ApiResourceLimitError("RATE_LIMITED", this.retryAfter(this.quoteUpstreamBudget.expiresAt, now));
    }
    this.quoteUpstreamBudget.count += count;
  }

  /** No queue: acquire immediately or reject. Always call release in finally. */
  acquireQuote(): () => void {
    if (this.activeQuotes >= this.maxConcurrentQuotes) {
      throw new ApiResourceLimitError("RESOURCE_CAPACITY", 1);
    }
    this.activeQuotes += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeQuotes -= 1;
    };
  }

  private identity(value: string): string {
    // Peers come from the socket; validated Solana wallet keys fit within 44.
    // Bound storage even if a caller accidentally supplies an untrusted string.
    if (typeof value !== "string" || value.length === 0 || value.length > 128) {
      throw new Error("Invalid resource-limit identity");
    }
    return value;
  }

  private consume(key: string, limit: number): void {
    const now = this.readNow();
    this.pruneExpired(now);

    const existing = this.buckets.get(key);
    if (existing && existing.expiresAt > now) {
      if (existing.count >= limit) {
        throw new ApiResourceLimitError("RATE_LIMITED", this.retryAfter(existing.expiresAt, now));
      }
      existing.count += 1;
      return;
    }
    // The requested expired bucket may be beyond this request's cleanup batch.
    if (existing) this.buckets.delete(key);
    if (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.values().next().value as Bucket | undefined;
      throw new ApiResourceLimitError("RESOURCE_CAPACITY", this.retryAfter(oldest?.expiresAt ?? now, now));
    }
    this.buckets.set(key, { count: 1, expiresAt: now + this.windowMs });
  }

  private readNow(): number {
    const reading = this.now();
    if (!Number.isFinite(reading)) throw new Error("Invalid resource-limit clock");
    const now = Math.max(this.lastNow, reading);
    if (!Number.isFinite(now + this.windowMs)) throw new Error("Invalid resource-limit clock");
    this.lastNow = now;
    return now;
  }

  private pruneExpired(now: number): void {
    let inspected = 0;
    for (const [key, bucket] of this.buckets) {
      if (inspected >= this.cleanupBatchSize || bucket.expiresAt > now) break;
      inspected += 1;
      this.buckets.delete(key);
    }
  }

  private retryAfter(expiresAt: number, now: number): number {
    return Math.max(1, Math.ceil((expiresAt - now) / 1_000));
  }
}

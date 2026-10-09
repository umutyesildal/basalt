import { describe, expect, it } from "vitest";
import { ApiResourceLimitError, ApiResourceLimits } from "../src/api/resource-limits.js";

function limitError(work: () => void): ApiResourceLimitError {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiResourceLimitError);
    return error as ApiResourceLimitError;
  }
  throw new Error("Expected a resource-limit error");
}

describe("API resource budgets", () => {
  it.each([
    ["auth-nonce", 30],
    ["auth-verify", 60],
    ["quote", 30],
  ] as const)("limits %s attempts per peer without extending the window on rejection", (action, count) => {
    let now = 0;
    const limits = new ApiResourceLimits({ now: () => now });
    for (let i = 0; i < count; i++) limits.consumeIp(action, "127.0.0.1");
    now = 59_001;
    const error = limitError(() => limits.consumeIp(action, "127.0.0.1"));
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMITED", retryAfterSeconds: 1 });
    now = 60_000;
    expect(() => limits.consumeIp(action, "127.0.0.1")).not.toThrow();
  });

  it.each([
    ["auth-nonce", 5],
    ["auth-verify", 10],
  ] as const)("limits %s attempts across peers for one validated wallet", (action, count) => {
    const limits = new ApiResourceLimits();
    for (let i = 0; i < count; i++) {
      limits.consumeIp(action, `peer-${i}`);
      limits.consumeWallet(action, "wallet-one");
    }
    expect(limitError(() => limits.consumeWallet(action, "wallet-one")).code).toBe("RATE_LIMITED");
    expect(() => limits.consumeWallet(action, "wallet-two")).not.toThrow();
  });

  it("keeps operation, peer and wallet budgets separate", () => {
    const limits = new ApiResourceLimits({ ipLimits: { "auth-nonce": 1, "auth-verify": 1, quote: 1 } });
    limits.consumeIp("auth-nonce", "peer");
    limits.consumeIp("auth-verify", "peer");
    limits.consumeIp("quote", "peer");
    limits.consumeIp("auth-nonce", "other-peer");
    limits.consumeWallet("auth-nonce", "peer");
    expect(limits.bucketCount).toBe(5);
    expect(limitError(() => limits.consumeIp("auth-nonce", "peer")).code).toBe("RATE_LIMITED");
  });

  it("denies new identities at the hard cap without evicting an existing limit", () => {
    let now = 0;
    const limits = new ApiResourceLimits({ now: () => now, maxBuckets: 2, ipLimits: { quote: 2 } });
    limits.consumeIp("quote", "peer-one");
    now = 500;
    limits.consumeIp("quote", "peer-two");
    const error = limitError(() => limits.consumeIp("quote", "new-peer"));
    expect(error).toMatchObject({ code: "RESOURCE_CAPACITY", retryAfterSeconds: 60 });
    expect(limits.bucketCount).toBe(2);
    // Existing identities can use their remaining allowance during saturation.
    limits.consumeIp("quote", "peer-one");
    expect(limitError(() => limits.consumeIp("quote", "peer-one")).code).toBe("RATE_LIMITED");
    now = 60_000;
    limits.consumeIp("quote", "new-peer");
    expect(limits.bucketCount).toBe(2);
    limits.consumeIp("quote", "peer-two");
    expect(limitError(() => limits.consumeIp("quote", "peer-two")).code).toBe("RATE_LIMITED");
  });

  it("expires state with bounded cleanup work under many changing identities", () => {
    let now = 0;
    const limits = new ApiResourceLimits({ now: () => now, maxBuckets: 100, cleanupBatchSize: 2 });
    for (let i = 0; i < 100; i++) limits.consumeIp("quote", `peer-${i}`);
    now = 60_000;
    limits.consumeIp("quote", "new-peer");
    expect(limits.bucketCount).toBe(99); // two expired removals, one insertion
    for (let i = 0; i < 200; i++) {
      limits.consumeIp("quote", `next-${i}`);
      now += 60_000;
      expect(limits.bucketCount).toBeLessThanOrEqual(100);
    }
  });

  it("renews a requested expired bucket beyond the bounded cleanup batch", () => {
    let now = 0;
    const limits = new ApiResourceLimits({ now: () => now, maxBuckets: 4, cleanupBatchSize: 1, ipLimits: { quote: 1 } });
    for (let i = 0; i < 4; i++) limits.consumeIp("quote", `peer-${i}`);
    now = 60_000;
    limits.consumeIp("quote", "peer-3");
    expect(limits.bucketCount).toBe(3);
    expect(limitError(() => limits.consumeIp("quote", "peer-3")).code).toBe("RATE_LIMITED");
  });

  it("never renews an allowance when the supplied clock moves backwards", () => {
    let now = 100_000;
    const limits = new ApiResourceLimits({ now: () => now, ipLimits: { quote: 1 } });
    limits.consumeIp("quote", "peer");
    now = 0;
    expect(limitError(() => limits.consumeIp("quote", "peer")).retryAfterSeconds).toBe(60);
    now = 160_000;
    expect(() => limits.consumeIp("quote", "peer")).not.toThrow();
  });

  it("rejects excess quote work immediately and makes release idempotent", () => {
    const limits = new ApiResourceLimits({ maxConcurrentQuotes: 2 });
    const releaseFirst = limits.acquireQuote();
    const releaseSecond = limits.acquireQuote();
    expect(limits.activeQuoteCount).toBe(2);
    expect(limitError(() => limits.acquireQuote())).toMatchObject({ code: "RESOURCE_CAPACITY", retryAfterSeconds: 1 });
    releaseFirst();
    releaseFirst();
    expect(limits.activeQuoteCount).toBe(1);
    const releaseThird = limits.acquireQuote();
    expect(limits.activeQuoteCount).toBe(2);
    releaseSecond();
    releaseThird();
    expect(limits.activeQuoteCount).toBe(0);
  });

  it("releases quote work after either a successful or rejected asynchronous operation", async () => {
    const limits = new ApiResourceLimits({ maxConcurrentQuotes: 1 });
    const quote = async (failure: boolean) => {
      const release = limits.acquireQuote();
      try {
        if (failure) throw new Error("upstream failed");
        return "quoted";
      } finally {
        release();
      }
    };
    await expect(quote(true)).rejects.toThrow("upstream failed");
    await expect(quote(false)).resolves.toBe("quoted");
    expect(limits.activeQuoteCount).toBe(0);
  });

  it("bounds process-wide quote fanout even when every request uses a fresh peer", () => {
    let now = 0;
    const limits = new ApiResourceLimits({ now: () => now, maxQuoteUpstreamRequests: 120 });
    for (let i = 0; i < 6; i++) {
      limits.consumeIp("quote", `peer-${i}`);
      limits.consumeQuoteUpstream(20);
    }
    limits.consumeIp("quote", "new-peer");
    expect(limitError(() => limits.consumeQuoteUpstream())).toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 60 });
    now = 59_500;
    expect(limitError(() => limits.consumeQuoteUpstream()).retryAfterSeconds).toBe(1);
    now = 60_000;
    expect(() => limits.consumeQuoteUpstream()).not.toThrow();
  });

  it("keeps upstream accounting outside the identity map and rejects a reservation atomically", () => {
    const limits = new ApiResourceLimits({ maxBuckets: 1, maxQuoteUpstreamRequests: 3 });
    limits.consumeIp("quote", "peer");
    limits.consumeQuoteUpstream(2);
    expect(limitError(() => limits.consumeQuoteUpstream(2)).code).toBe("RATE_LIMITED");
    limits.consumeQuoteUpstream();
    expect(limitError(() => limits.consumeQuoteUpstream()).code).toBe("RATE_LIMITED");
    expect(limits.bucketCount).toBe(1);
    expect(() => limits.consumeQuoteUpstream(0)).toThrow("positive safe integer");
  });

  it.each(["windowMs", "maxBuckets", "cleanupBatchSize", "maxConcurrentQuotes", "maxQuoteUpstreamRequests"] as const)(
    "rejects an invalid %s instead of silently disabling the bound", (key) => {
      for (const value of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => new ApiResourceLimits({ [key]: value })).toThrow("positive safe integer");
      }
    },
  );

  it("rejects invalid action limits and unbounded identities", () => {
    expect(() => new ApiResourceLimits({ ipLimits: { quote: 0 } })).toThrow("positive safe integer");
    expect(() => new ApiResourceLimits({ walletLimits: { "auth-nonce": 0 } })).toThrow("positive safe integer");
    const limits = new ApiResourceLimits();
    expect(() => limits.consumeIp("quote", "")).toThrow("Invalid resource-limit identity");
    expect(() => limits.consumeWallet("auth-nonce", "x".repeat(129))).toThrow("Invalid resource-limit identity");
    expect(limits.bucketCount).toBe(0);
  });
});

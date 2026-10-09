import { describe, expect, it } from "vitest";
import { InMemoryCache } from "../src/workers/navEngine.js";

describe("bounded optional in-memory cache", () => {
  it("caps unique entries and drops saturated writes without evicting existing live NAV", async () => {
    const cache = new InMemoryCache(()=>0,{maxEntries:3});
    await cache.set("nav:last-good","complete",600);
    await cache.set("quote:1","first",30);
    await cache.set("quote:2","second",30);
    for (let i=3;i<1000;i++) await cache.set(`quote:${i}`,"new",30);
    expect(cache.entryCount).toBe(3);
    expect(await cache.get("nav:last-good")).toBe("complete");
    expect(await cache.get("quote:1")).toBe("first");
    expect(await cache.get("quote:999")).toBeNull();
  });
  it("reclaims expired keys even if they are never requested again or have a live NAV before them", async () => {
    let now = 0;
    const cache = new InMemoryCache(()=>now,{maxEntries:2,cleanupBatchSize:1});
    await cache.set("nav:last-good","complete",600);
    await cache.set("quote:old-fingerprint","old",1);
    now = 2000;
    await cache.set("quote:new-fingerprint","new",30);
    expect(await cache.get("quote:new-fingerprint")).toBe("new");
    expect(await cache.get("quote:old-fingerprint")).toBeNull();
    expect(await cache.get("nav:last-good")).toBe("complete");
    expect(cache.entryCount).toBe(2);
  });
  it("bounds expiration work per operation while repeated activity eventually frees all expired entries", async () => {
    let now = 0;
    const cache = new InMemoryCache(()=>now,{maxEntries:100,cleanupBatchSize:1});
    for (let i=0;i<100;i++) await cache.set(`old:${i}`,"old",1);
    now = 2000;
    await cache.set("fresh","new",30);
    // A single request cannot synchronously sweep the full expired population.
    expect(cache.entryCount).toBeGreaterThanOrEqual(99);
    for (let i=0;i<200;i++) await cache.get("unrelated");
    await cache.set("fresh","new",30);
    expect(cache.entryCount).toBe(1);
    expect(await cache.get("fresh")).toBe("new");
  });
  it("caps UTF-8 bytes, accounts for replacements, and retains old values after an oversized update", async () => {
    const cache = new InMemoryCache(()=>0,{maxBytes:12});
    await cache.set("one","12345",30);
    await cache.set("two","12345",30);
    expect(cache.storedBytes).toBe(8);
    expect(await cache.get("two")).toBeNull();
    await cache.set("one","1",30);
    await cache.set("two","12345",30);
    expect(cache.storedBytes).toBe(12);
    await cache.set("one","x".repeat(20),30);
    expect(cache.storedBytes).toBe(12);
    expect(await cache.get("one")).toBe("1");
    const unicode = new InMemoryCache(()=>0,{maxBytes:4});
    await unicode.set("a","é",30);
    await unicode.set("b","é",30);
    expect(unicode.storedBytes).toBe(3);
    expect(await unicode.get("b")).toBeNull();
  });
  it("expired data is never returned and expiry releases byte capacity", async () => {
    let now = 0;
    const cache = new InMemoryCache(()=>now,{maxBytes:8});
    await cache.set("old","12345",1);
    now = 1000;
    expect(await cache.get("old")).toBeNull();
    expect(cache.storedBytes).toBe(0);
    await cache.set("new","12345",1);
    expect(await cache.get("new")).toBe("12345");
  });
});

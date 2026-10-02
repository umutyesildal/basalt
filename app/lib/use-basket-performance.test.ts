import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { BasketPerformanceResponse } from "./basket-performance";

// Execute the real hook source, isolating each module's shared cache while
// replacing React subscription effects, browser events, fetch and the clock.
const sourcePath = resolve(process.cwd(), process.cwd().endsWith("/app") ? "lib/use-basket-performance.ts" : "app/lib/use-basket-performance.ts");
const source = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function payload(status: BasketPerformanceResponse["status"] = "ready"): BasketPerformanceResponse {
  return { status, source: "Yahoo Finance", fetchedAt: "2026-10-02T13:54:07Z", baseDate: "2026-09-01", baseValue: 100, asOf: "2026-10-01", windowStart: "2026-09-24", items: [], methodology: "Test fixture" };
}

function harness() {
  let now = 1_000_000;
  let nextTimerId = 0;
  let visibilityState = "visible";
  let snapshotGetter: (() => { status: string; data: BasketPerformanceResponse | null }) | undefined;
  let mountedUnsubscribe: (() => void) | undefined;
  const timers = new Map<number, { callback: () => void; due: number }>();
  const visibilityListeners = new Set<() => void>();
  const requests: { resolve: (value: { ok: boolean; json: () => Promise<BasketPerformanceResponse> }) => void; reject: (reason: Error) => void }[] = [];
  const module = { exports: {} as { useBasketPerformance: () => { retry: () => void } } };
  runInNewContext(source, {
    exports: module.exports, module,
    require: (id: string) => {
      assert.equal(id, "react");
      return {
        useEffect: (effect: () => void) => effect(),
        useSyncExternalStore: (subscribe: (listener: () => void) => () => void, getSnapshot: NonNullable<typeof snapshotGetter>) => {
          snapshotGetter = getSnapshot;
          mountedUnsubscribe = subscribe(() => {});
          return getSnapshot();
        },
      };
    },
    Date: { now: () => now },
    AbortSignal: { timeout: () => ({}) },
    document: {
      get visibilityState() { return visibilityState; },
      addEventListener: (name: string, listener: () => void) => { assert.equal(name, "visibilitychange"); visibilityListeners.add(listener); },
      removeEventListener: (name: string, listener: () => void) => { assert.equal(name, "visibilitychange"); visibilityListeners.delete(listener); },
    },
    setTimeout: (callback: () => void, delay: number) => {
      const id = ++nextTimerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout: (id: number) => { timers.delete(id); },
    fetch: () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); }),
  });
  const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
  return {
    mount() {
      const hook = module.exports.useBasketPerformance();
      const unsubscribe = mountedUnsubscribe!;
      return { retry: hook.retry, unmount: unsubscribe };
    },
    read: () => snapshotGetter!(),
    requestCount: () => requests.length,
    timerCount: () => timers.size,
    visibilityListenerCount: () => visibilityListeners.size,
    nextDelay: () => Math.min(...[...timers.values()].map((timer) => timer.due - now)),
    async respond(index: number, data = payload()) {
      requests[index].resolve({ ok: true, json: async () => data });
      await flush();
    },
    async fail(index: number) { requests[index].reject(new Error("Network failure")); await flush(); },
    async advance(milliseconds: number) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = target;
      await flush();
    },
    async setVisible(visible: boolean) {
      visibilityState = visible ? "visible" : "hidden";
      visibilityListeners.forEach((listener) => listener());
      await flush();
    },
  };
}

test("shared consumers fetch once and refresh five minutes after completion", async () => {
  const clock = harness();
  const first = clock.mount();
  const second = clock.mount();
  assert.equal(clock.requestCount(), 1);
  assert.equal(clock.visibilityListenerCount(), 1);
  await clock.advance(2_000);
  await clock.respond(0);
  assert.equal(clock.nextDelay(), 300_000);
  await clock.advance(299_999);
  assert.equal(clock.requestCount(), 1);
  await clock.advance(1);
  assert.equal(clock.requestCount(), 2);
  await clock.respond(1);
  first.unmount();
  assert.equal(clock.timerCount(), 1);
  second.unmount();
  assert.equal(clock.timerCount(), 0);
  assert.equal(clock.visibilityListenerCount(), 0);
});

test("an expired hidden tab refreshes immediately when it becomes visible", async () => {
  const clock = harness();
  clock.mount();
  await clock.respond(0);
  await clock.setVisible(false);
  await clock.advance(7 * 86_400_000);
  assert.equal(clock.requestCount(), 1);
  await clock.setVisible(true);
  assert.equal(clock.requestCount(), 2);
  await clock.respond(1);
  assert.equal(clock.nextDelay(), 300_000);
});

test("a still-fresh visibility event keeps the cache and the remaining expiry", async () => {
  const clock = harness();
  clock.mount();
  await clock.respond(0);
  await clock.advance(1_000);
  await clock.setVisible(false);
  await clock.setVisible(true);
  assert.equal(clock.requestCount(), 1);
  assert.equal(clock.nextDelay(), 299_000);
});

test("network failures clear data and retry after thirty seconds", async () => {
  const clock = harness();
  clock.mount();
  await clock.fail(0);
  assert.equal(clock.read().status, "error");
  assert.equal(clock.read().data, null);
  assert.equal(clock.nextDelay(), 30_000);
  await clock.advance(30_000);
  assert.equal(clock.requestCount(), 2);
  await clock.respond(1);
  assert.equal(clock.read().status, "ready");
  assert.equal(clock.nextDelay(), 300_000);
});

test("partial and unavailable payloads retry after thirty seconds", async () => {
  for (const status of ["partial", "unavailable"] as const) {
    const clock = harness();
    clock.mount();
    await clock.respond(0, payload(status));
    assert.equal(clock.nextDelay(), 30_000);
    await clock.advance(30_000);
    assert.equal(clock.requestCount(), 2);
    await clock.respond(1);
    assert.equal(clock.nextDelay(), 300_000);
  }
});

test("manual retry bypasses a fresh cache and deduplicates while pending", async () => {
  const clock = harness();
  const first = clock.mount();
  const second = clock.mount();
  await clock.respond(0);
  first.retry();
  second.retry();
  assert.equal(clock.requestCount(), 2);
  await clock.respond(1);
  assert.equal(clock.nextDelay(), 300_000);
});

test("unmount during an in-flight request leaves no refresh timer or browser listener", async () => {
  const clock = harness();
  const consumer = clock.mount();
  consumer.unmount();
  await clock.respond(0);
  assert.equal(clock.timerCount(), 0);
  assert.equal(clock.visibilityListenerCount(), 0);
  const remounted = clock.mount();
  assert.equal(clock.requestCount(), 1);
  assert.equal(clock.timerCount(), 1);
  remounted.unmount();
});

test("a failed refresh removes previously available metrics", async () => {
  const clock = harness();
  clock.mount();
  await clock.respond(0);
  await clock.advance(300_000);
  await clock.fail(1);
  assert.equal(clock.read().status, "error");
  assert.equal(clock.read().data, null);
  assert.equal(clock.nextDelay(), 30_000);
});

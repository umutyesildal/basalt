import assert from "node:assert/strict";
import test from "node:test";
import { createBasketImage } from "./basket-image";
import { calculateBasketPerformance, type BasketPerformanceResponse } from "./basket-performance";
import { CONCEPT_BASKETS } from "./concept-samples";
import type { ConceptBasket } from "./concept-basket";

// Exercise the real Canvas renderer's text/layout decisions without external
// logos or browser downloads. The browser smoke verifies the actual PNG.
test("share poster renders only the exact basket's authentic weekly model", async (t) => {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  let written: { value: string; y: number; color: string }[] = [];
  let height = 0;
  const ctx = new Proxy({ fillStyle: "", measureText: (value: string) => ({ width: Array.from(value).length * 14 }), fillText(value: string, _x: number, y: number) { written.push({ value, y, color: this.fillStyle }); } }, {
    get(target, key) { return key in target ? Reflect.get(target, key) : () => {}; },
  });
  replace("window", { setTimeout, clearTimeout });
  replace("document", { documentElement: {}, fonts: { load: async () => [], ready: Promise.resolve() }, createElement: () => ({ width: 0, set height(value: number) { height = value; }, getContext: () => ctx, toBlob: (callback: (blob: Blob) => void) => callback(new Blob(["rendered"], { type: "image/png" })) }) });
  replace("getComputedStyle", () => ({ getPropertyValue: () => "sans-serif" }));
  replace("Path2D", class {});
  replace("Image", class { onload: (() => void) | null = null; set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); } });
  replace("fetch", async () => new Response(null, { status: 404 }));
  const basket = CONCEPT_BASKETS[0];
  function data(change: number): BasketPerformanceResponse {
    return calculateBasketPerformance([basket], Object.fromEntries(basket.assets.map(({ symbol }) => [symbol, { symbol, currency: "USD", candles: [{ date: "2026-09-01", close: 100 }, { date: "2026-10-02", close: 100 }, { date: "2026-10-09", close: 100 + change }] }])), "2026-10-09T22:00:00Z");
  }
  async function render(input: ConceptBasket, performance: BasketPerformanceResponse | null) {
    written = [];
    const blob = await createBasketImage(input, performance);
    assert.equal(blob.type, "image/png");
    assert.ok(height >= 1000);
  }
  try {
    for (const [change, label, color] of [[4.56, "+4.56%", "#50D69A"], [-4.56, "-4.56%", "#FF818A"], [0, "0.00%", "#F6F6F4"]] as const) {
      await t.test(`7D ${label} retains sign and scale`, async () => {
        await render(basket, data(change));
        assert.equal(written.find((entry) => entry.value === label)?.color, color);
        assert.ok(written.some((entry) => entry.value === "7D"));
        assert.ok(!written.some((entry) => entry.value.startsWith("Stock-close model") || entry.value.includes("Oct 9") || entry.value.includes("holdings below")));
        for (const { symbol } of basket.assets) assert.equal(written.filter((entry) => entry.value === symbol).length, 1, "ticker appears only in the holdings ledger");
        const metric = written.find((entry) => entry.value === label)!;
        const holdings = written.find((entry) => entry.value.endsWith(" HOLDINGS"))!;
        assert.ok(holdings.y > metric.y + 55, "weekly metric clears holdings ledger");
      });
    }
    await t.test("renamed or unavailable baskets still export without inherited returns", async () => {
      for (const [input, performance] of [[{ ...basket, name: "My own basket" }, data(4.56)], [basket, null], [basket, { ...data(4.56), status: "unavailable" }]] as const) {
        await render(input, performance);
        assert.ok(!written.some((entry) => entry.value === "7D" || entry.value.startsWith("Stock-close model")));
        assert.ok(written.some((entry) => entry.value === "basalt.markets"));
      }
    });
    await t.test("long supported sample text stays above weekly metric and ledger", async () => {
      await render({ ...basket, thesis: "Long investment thesis with several ideas. ".repeat(5).slice(0, 240) }, data(4.56));
      const metric = written.find((entry) => entry.value === "7D")!;
      const holding = written.find((entry) => entry.value.endsWith(" HOLDINGS"))!;
      assert.ok(metric.y < holding.y - 100);
      assert.ok(written.find((entry) => entry.value === "basalt.markets")!.y < height);
    });
  } finally {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

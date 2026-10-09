import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAnalyticsEvent } from "./analytics";

const wallet = "TcAgGWYnr5uVQGRiU67C1ynpH5JDKCmwWaCA6V2ANea";

test("analytics removes encoded basket payloads, wallet queries, and fragments", () => {
  const event = { type: "pageview" as const, url: `https://basalt.markets/preview?d=4.private-basket&wallet=${wallet}#private-note` };
  assert.deepEqual(sanitizeAnalyticsEvent(event), {
    type: "pageview",
    url: "https://basalt.markets/preview",
  });
  assert.ok(event.url.includes("private-basket"), "the original event is not mutated");
});

test("analytics groups creator pages without exposing the wallet in the path", () => {
  assert.equal(sanitizeAnalyticsEvent({ type: "pageview", url: `https://basalt.markets/creator/${wallet}?tab=holdings` })?.url,
    "https://basalt.markets/creator/[pubkey]");
  assert.equal(sanitizeAnalyticsEvent({ type: "pageview", url: `https://basalt.markets/creator/${wallet}/` })?.url,
    "https://basalt.markets/creator/[pubkey]/");
});

test("analytics keeps public basket and stock page paths useful", () => {
  for (const path of ["/", "/explore", "/b/haN-p4KBArAtwW78-Dz8", "/basket/public-vault/buy", "/stock/NVDA", "/portfolio", "/create"]) {
    assert.equal(sanitizeAnalyticsEvent({ type: "pageview", url: `https://basalt.markets${path}?wallet=${wallet}#details` })?.url,
      `https://basalt.markets${path}`);
  }
});

test("analytics redaction also applies to SDK event URLs", () => {
  assert.deepEqual(sanitizeAnalyticsEvent({ type: "event", url: `http://localhost:3000/creator/${wallet}?token=private#secret` }), {
    type: "event",
    url: "http://localhost:3000/creator/[pubkey]",
  });
});

test("analytics drops invalid, executable, and credential-bearing URLs", () => {
  for (const url of ["", "/preview?d=private", "not a URL", "https://", "javascript:alert(1)", "file:///tmp/private", "data:text/plain,private", "ftp://basalt.markets/", "https://user:private@basalt.markets/"]) {
    assert.equal(sanitizeAnalyticsEvent({ type: "pageview", url }), null, url);
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { siteUrl } from "../app/site";
import { CANONICAL_SITE_URL, publicSiteOrigin } from "./site-origin";
import { basketPublicLink, basketXIntent } from "./basket-social-share";
import { CONCEPT_BASKETS } from "./concept-samples";

const basket = CONCEPT_BASKETS[0];

test("public metadata defaults to the purchased domain, independently of Vercel aliases", () => {
  const previous = {
    site: process.env.NEXT_PUBLIC_SITE_URL,
    production: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    deployment: process.env.VERCEL_URL,
  };
  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "basalt-project.vercel.app";
    process.env.VERCEL_URL = "basalt-preview.vercel.app";
    assert.equal(siteUrl(), CANONICAL_SITE_URL);
    process.env.NEXT_PUBLIC_SITE_URL = "https://basalt.markets/";
    assert.equal(siteUrl(), CANONICAL_SITE_URL);
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.basalt.markets/path";
    assert.equal(siteUrl(), "https://staging.basalt.markets");
    process.env.NEXT_PUBLIC_SITE_URL = "basalt-project.vercel.app";
    assert.equal(siteUrl(), CANONICAL_SITE_URL);
  } finally {
    for (const [key, value] of [["NEXT_PUBLIC_SITE_URL", previous.site], ["VERCEL_PROJECT_PRODUCTION_URL", previous.production], ["VERCEL_URL", previous.deployment]]) {
      if (value === undefined) delete process.env[key!];
      else process.env[key!] = value;
    }
  }
});

test("public Vercel aliases resolve to the purchased domain", () => {
  for (const origin of ["https://basalt-project.vercel.app", "https://basalt-preview.vercel.app/path?draft=1", "basalt-preview.vercel.app"]) {
    assert.equal(publicSiteOrigin(origin), "https://basalt.markets");
  }
});

test("local review links and explicitly configured independent domains remain usable", () => {
  for (const origin of ["http://127.0.0.1:3000", "http://localhost:3000", "https://staging.basalt.markets", "https://basalt.example"]) {
    assert.equal(publicSiteOrigin(`${origin}/path?q=1#anchor`), origin);
  }
});

test("origin normalization rejects credentials and executable protocols", () => {
  for (const origin of ["javascript:alert(1)", "file:///tmp/test", "ftp://basalt.example", "https://user:password@basalt.example", "https://user@basalt.example"]) {
    assert.throws(() => publicSiteOrigin(origin));
  }
});

test("copied basket and X draft links use the purchased domain on Vercel", () => {
  const copied = new URL(basketPublicLink(basket, "https://basalt-project.vercel.app"));
  assert.equal(copied.origin, "https://basalt.markets");
  assert.equal(copied.pathname, "/preview");
  const draft = new URL(basketXIntent(basket, "https://basalt-preview.vercel.app"));
  assert.equal(draft.searchParams.has("url"), false);
  assert.ok(draft.searchParams.get("text")!.includes(copied.href));
  assert.ok(draft.searchParams.get("text")!.endsWith("Check out more at @basalt_sol"));
});

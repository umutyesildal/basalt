# Basket tweet template, 2026-10-10

Status: implementation and checks passed; publication is in progress.

The owner requested a weekly-performance first sentence, then the thesis and short basket link, with `Check out more at @basalt_sol` last. Both preview and image-modal X actions use the same formatter. Native image sharing uses the same copy while supplying its URL separately.

Positive template:

```text
Main Character stock basket has gained 2.76% this week!

Cars, chips, data and the crypto economy. https://basalt.markets/b/haN-p4KBArAtwW78-Dz8

Check out more at @basalt_sol
```

The number above reflects the observed public model response on 10 October 2026, with completed closes as of 9 October (`return7dPct=2.756601`). It is not hardcoded. The owner's 2.78% example described the preferred format. Returns are still underlying-stock historical models, not achieved investor returns or devnet token valuations.

## Behavior

- Reuse `getBasketSharePerformance` and the existing shared performance request/cache. Only the exact named mix and valid, finite, complete seven-day evidence receive a performance sentence. Model calculations and eligibility rules are unchanged.
- Positive returns use `has gained N.NN% this week!`; negatives use `is down N.NN% this week.`; zero uses `is flat this week.`. Unknown/custom mixes and unavailable/invalid data share the name and thesis without invented performance.
- X receives one `text` parameter containing the short URL before the final Basalt account line. Omitting the separate `url` parameter prevents X from appending the link below the account line or duplicating it.
- The formatter preserves the complete URL and final account line, truncating the introductory text at grapheme boundaries within a conservative 280-unit budget with 23 units reserved for the URL. Controls and whitespace are normalized. Existing URL/origin validation and durable snapshots are unchanged.
- Known sample actions wait for the initial shared model request. If it fails, a neutral draft remains available. Prepared anchors and pending popup work invalidate when the eligible return/window changes; the existing opener isolation and cancellation remain.
- All sharing remains user initiated. This feature prepares an editable X draft and does not publish a tweet or automatically attach PNG media.

## Checks

- 40 focused social/performance/origin checks passed.
- Full app suite: 313 Node, 57 Vitest and concept preview/sample integrity checks passed, zero failures/skips.
- App typecheck passed. Production build and final publication evidence will be recorded below.
- No backend, contract, price-worker, fee or financial-state change. The existing VPS remains at short-link source `307053da1310331c658c0401d0107f8405912199`; this is a frontend-only follow-up.

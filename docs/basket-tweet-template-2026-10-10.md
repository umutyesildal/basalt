# Basket tweet template, 2026-10-10

Status: published to https://basalt.markets and verified in Chrome on 10 October 2026.

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
- App typecheck, local production build and frozen hosted production build passed. All six GitHub CI jobs passed for the exact application source.
- No backend, contract, price-worker, fee or financial-state change. The existing VPS remains at short-link source `307053da1310331c658c0401d0107f8405912199`; this is a frontend-only follow-up.

## Publication and browser verification

- Application source: `4ffbfdc2174d1bca96fa6efc1d40bb324d24cf08`, pushed to public `origin/main`.
- Exact-source CI: https://github.com/umutyesildal/basalt/actions/runs/38001501373 . All six jobs succeeded, including app/backend tests, production build, Rust/Clippy, security scans and container checks.
- Vercel production deployment: `dpl_76CyNAWxa6rwndGqmeGCPK5h8xjX`, immutable URL https://basalt-5nxzbryw9-yesildaladams-projects.vercel.app . Deployment metadata confirms both source and Git commit SHA above. The ready deployment was explicitly promoted; inspecting https://basalt.markets resolved to that exact production deployment.
- Frontend rollback: `dpl_3ccnXao9qcYChJgnbistgugne2WF`. No backend deployment was performed for this follow-up.
- In the owner's requested Chrome browser, the actual live Main Character page's **Share on X** action opened an editable X composer. Reading its **Post text** textbox confirmed the exact name, `2.76%`, thesis, short URL and final account line shown above. The link preview resolved to `Main Character · Basalt`.
- A full screenshot was captured locally at `/tmp/basalt-main-character-x-draft-full-20261010.jpg`. The surrounding personal feed is deliberately excluded from repository evidence. A clipped-capture attempt did not show the composer and is not evidence. The browser extension disconnected after verification and requested an update, so later tab cleanup could not be confirmed. No **Post** action was performed.
- Sanitized public deployment identities and the observed draft are recorded in [verification evidence](assets/basket-tweet-template-2026-10-10/verification.md). Documentation-only commits after the source above do not change deployed application bytes.

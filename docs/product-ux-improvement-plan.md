# Product and UX improvement plan

## Current strengths

- Clear value proposition: “Create an index. Own your thesis.”
- Distinct visual identity rather than a generic crypto dashboard.
- Strong navigation and basket-detail information architecture.
- Transaction flows include simulation, pending, submitted, confirmed, retry, and Explorer states.
- On-chain proof areas expose vaults, share mint, and program IDs.
- Permissionless, oracle-free redemption is explained correctly.
- Skeleton, empty, and error states are generally strong.

## UX-001 — Require wallet only at deployment

**Current issue:** Create says users can browse steps freely, but Next is disabled while disconnected.

**Target behavior:**

- Constituents, weights, fees, seed preview, and risk/legal steps work without a wallet.
- Persist a schema-versioned local draft.
- Require wallet only for balance checks, ATA discovery, and Deploy review.
- Revalidate network, balances, and constituents after connection.

**Acceptance:** A new user can reach deployment review without a wallet; Deploy clearly explains the wallet/network requirement.

## UX-002 — Human-readable amount entry

- Human token amount is the primary input.
- Raw base units appear in an advanced/detail row.
- One exact string/BigInt utility handles decimals and multipliers.
- Max, balance, rounding, and exact submitted raw amount are shown together.
- Never parse economic amounts through JavaScript `number`.

## UX-003 — First devnet success

Target: a new user completes a real devnet transaction in 5–10 minutes.

1. Detect network state.
2. Link or guide to a devnet SOL faucet when needed.
3. Provide one clear path to acquire mock constituents.
4. Offer a minimal basket template.
5. Show simulation, network fee, and instruction summary.
6. After confirmation, link to Explorer and Portfolio.

## UX-004 — Mock/demo trust language

Apply `data-integrity-and-demo-policy.md` everywhere:

- persistent environment/backing banner on basket detail,
- Reference NAV instead of AUM,
- visible demo mark on each marquee ticker,
- devnet/mock mark on share images and OG output,
- wording that does not imply issuer backing merely because a Token-2022 balance is real.

## UX-005 — Zap review and recovery

- List constituent, route, min-out, slippage, and estimated fee per leg.
- Keep the sequential/non-atomic warning beside the CTA.
- Track pending/confirmed/failed per leg.
- Open mint review only from actual balance deltas.
- On partial failure, offer Retry remaining legs, Keep tokens, and Switch to in-kind mint.
- Display quote expiry and refresh stale quotes.

## UX-006 — Basket-detail decision support

Use one hierarchy:

1. Identity plus environment/backing.
2. Reference NAV/share price plus freshness.
3. Target versus actual allocation and drift.
4. Fee schedule and user impact.
5. Vault proof and raw/scaled accounting.
6. Issuer, multiplier, corporate-action, and risk context.
7. Buy/redeem action rail.

Reduce duplicate KPI cards and keep primary risks/actions above the fold.

## UX-007 — Honest stock and market charts

- Do not render candlestick/volume charts without real OHLCV.
- Explain normalize-to-100 comparisons in the tooltip.
- Mark simulated xStock series in the legend and plot.
- Brush/range controls must change the real x-domain; placeholder `return null` is not acceptable.
- Charts require an accessible name, text summary, and keyboard-operable range control.

## UX-008 — Turn social into a real product

Keep every demo social entry labeled until live data is complete. The real version prioritizes thesis-to-basket/event linkage, creator track record, verified trade history, shareable deep links, follow/watchlist, and useful activity notifications.

Do not add automatic copy trading or return promises.

## UX-009 — Legal language and terminology

- Replace the `ETFs` navigation label unless product/legal explicitly approves it.
- Never use fund, registered ETF, safe, guaranteed, or “we manage”.
- Show xStocks issuer/structured-instrument context on basket and legal pages.
- Geo-compliance may gate onboarding/access, but never on-chain or UI redemption.

## UX-010 — Metadata and sharing

- Derive canonical URL from environment; production metadata must not use `localhost:3000`.
- OG/Twitter images include basket identity, constituents, reference timestamp, and devnet/mock badge.
- Test sitemap, robots, and canonical URLs per environment.

## Accessibility and mobile

- Minimum 44×44 px touch targets.
- Respect `prefers-reduced-motion`.
- Add chart summaries and focusable controls.
- Link form errors with `aria-describedby`.
- Remove blanket `touch-action: none`; apply it only during active gestures.
- Do not use 11 px text for critical information.
- Keyboard-only create/buy/redeem smoke tests are release gates.

## Success metrics

| Funnel | Metric |
|---|---|
| Landing → Explore | CTA click-through |
| Explore → Basket | Detail open rate |
| Basket → Wallet connect | Intent conversion |
| Create start → Review | Wizard completion |
| Review → Confirmed create | On-chain success |
| Buy/redeem start → Confirmed | Completion and failure class |
| First visit → First devnet tx | Time and drop-off step |
| Creator thesis → Share/open | Organic distribution and return visits |

Do not collect raw wallet addresses as analytics PII. Use privacy-preserving pseudonymous event IDs when analytics are required.

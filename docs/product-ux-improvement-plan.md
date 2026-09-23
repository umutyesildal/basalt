# Product and UX improvement plan

_Updated 2026-09-23. The current hackathon presentation decision below takes precedence for public navigation and copy. The transaction-focused UX items that follow remain the contract for `/create/onchain` and actual basket actions. `AGENTS.md` and `docs/basalt-v0-spec.md` govern protocol and legal boundaries._

## Hackathon concept journey — current public default

The public `/create` flow is in English and needs no wallet or API. It offers Mega-Cap Tech, Index Core, Motion, and a custom option in one non-scrolling choice row; users set a 100% mix, optionally set fees, and choose an illustrative starting amount. The amount defaults to $1,000 with $10/$100/$1,000 shortcuts. Review reuses the live composition preview and ends in a validated, shareable `/preview?d=...` link. A concept preview is not an asset purchase, deployed basket, or transaction. The existing devnet creator workflow is preserved at `/create/onchain` with its deposit and legal gates.

Explore leads with a coherent gallery of sample basket ideas regardless of backend availability. Feed, leaderboard, sample creator pages, and the gallery use the same example identities and basket definitions; sample activity never claims a transaction, return, AUM, or timestamp. Every sample link resolves to a concept page. Indexed on-chain information is a secondary, separately labeled surface. One quiet “Concept preview” context label per page provides provenance without repeating implementation warnings on every card.

Social copy invites people to build a basket idea, share its thesis, and follow creators. Call people **creators**, not fund managers. Curated examples are unranked and do not show invented returns, AUM, trades, or earnings. A concept preview, share, or follow creates no onchain activity or fees. Only a separately deployed onchain basket can accrue creator fees when protocol fees are generated under its disclosed terms; the V0 split is 90% to the creator and 10% to the treasury. Do not promise future fees, investment returns, or automatic copy trading.

The first basket view favors thesis, allocation, plain fee impact, and the next action. Raw amounts, addresses, source mechanics, and formulas remain in accessible details on the on-chain page. Stocks and ETFs are unchanged in this pass. Market volume follows the core journey and uses a traded instrument with a truthful unit; missing data does not render a flat or invented series. The Basalt mark and `#FCEE0A` remain the identity anchors.

This work package ends with product and documentation verification. Video production is outside its scope.

## On-chain journey and content contract

A visitor follows four tasks: **Choose** eligible assets and an optional name/thesis; **Set up** target allocations and optional fees; **Start** with owned constituent tokens; **Review** immutable terms and complete required legal acknowledgments. Review is reachable without a wallet. Deploy then asks for a wallet, reads current seed balances, validates transaction arguments, and simulates before signing; the program enforces the active whitelist and fee/weight limits. Explicit wrong-network messaging and versioned draft persistence remain backlog items. An unavailable price source does not silently become a reference value.

Fees start at zero. The seed task has no prefilled USD spend; the optional target-value helper uses clearly labeled reference prices to calculate editable token amounts. It is not a USDC purchase. The mobile seed view keeps each token amount visible without horizontal scrolling. One live preview is enough; a duplicate status/summary rail and estimated transaction byte count are not user decisions. Larger baskets explain only the possible extra wallet approval at transaction time.

**Content hierarchy, 2026-09-23:** The four tasks are the navigation; do not restate them in a page subtitle and a second numbered heading. Keep one visible devnet/mock source notice. Put optional fee controls and the USD amount calculator behind clearly named disclosures, while always showing their current values and keeping estimates marked as reference values. Show fee impact examples when a rate is above zero; zero needs no repeated explanatory paragraph. The four legal checkboxes remain required and initially unchecked, with short statements beside them and their full explanations in accessible disclosures. Review still shows the actual deposit, immutable terms, metadata publishing limitation, and the creator's **one basket share** (1,000,000 raw units at six decimals). Remove repeated wallet and validation sentences where the same state is already visible next to the action.

Name and thesis are currently committed only as a local JSON hash sent on-chain; retrievable metadata publication is not implemented. State this on review and treat publishing/verification as an open product requirement. Do not imply that a hash alone makes the name or thesis available to other users.

Main-flow allocation controls display percentages and a visible **100%** total. Display and input rounding must map exactly to integer bps at the UI boundary; the submitted weights still total **10,000 bps** and pass on-chain validation. The correction action is “Balance to 100%.” Fee controls display entry, exit, and annual management rates as percentages, with caps of **3% / 1% / 3% per year**. The 90% creator / 10% treasury fee split is protocol-wide, not a configurable basket term. Keep raw bps available in advanced transaction details where useful.

## UX-001 — Wallet at transaction time

- Allow constituents, allocation, fees, seed preview, legal terms, and review while disconnected.
- Persist a schema-versioned draft without implying saved amounts are still spendable.
- Check wallet, network, token accounts, balances, and active mints at deploy; explain each unavailable or failed state.
- Keep review readable on desktop and mobile, with a concise transaction summary.

**Acceptance:** a new visitor reaches review without connecting; an invalid balance or disconnected wallet prevents submission with a clear next step.

## UX-002 — Exact human amount entry

- Make human token amounts the primary seed input and show balance, maximum, rounding, and exact submitted raw amount in advanced details.
- Explain that creation deposits each constituent token from the creator wallet in one transaction; optional USD estimates are reference values only.
- Use exact string/BigInt conversion for raw Token-2022 units. Never parse economic amounts through JavaScript `number`.
- Keep seed transfers atomic with basket creation and retain 2–20 active constituents, immutable metadata, capped fees, and legal acknowledgments.

## UX-003 — First devnet success

Give a new user a clear devnet path: network detection, devnet SOL funding help, mock constituent acquisition, minimal basket template, simulation and network fee review, then confirmation links to Explorer and Portfolio. Label project mock mints as mock throughout; official issuer-backed xStocks are not currently supported by the extension-free V0 policy.

## UX-004 — Data and backing truth

Follow `docs/data-integrity-and-demo-policy.md`: persistent devnet/mock backing context on basket detail; “Reference NAV” for estimates; source and as-of time beside price/performance; demo labels in charts, social previews, OG, share images, and launch video. A real devnet balance does not imply issuer backing. If a source fails, render unavailable or stale states instead of invented data.

## UX-005 — Zap review and recovery

Show each sequential swap leg, route, minimum output, slippage, estimated fees, and quote expiry beside the action. Explain that the swaps and mint are not atomic. Derive mint review from actual balance deltas. On partial failure offer retry remaining legs, keep tokens, or switch to in-kind mint. This is periphery; in-kind mint/redeem remains the core path.

## UX-006 — Basket detail decision view

The first reading order is:

1. Basket name and thesis, with devnet/mock backing label.
2. Understandable target allocation and available actual allocation.
3. Sourced and timestamped reference NAV/share price or performance, when available.
4. Entry, exit, and annual management fees in percentages, with short user-impact explanations.
5. Key instrument, depeg, contract, multiplier, and drift risks.
6. Buy and redeem actions.

Put raw/scaled units, addresses and copy controls, drift arithmetic, fee formulas, and operator proof in a clearly labeled, keyboard-accessible advanced section. Keep the data available. Do not describe current project mock mints as real issuer-backed xStocks.

## UX-007 — Redeem understanding and accuracy

Explain: the user gives up basket shares and receives proportional underlying tokens. The **exit fee is a portion of the entered shares**; the remainder is burned, and the returned raw token amounts are floored pro-rata against vault balances after management-fee accrual. Preview the actual fee rate and share quantity, each token quantity, network cost, and irreversible transaction consequences before signing. Source fresh chain balances for transaction review.

“Permissionless” and “oracle-free” are protocol properties in advanced information. There is **no oracle fee**. Never add a whitelist, backend, price, jurisdiction, or pause gate to on-chain redemption. Buy copy separately identifies entry fee; annual management fees dilute share supply.

Distinguish protocol availability from this app's current transaction builder: the on-chain redeem instruction does not need the indexer, but the present UI uses indexed supply and vault balances for its preview. If those data are unavailable, show one clear unavailable state with Retry and do not imply this page can submit through raw RPC alone. Direct RPC fallback remains a separate implementation requirement.

## UX-008 — Honest charts and social

Do not render OHLCV, performance, or holdings without a real identified source. Explain normalized comparisons, label simulated series, and make range controls functional and keyboard operable. Social demo entries remain labeled until backed by live data. Avoid automatic copy-trading and return promises.

## UX-009 — Legal and sharing

Use only permitted “strategy basket” vocabulary; do not use ETF, fund, safe, guaranteed return, or managed-money claims. Preserve risk/legal acknowledgments and `LEGAL_REVIEW_REQUIRED` release work. Explain that issuer-backed xStocks are structured instruments rather than direct equity ownership, when that claim applies; current mock tokens must be labeled separately. Jurisdiction checks may affect onboarding, but redemption remains available. Canonical URLs and social images must reflect environment and mark devnet/mock assets visibly.

## Accessibility and verification

Use at least 44×44 px touch targets, readable critical text, reduced motion, linked form errors, visible focus, text chart summaries, and keyboard-operable advanced details. Review create, basket detail, buy, and redeem at desktop and mobile widths. Test percent↔bps exactness, fee formatting/caps, review without wallet, deployment balance validation, redeem fee math, and stale/unavailable source states. Run the touched app typecheck/build and relevant tests before rendering a new video from canonical `main`. Inspect final frames and text for Basalt, the mark, yellow accent, percentages, devnet/mock truth, and absence of invented fees.

## Success metrics

| Funnel | Metric |
|---|---|
| Landing → Explore | CTA click-through |
| Explore → Basket | Detail open rate |
| Basket → Wallet connect | Intent conversion |
| Create start → Review | Completion, including disconnected users |
| Review → Confirmed create | On-chain success and failure class |
| Buy/redeem start → Confirmed | Completion and failure class |
| First visit → First devnet transaction | Time and drop-off step |

Do not collect raw wallet addresses as analytics PII. Use privacy-preserving pseudonymous event IDs if analytics are introduced.

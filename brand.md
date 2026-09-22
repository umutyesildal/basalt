# Brand — Basalt

Basalt is an onchain strategy basket application. “Create an index. Own your thesis.”

_Last updated 2026-09-22. The Basalt name and three-column mark supersede the historical FolioX, Roman, and Foundry identities. The electric-yellow system in `docs/design-cyberpunk-yellow-v1.md` supplies the color tokens; `docs/design-basalt-v1.md` defines the mark. Telemetry remains off._

## Identity

- **Name:** Basalt, capitalized in prose. “BASALT” is reserved for graphic wordmarks.
- **Mark:** the three hexagonal columns on a shared baseline in `app/components/shell/site-header.tsx`. Reuse its geometry for favicon, social image, and video. Columns represent constituents and their target allocations.
- **Wordmark:** the mark plus a yellow “B” and foreground “asalt” in Chakra Petch. The quiet “· xStocks baskets” suffix may accompany the header wordmark, but must not imply the current devnet assets are issuer-backed.
- **Canvas:** near-black industrial surfaces in dark mode. Electric yellow `#FCEE0A` is the primary action, focus, and key state accent. Light mode uses the darker yellow fill and text tokens from `app/app/globals.css` to keep contrast. Use semantic tokens in components, rather than hardcoded hex.
- **Data:** cyan, magenta, green, and violet are chart-series colors only. They do not decorate product chrome. Muted gray may represent a benchmark; source and as-of time must accompany financial data.
- **Typography:** Chakra Petch (`--font-display`) for wordmark, headings, and hero numbers; Geist for body and controls; Geist Mono for compact labels, prices, percentages, and addresses. Keep critical mobile text readable.
- **Motifs:** causeway tessellation, stacked allocation bars, hexagon and plus details, and zero-padded step numbers. Avoid laurel, Roman, Foundry, photos, decorative gradients, and faux browser chrome.

## Product hierarchy

The first basket journey has four tasks: choose assets → set a **100%** allocation and optional fees → choose owned tokens to deposit → review immutable terms and legal acknowledgments. Connect a wallet only to check balances and deploy. Default fees are zero; USD is an optional reference estimate, never a prefilled spend. Keep the exact 10,000-bps total, fee caps, integer rounding, raw Token-2022 transfers, and on-chain checks in transaction logic and accessible technical details. The main controls say “Balance to 100%,” not “Normalize to 10,000.” Do not show transaction byte estimates in the main flow.

Keep each decision screen scannable: one task heading, one actionable validation message, and short visible copy. Optional fee controls and the USD amount calculator open on demand; full legal explanations remain accessible behind each required checkbox. Repeated zero-fee explanations, duplicated wallet instructions, and raw protocol mechanics do not belong in the default view. A creator receives **one display basket share** at genesis; the 1,000,000 raw units are not a million user-facing shares.

The basket first view explains its thesis, constituent allocation, sourced/as-of reference price or performance when available, entry/exit/annual fees, key risks, and buy/redeem actions. Raw amounts, mint addresses, drift arithmetic, fee formulas, and operator data belong in clearly labeled advanced details that remain keyboard accessible.

Redemption copy says that basket shares are exchanged for proportional underlying tokens. The exit fee is charged **in shares**; the fee shares go to fee recipients, and the remaining shares are burned to determine the tokens returned. Show actual quantities and the effective fee before signing. “Oracle-free” and “permissionless” describe protocol behavior in advanced information; there is no oracle fee.

## Truth and legal voice

Use short, factual sentences and direct action labels. Call the product a “strategy basket,” “index basket,” “onchain equity basket,” or “xStocks-backed strategy token” only where the backing claim is substantiated. Never call it a registered ETF, fund, guaranteed return, safe investment, financial advice, or managed money.

Current devnet basket constituents are **project mock Token-2022 mints**, not official issuer-backed xStocks. Label devnet, mock, demo, and reference values at the point of use, including in charts, basket detail, share images, and video. A real token balance is not proof of issuer backing. Do not fabricate NAV, holdings, price, performance, or a live-data timestamp; show an honest unavailable state when the source fails. Avoid “live AUM” for an estimated reference NAV.

Keep the legal acknowledgments in create and the legal page. `LEGAL_REVIEW_REQUIRED` remains a release requirement in `AGENTS.md` and `docs/basalt-v0-spec.md`, including jurisdiction, issuer-instrument, fee, and risk review. UI review chips were removed by the owner; their absence is not legal approval. Redemption must remain accessible regardless of a mint pause, backend outage, or price-feed outage.

## Interaction checks

Primary actions and focus rings use the yellow token with accessible contrast. Desktop and mobile create, detail, buy, and redeem flows must support keyboard focus, visible errors, at least 44×44 px touch targets, reduced motion, and honest loading/empty states. Use the existing Bklit-derived chart components and meaningful text summaries. Keep primary information out of tiny micro-labels.

Historical palette and type choices from the 2026-09-01 Mineral Desk pass and 2026-09-03 intermediate directions are superseded by this Basalt identity.

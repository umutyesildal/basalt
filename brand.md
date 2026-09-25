# Brand — Basalt

Basalt helps people explore and share ideas for baskets of stocks and ETFs. Its two equally visible starting points are creating a basket idea and discovering the people behind other ideas. The wallet-free concept preview keeps both journeys easy to explore; the separate devnet transaction flow remains available for technical review.

_Last updated 2026-09-25. The Basalt name and three-column mark supersede the historical FolioX, Roman, and Foundry identities. The electric-yellow system in `docs/design-cyberpunk-yellow-v1.md` supplies the color tokens; `docs/design-basalt-v1.md` defines the mark. Telemetry remains off._

## Identity

- **Name:** Basalt, capitalized in prose. “BASALT” is reserved for graphic wordmarks.
- **Mark:** the three hexagonal columns on a shared baseline in `app/components/shell/site-header.tsx`. Reuse its geometry for favicon, social image, and video. Columns represent constituents and their target allocations.
- **Wordmark:** the mark plus a yellow “B” and foreground “asalt” in Chakra Petch. The quiet “· xStocks baskets” suffix may accompany the header wordmark, but must not imply the current devnet assets are issuer-backed.
- **Canvas:** near-black industrial surfaces in dark mode. Electric yellow `#FCEE0A` is the primary action, focus, and key state accent. Light mode uses the darker yellow fill and text tokens from `app/app/globals.css` to keep contrast. Use semantic tokens in components, rather than hardcoded hex.
- **Data:** cyan, magenta, green, and violet are chart-series colors only. They do not decorate product chrome. Muted gray may represent a benchmark; source and as-of time must accompany financial data.
- **Typography:** Chakra Petch (`--font-display`) for wordmark, headings, and hero numbers; Geist for body and controls; Geist Mono for compact labels, prices, percentages, and addresses. Keep critical mobile text readable.
- **Motifs:** causeway tessellation, stacked allocation bars, hexagon and plus details, and zero-padded step numbers. Avoid laurel, Roman, Foundry, photos, decorative gradients, and faux browser chrome.

## Product hierarchy

Basalt has two equally visible starting points. The creation path lets people choose a template or assets, set a **100%** mix and optional fees, choose an illustrative dollar amount, then review and share a concept preview. A $1,000 example is prefilled and $10/$100/$1,000 shortcuts are offered; these are preview amounts, never a purchase or deposit. No wallet, token balance, or backend is required.

The discovery path lets people explore sample creators and basket ideas, inspect a thesis and current allocation, then bring that mix into their own wallet-free preview. Following a creator is a social subscription; it does not mirror future activity or buy assets. Sharing a preview makes the creator’s thesis and composition easy to inspect.

The separate `/create/onchain` flow retains owned-token deposits, legal acknowledgments, exact 10,000-bps total, fee caps, integer rounding, raw Token-2022 transfers, and on-chain checks. The main controls say “Balance to 100%,” not “Normalize to 10,000.”

Keep each decision screen scannable: one task heading, one actionable validation message, and short visible copy. Optional fee controls have plain explanations. The concept review reuses the live composition preview and finishes with “Create preview.” It does not show a hypothetical minted share. In the on-chain flow, required legal explanations remain accessible and a creator receives **one display basket share** at genesis; the 1,000,000 raw units are not a million user-facing shares.

The basket first view explains its thesis, constituent allocation, entry/exit/annual fees, risks, and buy/redeem actions. Reference price, performance, source timestamps, raw amounts, mint addresses, drift arithmetic, fee formulas, and operator data belong in clearly labeled advanced details that remain keyboard accessible.

Redemption copy says that basket shares are exchanged for proportional underlying tokens. The exit fee is charged **in shares**; the fee shares go to fee recipients, and the remaining shares are burned to determine the tokens returned. Show actual quantities and the effective fee before signing. “Oracle-free” and “permissionless” describe protocol behavior in advanced information; there is no oracle fee.

## Truth and legal voice

Use short, factual English sentences and direct action labels. “Stock Baskets” names the concept in navigation and marketing; explain that the idea uses stocks and ETFs. Reserve “onchain equity basket” and “xStocks-backed strategy token” for pages where actual backing is substantiated. Never call a concept preview a deployed basket or a completed investment, and never call the product a registered ETF, fund, guaranteed return, safe investment, financial advice, or managed money.

Current devnet basket constituents are **project mock Token-2022 mints**, not official issuer-backed xStocks. Concept pages use one quiet “Concept preview” context label and never present illustrative activity or allocation as on-chain execution. The on-chain transaction pages continue to identify devnet/mock assets and sourced reference values where used. A real token balance is not proof of issuer backing. Do not fabricate NAV, holdings, price, performance, or a live-data timestamp; show an honest unavailable state when the source fails. Avoid “live AUM” for an estimated reference NAV.

Keep the legal acknowledgments in `/create/onchain` and the legal page. The wallet-free concept preview has no deploy action. `LEGAL_REVIEW_REQUIRED` remains a release requirement in `AGENTS.md` and `docs/basalt-v0-spec.md`, including jurisdiction, issuer-instrument, fee, and risk review. UI review chips were removed by the owner; their absence is not legal approval. Redemption must remain accessible regardless of a mint pause, backend outage, or price-feed outage.

## Interaction checks

Primary actions and focus rings use the yellow token with accessible contrast. Desktop and mobile create, detail, buy, and redeem flows must support keyboard focus, visible errors, at least 44×44 px touch targets, reduced motion, and honest loading/empty states. Use the existing Bklit-derived chart components and meaningful text summaries. Keep primary information out of tiny micro-labels.

Historical palette and type choices from the 2026-09-01 Mineral Desk pass and 2026-09-03 intermediate directions are superseded by this Basalt identity.

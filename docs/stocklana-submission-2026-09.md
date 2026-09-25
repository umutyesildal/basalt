# Basalt — Stocklana submission

Research revision: 2026-09-26. **Draft revision — not submitted to the platform.** The previous saved application remains in place. The advertised editing deadline has passed, and the browser currently requires sign-in. Limits verified in the form: 280 / 5,000 characters. [Event rules](https://hackathons.solana.com/hackathons/stocklana) prioritize a real user/problem, an end-to-end demo, a reason for Solana, and execution quality.

## Short description (236/280)

Build a stock basket. Discover the strategy behind someone else's. Basalt makes portfolios easy to inspect, remix and share. Our Solana prototypes demonstrate one-token basket ownership, with a separate creator-managed vault experiment.

## Full description (3641/5000)

## FROM A STOCK IDEA TO A SHARED STRATEGY

A watchlist shows the tickers. A strategy needs the weights, the reasoning and a way for someone else to use it.

Basalt is for people who think in baskets — a technology thesis, a broad-market core, a group of businesses they understand — and creators who want to share the thinking behind their mix.

Build your own basket or discover a creator's idea. Inspect the allocation, change what you disagree with, and share your version. The longer-term direction is to connect this social experience to tokenized ownership in creator-led baskets on Solana.

## TRY THE PRODUCT

1. Open https://basalt-coral.vercel.app/ and choose a sample creator.
2. Select **Use this mix**, adjust the stocks and weights, and create your own preview. Or start with **Build a basket**.
3. Share the basket link. It carries the name, thesis and allocation, so the next person can inspect and remix the same idea.

The public experience is wallet-free. Creator examples are illustrative; remixing copies a composition, not future trades, and the preview does not buy assets.

## ONE BASKET, ONE SHARE TOKEN

The onchain engine demonstrates the ownership model: a vault holds tokens and issues basket shares. Holding 10% of the shares represents a proportional claim on each asset currently in that vault. Redemption burns shares and returns underlying tokens, subject to the basket's fees.

**V0 — working on devnet:** Create an immutable basket, mint shares in kind and redeem proportionally using project mock Token-2022 assets. The basket program has no redemption pause or price-oracle dependency. These are test assets, not official xStocks.

**Managed V2 — separate localnet prototype:** A creator proposes a change within a fixed two-asset basket. A distinct guardian approves it, holders have a notice period, and an eligible bounded trade changes the vault's holdings. Holders redeem against the current balances. Prototype fees are 0%; public managed vaults are not live.

V2 transaction evidence covers two holders, proposal/approval, notice-period redemption, a bounded fill and redemption after the fill. The full-fill test used an accelerated-notice artifact; the normal notice configuration was tested separately.

## WHY THIS APPROACH

Basalt puts the creator's thesis and a usable allocation next to each other. The immediate product is a simple build–discover–remix loop; the technical work explores how that same strategy can become shared onchain ownership.

Solana's Token-2022 shares and program-owned vaults let participants inspect holdings and ownership rules. The indexer reads confirmed state and cannot move assets. Token-issuer controls, network conditions, contract risks and upgrade authority still matter.

## EVIDENCE & NEXT STEPS

Source, setup and transaction proofs: https://github.com/umutyesildal/basalt

Managed prototype status and proof links: https://github.com/umutyesildal/basalt/blob/main/docs/managed-basket-v2-prototype-status.md

Next: official xStocks compatibility and asset-admission checks, broader adversarial tests, independent review and verified multisig governance before a capped public pilot.

## TEAM & ORIGINAL WORK

Solo full-stack Solana builder based in Germany. Basalt was already on devnet before Stocklana and won Superteam Germany's Road-to-Colosseum Ideathon, placing in the top 10 of 38 submissions.

This iteration adds wallet-free basket creation, creator discovery, a visual homepage and the Managed V2 localnet prototype. The application and programs are original work built with open-source tools including Anchor, Next.js and Solana libraries.

---

## Editorial rationale

Lead with the user and a concrete demo path. Explain share ownership with a simple percentage before discussing architecture. Keep the ambition visible while labeling public previews, devnet mock assets and localnet managed vaults precisely. Do not claim that baskets, copy trading or tokenized vaults are novel in isolation; see [competitive research](competitive-landscape-2026-09-26.md).

## Evidence

- `docs/managed-basket-v2-prototype-status.md` and linked transaction proofs
- `docs/managed-basket-v2-localnet-proof.md`
- `docs/managed-basket-v2-wallet-lab.md`
- `docs/current-state-2026-09-18.md`
- `docs/devnet-governance-audit-2026-09-19.md`
- `docs/ideathon-submission-2026-09.md`

The solo-builder and ideathon history is owner-supplied. No market-volume figures, stale test counts, live official-xStocks claims, automatic-copy-trading promises or absolute exit guarantees are used.

# Basalt — Idea Context (pitch-deck input)

> **Historical pitch context — not current operational status.** Prepared 2026-09-03 for the `create-pitch-deck` skill. Sources: `foliox_build_prompt.md` (historical filename), `AGENTS.md`, `docs/basalt-v0-spec.md`, owner decisions. Use `docs/current-state-2026-09-18.md` and `docs/implementation-backlog.md` for current facts.

## Product

**Basalt** — a Solana dApp where anyone can create and hold tokenized strategy baskets ("custom ETFs", never called ETFs in product copy) built from **xStocks** — Backed Finance's Token-2022 wrapped equities/ETFs (TSLAx, AAPLx, NVDAx, SPYx…).

**Tagline:** "Create an index. Own your thesis."

**One-liner:** Create an onchain basket of tokenized stocks in minutes — immutable weights, capped fees, permissionless redemption, no broker.

## Problem

- Tokenized equities exist (Backed xStocks, Ondo) but there is **no consumer layer to compose them** — users can buy single tokenized stocks but cannot bundle them into a personal index.
- Traditional ETFs: T+1/T+2 settlement, broker custody, market-hours-only, no transferability, NAV published daily.
- Existing onchain baskets (Set Protocol et al.) are EVM-only; Solana has no equivalent for tokenized-equity indices.

## Solution

1. **Stocks** — browse tokenized stocks across providers (live prices, sparklines).
2. **Tokenized ETFs** — the listings + education on how they differ from traditional ETFs (settlement, access, ownership, transferability, transparency).
3. **Baskets** — pick 2–20 tokenized stocks, fix weights in basis points, cap fees, deploy an immutable vault in one transaction. One share token, pro-rata ownership, oracle-free permissionless redemption (burn shares → receive the underlying tokens, anytime — even if the "protocol team" disappears).
4. Fees (entry ≤3%, exit ≤1%, management ≤3%/yr) split 90/10 creator/treasury — creators earn from their baskets.

## Why now

- xStocks launched on Solana mainnet (real Token-2022 mints, ScaledUiAmountConfig, transfer hooks) — the underlying layer is live and liquid.
- Tokenized-equity volume is growing; composition/index layer is the natural next stratum (the "Set Protocol moment" for tokenized equities).
- Solana's Token-2022 extensions (ScaledUiAmount, transfer hooks) finally make equity-grade token mechanics possible on-chain.

## Differentiators

- **Immutable by design** — weights/fees can never change after deploy (no rug-by-rebalance).
- **Oracle-free, permissionless redemption** — structurally proven (no whitelist/oracle/pauser account exists in the redeem path; source-level tested).
- **Self-custodial** — every share = pro-rata claim on real tokens in a PDA vault; backend never signs.
- **Creator economy** — anyone can publish a basket and earn 90% of its fees.

## Status (2026-09-03)

- **Protocol:** 3 Anchor programs, real Token-2022 CPIs, localnet E2E 8/8 PASS (deploy → whitelist → basket → mint → redeem → fee accrual). 178 Rust tests.
- **Backend:** real indexer (event decode, holdings sync, ScaledUiAmount multiplier), exact BigInt NAV engine, REST API with provenance markers. 392 TS tests.
- **Frontend:** new IA (Home / Stocks / ETFs / Baskets / Create wizard / Buy+Redeem / Portfolio), Roman-empire identity branch, monochrome+ethereal design system. Owner feedback rounds 1–4 applied.
- **Devnet:** paused on faucet funding (all airdrop routes exhausted; staged rerun ready). Mainnet xStock mints identified (real decimals: 8).

## Ask / next steps

- Complete devnet E2E (funding) → public demo.
- Legal review (strategy-basket positioning, jurisdiction controls).
- Mainnet-beta with capped TVL + attribution-complete xStock integration (8 decimals).

## Voice guardrails (for deck copy)

Never: ETF, fund, guaranteed, safe, financial advice, we manage your money. Always: strategy basket, index basket, onchain equity basket, xStocks-backed strategy token. `LEGAL_REVIEW_REQUIRED` items pending counsel.

## Current landscape — 2026-09-26

This section supersedes the historical no-competition claims above. Basalt public previews do not buy assets; V0 uses mock devnet assets; Managed V2 is localnet-only.

```json
{
  "landscape": {
    "as_of": "2026-09-26",
    "direct_competitors": [
      {
        "name": "Symmetry",
        "url": "https://symmetry.fi/",
        "status": "Resmî sayfa V3 mainnet beta diyor; işlem veya TVL bağımsız doğrulanmadı.",
        "strength": "Çoklu varlığı tek basket token ile temsil ediyor; ağırlıklar ve otomasyon belirgin.",
        "weakness": "Basalt açısından karşılaştırma notu: “Solana’da tek token basket” tek başına fark değil. Creator’ın gerekçesi ve remix deneyimi öne çıkmalı."
      },
      {
        "name": "Chamber (eski dHEDGE)",
        "url": "https://chamberfi.com/",
        "status": "dhedge.org güncel Chamber ürününe yönleniyor; resmî ürün yüzeyi incelendi.",
        "strength": "Vault oluşturma ve keşif için iki net giriş; manager ile katılımcıyı birlikte ele alıyor.",
        "weakness": "Basalt açısından karşılaştırma notu: İki eşit CTA korunmalı. Güven söylemi yalnızca uygulanmış mekanizma ve doğrulanabilir kanıtla desteklenmeli."
      },
      {
        "name": "Enzyme",
        "url": "https://docs.enzyme.finance/getting-started/enzyme-vault",
        "status": "Resmî dokümantasyon doğrulandı; yatırma/çekme işlemi denenmedi.",
        "strength": "Katılım karşılığında pay tokenı ve yapılandırılabilir sahiplik/transfer kuralları anlatılıyor.",
        "weakness": "Basalt açısından karşılaştırma notu: “Your share” dekoratif bir etiket kalmamalı: toplam pay → kişinin payı → mevcut varlıklardan oransal hak."
      },
      {
        "name": "xVault",
        "url": "https://docs.xvaultsol.com/docs/protocol/overview",
        "status": "Yalnızca ürün dokümanı; canlı dağıtım, backing ve kullanım doğrulanmadı.",
        "strength": "Kürasyonlu endeks vault’ları; v1’de kullanıcı basket’i kapsam dışı olarak belirtiliyor.",
        "weakness": "Basalt açısından karşılaştırma notu: Kullanıcı/creator üretimi olası konumlandırma alanı. Dokümanı çalışan ürün veya doğrulanmış güvenlik kanıtı sayma."
      }
    ],
    "substitutes": [
      {
        "name": "eToro CopyTrader",
        "approach": "https://www.etoro.com/en-us/copytrader/",
        "why_users_stay": "Kişiyi bul → portföyünü incele → kopyala; gelecekteki işlemler otomatik aynalanıyor."
      },
      {
        "name": "M1 Pies",
        "approach": "https://m1.com/invest/brokerage/",
        "why_users_stay": "Bir pie görseli üzerinden varlık, ağırlık ve düzenleme adımlarını tek tek gösteriyor."
      }
    ],
    "dead_projects": [
      {
        "name": "TokenSets legacy storefront",
        "why_failed": "Bilinmiyor. Alan adı park sayfası gösteriyor; protokolün veya şirketin başarısızlık nedeni doğrulanmadı."
      }
    ],
    "crowdedness": "crowded",
    "crowdedness_scope": "Geniş sosyal yatırım ve tokenlaştırılmış portföy kategorisi; Solana stock-basket alt alanının canlı yoğunluğu belirsiz.",
    "moat_type": "Olası creator dağıtımı ve güvenilir strateji geçmişi; henüz kanıtlanmadı.",
    "differentiation": "Creator thesis → visible allocation → editable remix; onchain shared ownership as a separately labelled prototype.",
    "report": "docs/competitive-landscape-2026-09-26.md"
  }
}
```

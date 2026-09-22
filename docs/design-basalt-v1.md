# Basalt — Visual Identity Spec (v1)

> Owner direction 2026-09-12: the project renames **FolioX → Basalt** and the
> identity becomes the **hexagonal basalt columns** — no Roman layer. This
> spec supersedes the FOUNDRY MARK (design-cyberpunk-yellow-v1 §7) while
> **inheriting its full token system unchanged**: near-black canvas,
> electric-yellow `#FCEE0A` primary with discipline, Chakra Petch display,
> Geist Mono terminal labels, neon data colors only inside charts, sharp
> corners. Dark mode is the flagship. The 2026-09-22 UX pass updates the
> create, detail, and redeem information hierarchy without changing the mark.

## 1. Concept — constituent columns

Basalt cools into hexagonal columns locked side by side (the Giant's
Causeway). The product maps immutable basket constituents into one share token.
Current devnet constituents are project mock Token-2022 mints; never describe
them as official issuer-backed xStocks.

- **Columns = constituents.** A basket's weights render as column heights —
  the mark is the product diagram.
- **One formation = one token.** Many columns, one causeway; many
  constituents, one basket share token.
- **Palette**: charcoal near-black canvas + electric yellow (molten accent)
  — volcanic industrial, not neon soup. Everything else inherited from
  cyberpunk-yellow-v1 §2 unchanged.
- Restraint rule carries over: if everything glows, nothing does.

## 2. The BASALT MARK (canonical geometry)

Three hexagonal columns of **descending height on a shared flat baseline**.
Reads as: basalt columns → index weights as column heights → an ascending
stack. ViewBox `0 0 24 24`; UI/stroke rendering uses `currentColor`,
stroke-width `1.7`, miter joins; mark bbox spans x 4.3–19.7, y 2.5–21.5.

| column | path (d) | height (units) |
|---|---|---|
| tall | `M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z` | 19 |
| mid | `M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z` | 12 |
| short | `M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z` | 7 |

Geometry facts (keep in sync if ever redrawn): column width 4.4, gap 1.1,
side margins 4.3, shared baseline y 21.5, bevel 1.2 (the pointed top facets
read as hexagonal caps seen in slight perspective). Descending heights
deliberately echo the retired FOUNDRY MARK's descending weight bars and the
weights-editor UI.

**Canonical source**: `LogoMark` in `app/components/shell/site-header.tsx`.
All other renditions reuse the same 24×24 relative geometry.

## 3. Renditions

| surface | file | rendering |
|---|---|---|
| Header wordmark | `site-header.tsx` | stroke mark (currentColor) + `B` in `text-primary`, `asalt` in foreground, Chakra Petch |
| Favicon | `app/app/icon.svg` | **filled** columns `#FCEE0A` on `#0A0A0B` rx 4, 1.2× centered scale, no seams (fills read at 16px) |
| Apple touch icon | `app/app/apple-icon.tsx` | filled columns + **cap-facet seams** (`#0A0A0B` 0.55-unit lines at each bevel base y 3.7/10.7/15.7) |
| OG image | `app/app/opengraph-image.tsx` | filled columns + seams at 220px, wordmark `BASALT`, yellow badge `XSTOCKS STRATEGY BASKETS · SOLANA`, yellow corner ticks, hairline grid |

Seam rule: the cap-facet seam appears only where the mark renders ≥100px;
below that it is visual noise.

## 4. Causeway tessellation (ambient motif)

Seven pointy-top hexagons (R 68, honeycomb cluster) = columns seen top-down.
Used as the hero watermark (inline SVG in `app/app/page.tsx`): white strokes
at 7% opacity, square node dots on cell centers, straight connector traces
between centers, heavy top fade + radial text scrim. Replaces the retired
concentric-hexagon "circuit blueprint". Section motifs elsewhere
(flow-section step 02 hexagon+plus, `//` chips, zero-padded mono numerals)
stay as-is — already consistent with Basalt.

Reference cluster (600×600 viewBox, center cell at 300,300, R 68, ring at
√3·R ≈ 117.8 along the edge-normal directions 0°/60°/…/300° — pointy-top
cells share edges, they never overlap): center `(300,300)`; ring centers
`(417.8,300) (358.9,198) (241.1,198) (182.2,300) (241.1,402) (358.9,402)`.

## 5. Naming & voice

- Product name: **Basalt** (always capitalized, never all-caps in prose; OG
  wordmark is the exception). Never "Basalt ETF" / "Basalt fund" — the
  standing AGENTS §1 legal ban on ETF/fund/guaranteed/safe/advice language
  applies unchanged. Use: strategy basket / index basket / onchain equity
  basket / xStocks-backed strategy token.
- Tagline: "Create an index. Own your thesis." (unchanged).
- One-liner for hackathon/social: **"Basalt — create and hold an onchain
  strategy basket on Solana."** In devnet media, add a visible “Devnet · mock
  tokens” label; do not call mock mints real stocks or official xStocks.
- Tone rules inherited from brand.md: short, factual, number-forward, no
  hype, no exclamation marks, no emojis.

## 6. What changed vs what didn't

Changed: brand name everywhere (docs, UI strings, package names
`basalt-app`/`basalt-backend`, spec `docs/basalt-v0-spec.md`), the mark,
favicon/apple/OG renditions, hero watermark, wordmark accent (trailing X →
leading B).

Unchanged (inherited from cyberpunk-yellow-v1): all color tokens in
`app/app/globals.css`, Chakra Petch/Geist/Geist Mono typography, layout
rules, component rules, `.bg-grid`/`.glow-primary`/`.text-glow`/
`.hairline-primary` utilities, home page order ("proof beats process").

Historical artifacts intentionally NOT renamed: `foliox_build_prompt.md`
(original prompt), `docs/devnet-live-2026-09-04.md` (dated evidence pack),
`backend/.devnet-live-evidence.json` (deploy evidence), local Postgres db
names (`foliox`, `foliox_devnet` in `.env*`).

## 7. Verification

Check the header mark, favicon at 16/32px, OG image, and current create/detail/redeem routes at desktop and mobile widths. Run the app typecheck, build, and relevant behavior tests after UI changes. Historical FolioX references in dated evidence and source documents are expected; current user-facing copy must say Basalt.

## 8. Product application — 2026-09-22

The mark and electric yellow anchor the create, basket detail, and redeem routes. Yellow identifies the primary action and visible focus; avoid using chart colors as navigation or fee decorations. Chakra Petch heads the route and major sections; Geist carries explanatory copy; Geist Mono carries compact numerical values. Use the responsive token colors in `app/app/globals.css`, including its darker light-mode yellow.

- **Create:** four tasks — Choose, Set up, Start, Review — replace the six-step/duplicate-summary layout. Target allocations and total appear as percentages, adding to **100%**. Fee fields start at zero and show percentages, with a per-year label for the annual fee. “Balance to 100%” is the plain-language correction action. The starting deposit is expressed as constituent tokens; USD is an optional sourced reference estimate. Technical bps remain in the protocol boundary and advanced transaction details. Review and required legal acknowledgments are reachable before wallet connection; deploy checks wallet and seed balances. Do not show transaction byte estimates in product copy. Explicit wrong-network messaging and retrievable metadata publishing remain open backlog items.
- **Basket detail:** the first reading order is identity and honest backing label, composition, sourced/as-of reference price or performance when present, fee schedule, key risks, then buy/redeem actions. Keep addresses, raw/scaled amounts, drift math, and fee formulas in an accessible “Advanced details” section.
- **Redeem:** explain the share exchange and show the actual exit fee in shares with underlying quantities before signing. Place permissionless and oracle-free mechanics in advanced protocol information. There is no oracle fee.
- **Media:** screenshots, OG, and launch video must show the current Basalt app, its mark and yellow accent, and devnet/mock data labels. Do not substitute imagery from the historical `master` FolioX scaffold.

Legal vocabulary and `LEGAL_REVIEW_REQUIRED` status follow `AGENTS.md` and `docs/basalt-v0-spec.md`. On-chain redemption remains independent of the backend, an oracle, and mint-pause status. The current UI still needs indexed supply and vault balances for its preview; BAS-034 tracks a direct-RPC fallback for indexer outages.

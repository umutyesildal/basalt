# Home and Create owner feedback, 2026-10-02

This records the earlier home/Create freeze in the canonical checkout, `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`. **Its fee-first hero and illustration placement are superseded by [the final calm-hero restoration](home-hero-restoration-2026-10-02.md).** The catalog, weight-removal, focus and comma-preserving input improvements remain current. The dated validation below belongs to this earlier freeze; the 38-test suite was not rerun for the restoration. The earlier [visual-creation audit](design-home-visual-creation-2026-10-02.md), [discovery audit](design-home-discovery-2026-10-02.md), and [performance audit](product-performance-audit-2026-10-02.md) remain dated evidence for their scopes. Their passing builds do not substitute for this revision's validation.

## Owner requests and resulting behavior

| Request | Implementation at this revision |
|---|---|
| Say stock baskets clearly on the first screen | The large H1 reads **“Create stock baskets. Earn management fees.”** Primary action: **Create a stock basket**. Secondary action: **Explore baskets**. |
| Make management fees the leading creator motivation | `CreatorRewardVisual` moved into the opening two-column hero. It shows **Annual management fee**, **Up to 3%**, and a separate Bklit 90/10 fee-share bar. The nearby body conditions fees on investing opening; the status says **“Basket sharing is open. Investing and fees are in development.”** The lower section retains only **“Good stock picks can come from anyone.”** and **Share your stock basket**. |
| Make all catalog assets reachable | Create renders all 41 catalog assets in a bounded native scroll region. The bottom fade contains a keyboard-accessible down button, advances the catalog, and disappears at the end or when results fit. Name/ticker/category search remains available. |
| Allow removal while setting weights | Each allocation row has an accessible remove action. Remaining allocations redistribute to positive integer weights summing to exactly 10,000 bps. A one-stock remainder retains 100% but disables Continue and asks for another stock. Add stocks returns to Choose and focuses search. Focus moves to a neighboring allocation or Add stocks after removal; a live status announces the change. |
| Use comma grouping without breaking editing | USD amounts, counts, and percentages use shared grouped display helpers. The example-amount input groups thousands while preserving blank and decimal drafts, trailing zeros, caret position, and the original numeric value. Existing validated copied amounts retain their original precision while newly entered amounts retain the editor's two-decimal rules. |

The compact lower quote is part of the opening/layout revision. Discovery keeps the original four featured covers and existing model metrics.

## Fee meaning and release boundary

The 3% figure is the planned V0 maximum **annual management rate**. The 90/10 figures divide fee shares between the creator and Basalt; they are not portfolio returns, ownership weights, or an additional fee rate. Fees accrue over time whether prices rise or fall and are paid in newly issued basket shares, diluting holders. The existing protocol uses the then-current raw share supply and may compound slightly at accrual checkpoints; this UI work does not change that formula or the canonical split.

Public Create still shares basket ideas without buying assets, deploying a vault, or earning fees. Its management-fee control is visible, labeled per year, and describes future share payment; entry/exit settings stay in their secondary disclosure. Preview summaries keep management fees first. Official xStocks support, public investing, realized creator-fee accounting, and Managed V2 deployment remain separate release work. Historical model performance still excludes fees and remains distinct from execution results.

## Interaction and formatting details

- Scroll state uses the actual remaining scroll distance with a two-pixel end tolerance and observes content/viewport resizing. Search resets catalog position. If a focused down button disappears at the end, focus returns to the catalog region. Reduced motion avoids smooth advancement.
- Asset selection remains 2–20 for progression. Removing to zero or one stock remains editable but cannot advance. Redistribution preserves relative remaining weights within integer rounding and assigns at least one bps to each remaining stock. Slider limits reserve one bps for every other stock.
- Input validation remains above $0 and at most $1,000,000. Blank, malformed pasted comma groups, negative values, exponents, excessive decimal precision, and over-cap values do not become a silent zero. Supported drafts such as `1,000.` and `1,000.00` retain editing intent.
- Missing and non-finite display values use `--`. Genuine tiny nonzero changes keep their sign through threshold notation; rounded zero does not become a fake signed return. Full USD/count/percentage grouping does not widen raw integer or on-chain accounting rules. Token-specific abbreviations remain separate.
- Home keyboard focus uses the text-grade `--primary-text` outline token. Static calculation gives 4.76:1 against the light paper canvas, replacing the former fill-token outline's 1.59:1. Decorative chart/journey content is hidden from accessibility APIs with a text explanation on the figure.

## Source map

| Files | Scope |
|---|---|
| `app/components/home/home-experience.tsx` | Explicit H1, creation action, adjacent future status, relocated visual, compact lower invitation |
| `app/components/home/creator-reward-visual.tsx` | Annual cap, separately labeled fee-share split, stock/basket/people illustration |
| `app/app/globals.css` | Hero columns, bottom-aligned actions, mobile stacking, text-grade focus outlines |
| `app/components/create/concept-create.tsx` | Full scrolling catalog, end-aware fade/button, removal/focus, minimum guard, grouped draft, visible annual-fee control, review cleanup |
| `app/components/create/concept-create-utils.ts` and regression test | Existing redistribution extracted for testing; scroll-end, grouped-input/caret, and copied-precision helpers |
| `app/lib/format.ts` and regression test | Shared grouped display and input parsing, safe unavailable/tiny-value behavior |
| Shared basket metrics, preview and leaderboard consumers | Reuse the display helpers; no new performance calculation or fee formula |

## Verification for the final code freeze

The root agent completed the code freeze and supplied the logs. This documentation pass read their final summaries; it did not run an application build, start a server, or interact with the browser.

- **Final frontend tests: 38 passed, zero failures.** Format 10, Create helpers 7, model calculations 12, shared store 8, and concept-preview/sample integrity 1. The earlier report of 37 preceded the additional copied-amount precision test and is superseded.
- **Final Next.js production build and TypeScript check passed.** The log generated 25 static pages and includes the dynamic routes. Existing multi-lockfile and optional native bigint warnings remain recorded build limitations.
- The implementation agent also reported **4 legacy backend price/share tests passing** earlier in this revision. This is separate from the previous indexed integrity audit's full 672-backend and 214-Rust test results. No fresh full backend/Rust run is claimed for this UI-only pass.
- Root production-browser checks covered 320, 375, 768 and 1280px with no horizontal overflow. At 1280px, both hero columns shared top 133.796875px and bottom 661.5px. First-screen fee content was visible at 375px. All 41 catalog assets, end-of-list fade removal and PLTR search were verified.
- Root verified deletion through four, three, two and one remaining assets, with exact 10,000-bps totals; a tested intermediate mix was `3,334 / 4,000 / 2,666`. One stock disabled Continue, and Add stocks focused search.
- Root verified `12,345.67` followed by a middle backspace produced `1,234.67` with caret recovery, and the preview showed **$1,234.67** with **Management 3%/yr** first. Blank and over-$1,000,000 drafts blocked progression; $1,000,000 fit at 320px.
- The final Create copy clarified the fee's value basis, removed a duplicate review summary, and fixed singular stock-count accessibility wording. Source review confirmed native scrolling, responsive stacking, focus recovery and reduced-motion behavior. A full screen-reader, zoom and cross-browser certification was not performed.

Reproduce the frontend tests from the repository root:

```sh
TSX_TSCONFIG_PATH=app/tsconfig.json node --import tsx --test app/lib/format.test.ts app/components/create/concept-create-utils.test.ts app/lib/basket-performance.test.ts app/lib/use-basket-performance.test.ts app/tests/concept-preview.test.ts
npm --prefix app run build
```

Final logs were read at `/private/tmp/basalt-home-create-tests.log` and `/private/tmp/basalt-home-create-build.log`, then saved by the root agent under `docs/assets/home-create-feedback-2026-10-02/`. The local production preview runs on port 3000. No commit, push, remote deployment, protocol edit or fresh chain transaction is established by these UI changes.

### Durable evidence

[Final tests](assets/home-create-feedback-2026-10-02/tests.log) · [Final build](assets/home-create-feedback-2026-10-02/build.log)

| View | Evidence |
|---|---|
| Hero, 375 / 768 / 1280px | [Mobile](assets/home-create-feedback-2026-10-02/home-375.png) · [Tablet](assets/home-create-feedback-2026-10-02/home-768.png) · [Desktop](assets/home-create-feedback-2026-10-02/home-1280.png) |
| Complete stock catalog | [Desktop](assets/home-create-feedback-2026-10-02/catalog-1280.png) · [Mobile](assets/home-create-feedback-2026-10-02/catalog-375.png) |
| Weight removal and annual-fee controls | [Weights](assets/home-create-feedback-2026-10-02/weights-375.png) · [Fees](assets/home-create-feedback-2026-10-02/fees-375.png) |

## Documentation handoff

Current-entry paragraphs in AGENTS, CLAUDE, CONTEXT, root/app README, the documentation map, handoff, brand and session notes now point to the final restoration for layout and this record for retained Create controls. Older design decisions remain explicitly historical. Preserve the existing dirty application, governance, verifier, package, wallet and media work. See [indexed return integrity](indexed-basket-return-integrity.md) for the separately completed raw-share return fixes and database-view upgrade.

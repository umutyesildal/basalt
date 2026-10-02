# Landing benefits and role journeys, 2026-10-03

This owner-directed revision follows the successful Git checkpoint `0ac63ae3675ea0dcab45d4747c7f215b110e5731` on `main`. Root confirmed the push and matching remote branch head; read-only inspection also found local HEAD and `origin/main` at that hash. [The checkpoint record](git-checkpoint-2026-10-03.md) describes its preserved scope. The owner accepted this landing revision and explicitly requested its commit and push to the existing `origin/main` before backend work continues. This is a source update, not a deployment.

## Requested composition

| Order | Content and boundary |
|---|---|
| 1. Discovery opening | Keep the calm **Find a stock basket / you believe in.** hero and four featured cards. Use the single hero description **Or create one that fits your needs.** Remove the hero's status sentence and the home-only model source/date and **How these numbers work** note. Retain truthful **Model price** labels on individual cards. |
| 2. Benefits | The heading **Built for people with a point of view.** introduces six cards: **Find your view**, **See every pick**, **Make your own mix**, **Share your thinking**, **Earn management fees**, and **Built for xStocks**. The fee card says **Set your rate for when investors can back your basket.** |
| 3. Creation | Retain **Good stock picks can come from anyone.**, the conditional future-fee paragraph, **Build your stock basket** and the existing reward visual in `#build`. |
| 4. Role journeys | `#how-it-works` contains **I am an investor** with two visual steps: select a basket, then choose an amount and back it when investing opens. **I am a basket manager** contains three: choose a stock mix, write a thesis, then set a management fee. Reuse actual original basket covers. |
| Bottom details | Only the two existing collapsed **Why xStocks?** and **How will fees work?** disclosures remain at the bottom. The repeated standalone xStocks line is removed; no FAQ heading is introduced. |

The removal of the methodology note is scoped to the landing. Other model-performance surfaces and the calculations themselves are unchanged. Historical underlying-stock models remain distinct from acquired xStocks, realized investor returns and creator revenue. The role explanation does not establish automatic copying or rebalancing. Public Create remains wallet-free sharing.

The planned annual management-rate cap remains up to 3%; 90% creator / 10% Basalt divides fee shares. Payment is in newly issued basket shares with holder dilution. These meanings and future availability remain in the creator/fee explanation; no financial formula or release boundary changes.

## Source and verification

Source inspection confirms the composition is saved in `app/components/home/home-experience.tsx`, with benefit styling in `app/app/globals.css` and the new `app/components/home/role-journeys.tsx` / `role-journeys.module.css`. The role selector uses linked ARIA tabs/panels, roving focus and Left/Right/Home/End navigation. Original sample links and covers are reused; the $1,000 amount and 1% annual rate are static visual examples. No purchase control is introduced.

The final production build passed with exit 0. Read-only inspection of the [durable build log](assets/landing-journeys-2026-10-03/build.log) confirms successful compilation, TypeScript checking and 25 static pages. Existing workspace-lockfile and optional native bigint warnings remain in the log.

Root's production-browser checks verified:

- The six benefits form a 3 × 2 grid at 1280px and two columns at 768px. No horizontal overflow occurred at 1280, 768, 375 or 320px.
- The removed hero status, landing source/date note and **How these numbers work** text are absent. Individual Model price and 7D labels remain.
- Exactly one role panel is active, with two investor steps or three manager steps. ArrowRight, Home and End change the selected tab and move focus correctly. Visible tab buttons measured 44px at 375px and 60px at 320px.
- All visible investor images loaded. The manager **Create your basket** action navigated to `/create`. Browser console errors were empty before and after that navigation.

| View | Actual evidence |
|---|---|
| Hero and featured discovery | [Desktop](assets/landing-journeys-2026-10-03/journeys-home-desktop.png) · [Mobile](assets/landing-journeys-2026-10-03/journeys-home-mobile.png) |
| Six benefits | [Desktop](assets/landing-journeys-2026-10-03/journeys-benefits-desktop.png) |
| Investor journey | [Desktop](assets/landing-journeys-2026-10-03/journeys-investor-desktop.png) · [Mobile](assets/landing-journeys-2026-10-03/journeys-investor-mobile.png) |
| Manager journey | [Desktop](assets/landing-journeys-2026-10-03/journeys-manager-desktop.png) · [Mobile](assets/landing-journeys-2026-10-03/journeys-manager-mobile.png) |

Root's final checks confirmed the investor example link opens the Terminally Online preview and normal Back navigation returns home. The mobile hero was checked at 375px with scroll at zero and saved above. Final landing DOM contained no em dashes, and browser console errors remained empty. The viewport override was reset and the local home preview was left open as the deliverable. The earlier [hero restoration](home-hero-restoration-2026-10-02.md), [cover audit](basket-cover-refresh-2026-10-02.md) and [Create audit](home-create-feedback-2026-10-02.md) preserve their dated evidence. The earlier 38-test suite has not been rerun for this revision.

This documentation assignment edits Markdown only. It does not modify application files, start a server, run builds/tests or commit/push. Existing ten-cover identity, Create controls, protocol constraints and dirty work must remain preserved.

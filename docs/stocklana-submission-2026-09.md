# Basalt — Stocklana submission (2026-09)

> Source of truth for the hackathons.solana.com/hackathons/stocklana form.
> Deadline: **Sep 18, 2026, 4:00pm ET** (judging through Oct 2). $100k pool, single main track.
> Judging bar: "could this be a real app that people will actually use?" — real user + problem,
> working end-to-end demo, a reason it belongs on Solana, quality of execution.
> Companion doc: `docs/ideathon-submission-2026-09.md` (won, top-10 of 38).

## Field: Project name

```
Basalt
```

## Field: One-liner (191/280) — hook + product + killer feature

```
Stocks went on-chain. Portfolios didn't. Basalt is the fix: build your basket of tokenized stocks on Solana — or copy a top trader's — and hold it as one token, with an exit no one can pause.
```

Alternates:
- (148) `Build your own index of tokenized stocks on Solana — or copy a top trader's. One token, real stocks, every trade on-chain, an exit no one can pause.`
- (176) `One token for your whole stock thesis. Pick the stocks, set the weights, hold the basket — or just copy a top trader's. On Solana, cash out anytime: no one can pause your exit.`

## Field: Detailed description (2347/5000) — pitch voice, every line sells

```
THE PROBLEM

$25B+ of tokenized stocks already traded on Solana this year — yet you still can't hold "NVDA 40 / AAPL 30 / MSFT 30" as one position without a brokerage. Custody, market hours, T+1 settlement, and someone who can lock the door on your way out.

And the traders who are actually good at this? They can't prove it. Screenshots can be faked. Settlement can't.

WHAT BASALT DOES

Basalt turns tokenized stocks into one-token portfolios.

CREATE — pick 2-20 stocks, set the weights and fees, deploy. Immutable forever. Not even us can change it.

BUY — pay with the stocks themselves or zap USDC. You get one token. That token IS the portfolio: a pro-rata claim on the real stocks in the vault.

REDEEM — burn it, get your stocks back. 24/7, instantly, no operator. This isn't a policy — it's how the program is built. There is no pause button in the code, and a test proves it.

FOLLOW — every trade settles on-chain and lands in the live feed. Follow top traders with receipts, not screenshots. Or build your own basket and get followed.

WHY SOLANA

- The stocks already live here. xStocks are native Token-2022 mints on Solana — ~95% of all on-chain stock trading happens on this chain.
- "No one can pause your exit" is a promise a company can make and break. A program can't. That's the whole product.
- Sub-cent fees make a 20-stock basket one click; Jupiter zaps USDC in.

PROOF, NOT PROMISES (live on devnet)

- Try it now: https://basalt-coral.vercel.app/explore — create, buy, redeem, all working end-to-end.
- 3 deployed programs, verified basket creation/mint/redeem transactions, and NAV reconciled to the unit. Indexed basket counts are dynamic.
- The redemption proof: we paused a stock, and holders could still get their money out. See it: https://explorer.solana.com/address/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo?cluster=devnet
- 733 automated tests behind the math in the verified 2026-09-18 working tree.

HONESTY

Original solo build, live on devnet before this hackathon — it won Superteam Germany's Road-to-Colosseum Ideathon (top-10 of 38). No wrappers: the programs, indexer, pricing engine and UI are all first-party. Stocklana week: hardening the end-to-end flow and shipping the demo video.

WHAT'S NEXT

Mainnet xStocks integration → upgrade authority to a multisig + external review → capped mainnet-beta launch.

TEAM

Solo builder, full-stack Solana, based in Germany. Ships weekly.
```

## Field: Links (at least one of GitHub / live demo / video)

1. Live demo: https://basalt-coral.vercel.app/explore
2. Devnet basket on explorer: https://explorer.solana.com/address/CZCHnprMPvBFLCs5jwApLMPj1MEUMGJ4SWr4WWzKXYCo?cluster=devnet
3. GitHub: TODO — make repo public or add a highlight reel README link
4. Video (1-min Loom walkthrough): TODO — record after the sprint; the ideathon draft already planned this

## Teammates

Solo — invite none, or add collaborator accounts if the sprint adds a contributor.

## Post-submit checklist

- [ ] Register + submit before Sep 18, 4:00pm ET (edits allowed until close — submit early, refine later)
- [ ] Fill exact ideathon rank once Superteam Germany posts the winner list
- [ ] Record 1-min Loom after the devnet sprint (create → buy → redeem on Phantom)
- [ ] GitHub repo public or a public evidence page

/**
 * Risk tab — static, protocol-level, honest. This is the same method and risk
 * text for every basket: Basalt does not write per-basket risk editorials
 * (unlike Cesto's per-basket write-ups, which are marketing-shaped). Voice per
 * brand.md: short, factual, number-forward; no ETF/fund vocabulary; no
 * reassurance language.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BasketSectionHeader } from "@/components/basket/basket-page-section-header";
import { PROTOCOL_FEE_SPLIT_LABEL } from "@/lib/protocol-policy";

const METHOD: { title: string; body: string }[] = [
  {
    title: "One token, one vault",
    body: "A basket is a Token-2022 share token backed by a program-owned vault of whitelisted xStocks. The share token is a receipt for vault assets, not a claim on any issuer.",
  },
  {
    title: "Atomic mint and redeem",
    body: "mint_in_kind deposits every constituent in one atomic transaction — it settles completely or not at all. redeem_in_kind burns shares and returns the underlying tokens permissionlessly and oracle-free, in a single transaction.",
  },
  {
    title: "Immutable weights and fees",
    body: "Constituents, weights and fees are fixed at creation and cannot be changed afterwards. There is no auto-rebalance in V0, so actual weights drift from targets as prices move.",
  },
  {
    title: "Fee mechanics",
    body: `The management fee accrues on-chain by minting new shares (supply dilution) via the permissionless accrue_management_fee crank: (then-current supply × rate × elapsed + stored numerator remainder) ÷ (10,000 × seconds per year), capped at 3.00%/yr. Newly minted fee shares make later intervals compound slightly. Entry (cap 3.00%) and exit (cap 1.00%) fees are one-time and also paid in shares, split ${PROTOCOL_FEE_SPLIT_LABEL}.`,
  },
];

const RISKS: { title: string; body: string }[] = [
  {
    title: "Smart contract risk",
    body: "Three Anchor programs (whitelist, basket_factory, basket) hold and move vault assets. The code is tested (program-level and integration suites) but an independent audit is still pending — treat contract risk as live until it completes.",
  },
  {
    title: "Upgrade governance risk",
    body: "Basket parameters are immutable, but the programs remain upgradable. A finalized read-only devnet RPC audit on 2026-09-19 confirmed that all three program upgrade authorities and the separate whitelist configuration authority remain one wallet. No multisig or timelock is active, and the target 2-of-3 policy has not yet been activated.",
  },
  {
    title: "Price tracking and depeg",
    body: "Basket value tracks xStock prices. xStocks are tokenized references to underlying equities and can trade away from them, so share price can deviate from the notional basket value.",
  },
  {
    title: "Token-2022 multiplier changes",
    body: "Display and NAV amounts use the ScaledUiAmount multiplier. The multiplier can change; raw on-chain balances remain the source of truth and all transfers move raw amounts.",
  },
  {
    title: "Slippage on USDC legs",
    body: "The Zap USDC path quotes per-leg Jupiter routes served by the backend. Legs execute sequentially and are not atomic — a partial failure leaves earlier legs settled. Typical quoted slippage is 1–3% and is not guaranteed.",
  },
  {
    title: "Drift without rebalancing",
    body: "Weights never rebalance themselves in V0. Actual weights diverge from targets as constituent prices move; the holdings table shows the drift, nothing corrects it.",
  },
  {
    title: "Short, indexed-only history",
    body: "NAV history exists only from a basket's creation and only where the indexer has snapshots. There is no backtested or simulated performance anywhere in Basalt, and none should be inferred from the chart.",
  },
];

export function BasketPageRisk() {
  return (
    <div className="space-y-8">
      <section aria-label="Method" className="space-y-4">
        <BasketSectionHeader
          eyebrow="Protocol level"
          title="Method"
          note="identical for every basket"
        />
        {/* auto-rows-fr keeps every card in the section the same height */}
        <div className="grid gap-3 sm:grid-cols-2 sm:auto-rows-fr">
          {METHOD.map((item) => (
            <Card key={item.title} className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>{item.title}</CardDescription>
                <CardTitle className="text-sm font-normal leading-6 text-muted-foreground">
                  {item.body}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section aria-label="Risks" className="space-y-4">
        <BasketSectionHeader
          eyebrow="What can go wrong"
          title="Risks"
          note="not exhaustive · not advice"
        />
        <div className="grid gap-3 sm:grid-cols-2 sm:auto-rows-fr">
          {RISKS.map((item) => (
            <Card key={item.title} className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>{item.title}</CardDescription>
                <CardTitle className="text-sm font-normal leading-6 text-muted-foreground">
                  {item.body}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
        <p className="font-mono text-[11px] leading-5 text-muted-foreground">
          This page describes the protocol, not any single basket's outlook. Basalt publishes no
          per-basket risk editorials and no return estimates — read the on-chain accounts and the{" "}
          <span className="font-mono">/legal</span> page before transacting.
        </p>
      </section>
    </div>
  );
}

export default BasketPageRisk;

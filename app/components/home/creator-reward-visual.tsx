"use client";

import { useState } from "react";
import { ArrowRight, UserRound } from "lucide-react";

import { BasketCover } from "@/components/basket/basket-story-card";
import { BarChart } from "@/components/charts/bar-chart";
import { Bar } from "@/components/charts/bar";
import { Card } from "@/components/ui/card";
import { CONCEPT_BASKETS } from "@/lib/concept-samples";
import { logoUrl } from "@/lib/logos";

// A product illustration. The fee split is the planned V0 policy, not returns.
const FEE_SPLIT = [{ name: "Management fee", publisher: 90, protocol: 10 }];
const EXAMPLE = CONCEPT_BASKETS[0];

function StockChip({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="maker-stock-chip">
      {failed ? <span>{symbol}</span> : <img src={logoUrl(symbol)} alt="" width={36} height={36} loading="lazy" onError={() => setFailed(true)} />}
    </span>
  );
}

export function CreatorRewardVisual() {
  return (
    <figure className="maker-visual" aria-label="Planned management fees: choose an annual rate up to 3 percent of basket value. Fee shares are split 90 percent to you and 10 percent to Basalt. Choose stocks, share your basket, and let others invest when investing launches.">
      <div className="maker-fees">
        <div className="maker-fee-heading"><span>Annual management fee</span><span className="font-mono tabular-nums">Up to 3%</span></div>
        <p className="maker-fee-explanation">You choose the rate on your basket’s value.</p>
        <div className="maker-fee-chart" aria-hidden="true">
          <BarChart data={FEE_SPLIT} orientation="horizontal" stacked barGap={0} barWidth={12} stackGap={0} valueDomain={[0, 100]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} aspectRatio="auto" className="h-5" animationDuration={0} enterTransition={{ duration: 0 }}>
            <Bar dataKey="publisher" fill="hsl(var(--primary))" lineCap={2} animate={false} />
            <Bar dataKey="protocol" fill="hsl(var(--muted-foreground))" lineCap={2} animate={false} />
          </BarChart>
        </div>
        <div className="maker-fee-labels"><span><strong className="font-display tabular-nums">90%</strong> to you</span><span><strong className="font-display tabular-nums">10%</strong> to Basalt</span></div>
        <p className="maker-fee-caption">Your share of the fee, paid in basket shares.</p>
      </div>
      <div className="maker-journey" aria-hidden="true">
        <div className="maker-picks">
          <div className="maker-stock-stack">{EXAMPLE.allocations.slice(0, 3).map(({ symbol }) => <StockChip key={symbol} symbol={symbol} />)}</div>
          <span className="maker-caption">Your picks</span>
        </div>
        <ArrowRight className="maker-connector" />
        <Card className="maker-basket">
          <BasketCover basket={EXAMPLE} />
          <div className="maker-basket-label"><span className="font-display">Your basket</span><span>by you</span></div>
        </Card>
        <ArrowRight className="maker-connector" />
        <div className="maker-people">
          <div className="maker-people-group"><span><UserRound /></span><span><UserRound /></span><span><UserRound /></span></div>
          <span className="maker-caption">People back it</span>
        </div>
      </div>

    </figure>
  );
}

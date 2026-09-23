"use client";

import { useMemo } from "react";

import { IconCopyButton as CopyButton } from "@/components/ui/copy-button";
import { PieChart } from "@/components/charts/pie-chart";
import { PieCenter } from "@/components/charts/pie-center";
import { PieSlice } from "@/components/charts/pie-slice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  numericToNumber,
  type BasketDetail,
} from "@/components/basket/basket-api";
import { BasketSectionHeader } from "@/components/basket/basket-page-section-header";
import { formatAsOf, formatBpsAsPercent, formatTokenAmount, truncateAddress } from "@/lib/format";
import { PROTOCOL_FEE_SPLIT_LABEL } from "@/lib/protocol-policy";

/**
 * About tab — what this basket is and what it costs:
 *
 *  · Composition donut (weights_bps → slices, ethereal chart palette cycling)
 *    with a constituent list; every mint address is copyable (basket share
 *    mint on top, constituent mints per row).
 *  · The holdings table (target vs actual, raw on-chain truth vs scaled
 *    display), unchanged from the pre-tab detail page.
 *  · The fee block per spec §6: management fee streams as share dilution via
 *    `accrue_management_fee` (fee_shares = supply × rate × elapsed /
 *    (10,000 × seconds-per-year), capped at 300 bps/yr), entry/exit one-time
 *    fees with their protocol caps, and the canonical protocol fee split.
 *
 * All figures are API-driven; missing values render as em dashes.
 */

function sliceColor(index: number): string {
  return `hsl(var(--chart-${(index % 5) + 1}))`;
}

export function BasketPageAbout({
  detail,
  mintTickers,
}: {
  detail: BasketDetail;
  mintTickers: Map<string, string>;
}) {
  const weights = detail.weights_bps ?? [];

  const donutData = useMemo(() => {
    return detail.constituents
      .map((mint, i) => {
        const bps = weights[i];
        if (bps === undefined || bps <= 0) return null;
        const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
        return { label: ticker, value: bps / 100, color: sliceColor(i) };
      })
      .filter((slice): slice is { label: string; value: number; color: string } => slice !== null);
  }, [detail.constituents, mintTickers, weights]);

  const holdingsByMint = useMemo(
    () => new Map((detail.holdings ?? []).map((h) => [h.mint, h])),
    [detail],
  );

  // Footer total for the holdings table — sum of scaled amounts that exist;
  // null when the indexer returned no scaled figures (total row is skipped).
  const scaledTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const holding of detail.holdings ?? []) {
      const scaled = numericToNumber(holding.scaled_amount ?? null);
      if (scaled !== null) {
        sum += scaled;
        any = true;
      }
    }
    return any ? sum : null;
  }, [detail]);

  const driftActual = detail.drift?.actualWeightsBps ?? null;
  const lastAccrualSeconds = numericToNumber(detail.last_fee_accrual_ts ?? null);

  return (
    <div className="divide-y divide-border">
      {/* composition — donut + copyable mint list */}
      <section aria-label="Composition" className="pb-10 pt-2">
        <BasketSectionHeader
          eyebrow="Allocation"
          title="Composition"
        />
        <div className="grid gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:gap-10">
          <div className="justify-self-center">
            {donutData.length > 0 ? (
              <PieChart data={donutData} size={200} innerRadius={62}>
                {donutData.map((slice, index) => (
                  <PieSlice
                    key={slice.label}
                    index={index}
                    animate={false}
                    hoverEffect="none"
                    showGlow={false}
                  />
                ))}
                <PieCenter defaultLabel="Allocated" suffix="%">
                  {({ isHovered, data }) =>
                    isHovered ? (
                      <span className="font-mono text-sm tabular-nums text-foreground">
                        {data.label}{" "}
                        <span className="text-muted-foreground">
                          {((data.value / donutData.reduce((s, d) => s + d.value, 0)) * 100).toFixed(0)}%
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-sm tabular-nums text-foreground">
                        {donutData.length}
                        <span className="ml-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          assets
                        </span>
                      </span>
                    )
                  }
                </PieCenter>
              </PieChart>
            ) : (
              <div className="flex size-[200px] items-center justify-center rounded-xl border border-border">
                <p className="px-4 text-center font-mono text-[11px] text-muted-foreground">
                  Weights not indexed yet
                </p>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-1">
            <ul className="divide-y divide-border/60">
              {detail.constituents.map((mint, i) => {
                const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
                const target = weights[i];
                return (
                  <li key={mint} className="flex items-center justify-between gap-3 py-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: sliceColor(i) }}
                      />
                      <span className="font-mono text-xs font-medium text-foreground">{ticker}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs tabular-nums text-foreground">
                        {target !== undefined ? formatBpsAsPercent(target) : "—"}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

          </div>
        </div>
      </section>

      {/* fees — spec §6 math, one visually quiet card */}
      <section aria-label="Fees" className="pt-10">
        <BasketSectionHeader
          eyebrow="What it costs"
          title="Fees"
        />
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 first:pt-5">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Management
                </p>
                <p className="font-mono text-xl tabular-nums text-foreground">
                  {formatBpsAsPercent(detail.management_fee_bps)}
                  <span className="text-sm text-muted-foreground">/yr</span>
                </p>
                <p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground">An annual charge paid through new basket shares.</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Entry
                </p>
                <p className="font-mono text-xl tabular-nums text-foreground">
                  {formatBpsAsPercent(detail.entry_fee_bps)}
                </p>
                <p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground">Charged when someone adds to this basket.</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                  Exit
                </p>
                <p className="font-mono text-xl tabular-nums text-foreground">
                  {formatBpsAsPercent(detail.exit_fee_bps)}
                </p>
                <p className="mt-1 max-w-48 text-xs leading-5 text-muted-foreground">Charged when someone exits this basket.</p>
              </div>
            </div>
            <details className="text-[11px] leading-5 text-muted-foreground">
              <summary className="cursor-pointer font-medium">Advanced details — fee calculation</summary>
              <p className="mt-2 font-mono">
              Management accrues on-chain as share dilution:{" "}
              <span className="whitespace-nowrap">(supply × rate × elapsed + stored remainder)</span> ÷{" "}
              <span className="whitespace-nowrap">(10,000 × seconds per year)</span>, minted{" "}
              {PROTOCOL_FEE_SPLIT_LABEL} by the permissionless{" "}
              <span className="font-mono">accrue_management_fee</span> crank — capped at 3.00%/yr.
              Each checkpoint uses the then-current supply; newly minted fee shares therefore
              make later intervals compound slightly. Entry is one-time on mint (cap 3.00%), exit
              on redeem (cap 1.00%). Weights and fees are immutable on-chain.
              </p>
            </details>
            {lastAccrualSeconds !== null && lastAccrualSeconds > 0 ? (
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                Last fee accrual {formatAsOf(lastAccrualSeconds * 1000)}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
      {/* operator values remain available without crowding the decision view */}
      <details className="group py-8">
        <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Advanced details — addresses and vault accounting
        </summary>
        <div className="mt-5 flex items-center justify-between gap-3 border-b border-border pb-3 text-xs">
          <span>Basket share mint · Token-2022 · {truncateAddress(detail.share_mint, 10, 8)}</span>
          <CopyButton value={detail.share_mint} label="Copy basket share mint" />
        </div>
        <ul className="divide-y divide-border/60">
          {detail.constituents.map((mint) => (
            <li key={mint} className="flex items-center justify-between gap-2 py-2 font-mono text-xs">
              <span>{mintTickers.get(mint) ?? truncateAddress(mint, 4, 4)} · {truncateAddress(mint, 8, 8)}</span>
              <CopyButton value={mint} label={`Copy ${mintTickers.get(mint) ?? "asset"} mint`} />
            </li>
          ))}
        </ul>
      <section aria-label="Holdings" className="pt-8">
        <BasketSectionHeader
          eyebrow="Target vs actual"
          title="Vault holdings"
          note="no auto-rebalance in V0"
        />
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="h-11 hover:bg-transparent">
                  <TableHead className="pl-5 font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Asset
                  </TableHead>
                  <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Target
                  </TableHead>
                  <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Actual
                  </TableHead>
                  <TableHead className="text-right font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Raw
                  </TableHead>
                  <TableHead className="pr-5 text-right font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-muted-foreground">
                    Scaled
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.constituents.map((mint, i) => {
                  const holding = holdingsByMint.get(mint);
                  const target = weights[i];
                  const actual =
                    driftActual && driftActual[i] !== undefined ? driftActual[i] : null;
                  const scaledNumber = numericToNumber(holding?.scaled_amount ?? null);
                  const multiplier = numericToNumber(holding?.multiplier ?? null);
                  const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
                  return (
                    <TableRow key={mint} className="h-11">
                      <TableCell className="py-0 pl-5 font-mono text-xs tabular-nums" title={mint}>
                        {ticker}
                      </TableCell>
                      <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                        {target !== undefined ? formatBpsAsPercent(target) : "—"}
                      </TableCell>
                      <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                        {actual !== null ? formatBpsAsPercent(actual) : "—"}
                      </TableCell>
                      <TableCell className="py-0 text-right font-mono text-xs tabular-nums">
                        {/* raw = onchain truth — printed as text, never through Number */}
                        {holding?.raw_amount ?? "—"}
                      </TableCell>
                      <TableCell className="py-0 pr-5 text-right font-mono text-xs tabular-nums">
                        {scaledNumber !== null ? (
                          <span
                            title={
                              multiplier !== null
                                ? `raw × multiplier ${multiplier} / 10^${holding?.decimals ?? "?"}`
                                : undefined
                            }
                          >
                            {formatTokenAmount(scaledNumber)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {scaledTotal !== null ? (
                  <TableRow className="h-11 border-t border-border hover:bg-transparent">
                    <TableCell className="py-0 pl-5 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      Total scaled
                    </TableCell>
                    <TableCell colSpan={3} />
                    <TableCell className="py-0 pr-5 text-right font-mono text-xs tabular-nums">
                      {formatTokenAmount(scaledTotal)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
      </details>

    </div>
  );
}

export default BasketPageAbout;

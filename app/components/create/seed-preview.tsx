"use client";

import { AlertCircle, RefreshCw } from "lucide-react";

import { FreshnessBadge } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBpsAsPercent, formatUsd } from "@/lib/format";
import { TextField } from "./field";
import {
  formatRawAsTokenUnits,
  parseTokenUnitsToRaw,
  type ConstituentDraft,
} from "./types";

/**
 * Start — token deposits. The optional USD example is a UX estimate computed from
 * weights and reference prices (sourced, never a quote); the actual on-chain
 * values are the raw Token-2022 amounts, which stay editable. Every raw
 * amount must be > 0 — the factory reverts on ZeroSeedAmount.
 */
export function SeedPreview({
  constituents,
  budgetUsd,
  priceStatus,
  priceSource,
  priceAsOf,
  onBudgetChange,
  onRawChange,
  onRecomputeProportional,
}: {
  constituents: ConstituentDraft[];
  budgetUsd: string;
  priceStatus: "idle" | "loading" | "ready" | "unavailable";
  priceSource: string | null;
  priceAsOf: string | null;
  onBudgetChange: (budget: string) => void;
  onRawChange: (mint: string, raw: bigint) => void;
  onRecomputeProportional: () => void;
}) {
  const budget = Number(budgetUsd);
  const budgetUsable = Number.isFinite(budget) && budget > 0;
  const missingPrices = constituents.some(
    (c) => c.priceRef === null || c.priceRef === undefined || !Number.isFinite(c.priceRef) || c.priceRef <= 0,
  );
  const zeroSeeds = constituents.some((c) => c.seedRaw <= 0n);
  // Live consequence of the typed amounts: each row's estimated value is
  // amount × reference price; the totals update as you type.
  const rows = constituents.map((c) => {
    const units = Number(c.seedRaw) / 10 ** c.decimals;
    const hasPrice =
      c.priceRef !== null && c.priceRef !== undefined && Number.isFinite(c.priceRef) && c.priceRef > 0;
    return { c, units, hasPrice, value: hasPrice && c.seedRaw > 0n ? units * (c.priceRef as number) : null };
  });
  const allSeeded = rows.length > 0 && !zeroSeeds;
  const totalValue = allSeeded && rows.every((r) => r.value !== null)
    ? rows.reduce((acc, r) => acc + (r.value ?? 0), 0)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Deposit tokens you own when creating the basket. This is not a USDC purchase.
      </p>

      <details className="rounded-lg border border-border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">Estimate amounts from a USD target <span className="font-normal text-muted-foreground">(optional)</span></summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <TextField
            label="Target value (USD estimate)"
            value={budgetUsd}
            onChange={onBudgetChange}
            inputMode="decimal"
            mono
            className="w-40"
            placeholder="e.g. 1000"
            invalid={budgetUsd.trim() !== "" && !budgetUsable}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRecomputeProportional}
            disabled={!budgetUsable || missingPrices}
            title="Calculate token amounts from your target value and the displayed reference prices"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Calculate token amounts
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Uses reference prices; you can edit every token amount.</p>
      </details>

      {missingPrices && (
        <p className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {priceStatus === "loading"
            ? "Loading prices…"
            : "Some tokens have no price yet — their Estimated value shows “price unavailable”, so type the amount directly."}
        </p>
      )}

      <div className="grid gap-3 md:hidden">
        {rows.map(({ c: constituent, value }) => (
          <div key={constituent.mint} className="rounded-xl border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-medium">{constituent.ticker}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBpsAsPercent(constituent.weightBps)} of basket
                </p>
              </div>
              {constituent.seedRaw > 0n && (
                <p className="text-right font-mono text-sm tabular-nums">
                  {value !== null ? `≈ ${formatUsd(value)}` : "Estimate unavailable"}
                </p>
              )}
            </div>
            <div className="mt-3">
              <TextField
                label={`${constituent.ticker} amount to deposit`}
                value={formatRawAsTokenUnits(constituent.seedRaw, constituent.decimals)}
                onChange={(input) => {
                  const raw = parseTokenUnitsToRaw(input, constituent.decimals);
                  if (raw !== null) onRawChange(constituent.mint, raw);
                }}
                inputMode="decimal"
                mono
                invalid={constituent.seedRaw <= 0n}
              />
            </div>
          </div>
        ))}
        {allSeeded && (
          <div className="flex justify-between rounded-xl border border-border bg-muted/30 p-3 text-sm">
            <span>Estimated total</span>
            <span className="font-mono tabular-nums">
              {totalValue !== null ? formatUsd(totalValue) : "Price unavailable"}
            </span>
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-xs">Ticker</TableHead>
              <TableHead className="text-right text-xs">Weight</TableHead>
              <TableHead className="text-right text-xs">Approx. value</TableHead>
              <TableHead className="text-xs">Amount (tokens)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ c: constituent, value }) => {
              return (
                <TableRow key={constituent.mint}>
                  <TableCell className="font-mono text-xs font-medium">
                    {constituent.ticker}
                  </TableCell>
                  <TableCell
                    className="text-right font-mono text-xs tabular-nums"
                  >
                    {/* Percent first; the integer bps value stays in state and
                        transaction construction. */}
                    {formatBpsAsPercent(constituent.weightBps)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {constituent.seedRaw <= 0n ? (
                      "—"
                    ) : value !== null ? (
                      formatUsd(value)
                    ) : priceStatus === "loading" ? (
                      "…"
                    ) : (
                      <span className="text-muted-foreground">price unavailable</span>
                    )}
                  </TableCell>
                  <TableCell className="w-44">
                    <TextField
                      label={`Amount of ${constituent.ticker} to seed`}
                      hideLabel
                      value={formatRawAsTokenUnits(constituent.seedRaw, constituent.decimals)}
                      onChange={(input) => {
                        const raw = parseTokenUnitsToRaw(input, constituent.decimals);
                        if (raw !== null) onRawChange(constituent.mint, raw);
                      }}
                      inputMode="decimal"
                      mono
                      invalid={constituent.seedRaw <= 0n}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {allSeeded && (
              <TableRow className="hover:bg-transparent">
                <TableCell className="text-xs font-medium" colSpan={2}>
                  Total
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {totalValue !== null ? (
                    formatUsd(totalValue)
                  ) : (
                    <span className="text-muted-foreground">price unavailable</span>
                  )}
                </TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {zeroSeeds && (
        <p className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/40 p-2.5 text-xs leading-5 text-muted-foreground">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Enter an amount above zero for every token.
        </p>
      )}

      {priceSource && (
        <div className="min-w-0 text-xs text-muted-foreground">
          <FreshnessBadge
            source={priceSource}
            asOf={priceAsOf ?? undefined}
            demo
            className="flex flex-wrap overflow-visible"
          />
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Reference prices</summary>
        <ul className="mt-1 space-y-1">
          {rows.map(({ c, hasPrice }) => (
            <li key={c.mint}>{c.ticker}: {hasPrice ? `${formatUsd(c.priceRef as number)} per token` : "unavailable"}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

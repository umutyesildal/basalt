"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { bpsToPercent } from "@/lib/format";
import { parsePercentToBps } from "@/lib/percent";
import { cn } from "@/lib/utils";
import { RangeField } from "./field";
import {
  equalWeights,
  normalizeWeights,
  WEIGHTS_DENOMINATOR,
  type ConstituentDraft,
} from "./types";

/**
 * Step 2 — percent-facing weight controls backed by exact integer bps.
 * Rows adjust freely; the total must reach 100% before the next step.
 */
export function WeightsEditor({
  constituents,
  onChange,
}: {
  constituents: ConstituentDraft[];
  onChange: (constituents: ConstituentDraft[]) => void;
}) {
  const sum = constituents.reduce((acc, c) => acc + c.weightBps, 0);
  const valid = sum === WEIGHTS_DENOMINATOR;
  const diff = sum - WEIGHTS_DENOMINATOR;

  const setWeight = (index: number, next: number) => {
    const clamped = Math.max(0, Math.min(WEIGHTS_DENOMINATOR, Math.round(next)));
    onChange(
      constituents.map((c, i) => (i === index ? { ...c, weightBps: clamped } : c)),
    );
  };

  const applyPreset = (weights: number[]) => {
    onChange(constituents.map((c, i) => ({ ...c, weightBps: weights[i] })));
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset(equalWeights(constituents.length))}
        >
          Equal
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => applyPreset(normalizeWeights(constituents.map((c) => c.weightBps)))}
          title="Scale the current allocations proportionally to total 100%"
        >
          Balance to 100%
        </Button>
        <span
          aria-live="polite"
          className={cn(
            "ml-auto flex items-center gap-1.5 font-mono text-xs tabular-nums",
            valid ? "text-primary-text" : "text-destructive",
          )}
        >
          {bpsToPercent(sum).toFixed(2)}% / 100%
          {!valid && (
            <span className="font-sans">
              — {diff > 0 ? "over" : "under"} by {bpsToPercent(Math.abs(diff)).toFixed(2)}%; adjust the
              allocations or balance to 100%
            </span>
          )}
        </span>
      </div>

      <ul className="flex flex-col gap-5">
        {constituents.map((constituent, index) => (
          <li key={constituent.mint}>
            <RangeField
              label={constituent.ticker}
              value={constituent.weightBps}
              min={0}
              max={WEIGHTS_DENOMINATOR}
              step={1}
              onChange={(value) => setWeight(index, value)}
            >
              <span className="flex items-baseline gap-2">
                <WeightInput ticker={constituent.ticker} weight={constituent.weightBps} onCommit={(value) => setWeight(index, value)} />
              </span>
            </RangeField>
          </li>
        ))}
      </ul>

    </div>
  );
}

/**
 * Accessible percent input. A blur commits at most two decimal places, so
 * every visible value maps exactly to a program bps integer.
 */
function WeightInput({
  ticker,
  weight,
  onCommit,
}: {
  ticker: string;
  weight: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(bpsToPercent(weight).toFixed(2));

  useEffect(() => {
    setDraft(bpsToPercent(weight).toFixed(2));
  }, [weight]);

  return (
    <span className="flex items-baseline gap-1">
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Allocation for ${ticker} in percent`}
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          if (!/^\d{0,3}(?:\.\d{0,2})?$/.test(value)) return;
          setDraft(value);
        }}
        onBlur={() => {
          const parsed = parsePercentToBps(draft);
          if (parsed !== null) {
            onCommit(parsed);
            setDraft(bpsToPercent(parsed).toFixed(2));
          } else {
            setDraft(bpsToPercent(weight).toFixed(2));
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="h-9 w-20 rounded-lg border border-input bg-background px-2 text-right font-mono text-sm tabular-nums outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <span className="text-muted-foreground">%</span>
    </span>
  );
}

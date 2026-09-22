"use client";

import { formatBpsAsPercent } from "@/lib/format";
import { RangeField } from "./field";
import {
  ENTRY_FEE_CAP_BPS,
  EXIT_FEE_CAP_BPS,
  MANAGEMENT_FEE_CAP_BPS,
} from "@/lib/create-basket";

interface FeeSpec {
  key: "entry" | "exit" | "management";
  label: string;
  cap: number;
}

const FEE_SPECS: FeeSpec[] = [
  { key: "entry", label: "Entry fee", cap: ENTRY_FEE_CAP_BPS },
  { key: "exit", label: "Exit fee", cap: EXIT_FEE_CAP_BPS },
  { key: "management", label: "Management fee", cap: MANAGEMENT_FEE_CAP_BPS },
];

/**
 * Set up — three optional fee sliders within the factory caps (300/100/300 bps) and a
 * single protocol-wide fee-split line. Fees are charged in basket shares, never in
 * underlying, and are fixed for the life of the basket.
 */
export function FeesEditor({
  entryFeeBps,
  exitFeeBps,
  managementFeeBps,
  onChange,
}: {
  entryFeeBps: number;
  exitFeeBps: number;
  managementFeeBps: number;
  onChange: (key: FeeSpec["key"], value: number) => void;
}) {
  const values: Record<FeeSpec["key"], number> = {
    entry: entryFeeBps,
    exit: exitFeeBps,
    management: managementFeeBps,
  };
  // Locale-independent ("." decimal separator) — toLocaleString rendered
  // 1.5 as "1,5"/"1.500" depending on the browser locale.
  const pct = (bps: number) => formatBpsAsPercent(bps);
  const sharesFromHundred = (bps: number) => (bps / 100).toFixed(2).replace(/\.?0+$/, "");
  const explanation = (spec: FeeSpec): string | null => {
    const rate = values[spec.key];
    if (rate === 0) return null;
    if (spec.key === "entry") {
      return `On a 100-share mint, ${sharesFromHundred(rate)} share${rate === 100 ? " goes" : "s go"} to fees; the buyer receives ${sharesFromHundred(10_000 - rate)} shares.`;
    }
    if (spec.key === "exit") {
      return `On a 100-share redemption, ${sharesFromHundred(rate)} share${rate === 100 ? " goes" : "s go"} to fees; the rest determines the tokens returned.`;
    }
    return "New fee shares are minted over time, reducing each holder’s fraction of the basket.";
  };

  return (
    <div className="flex flex-col gap-5">
      {FEE_SPECS.map((spec) => (
        <div key={spec.key}>
          <RangeField
            label={spec.label}
            value={values[spec.key]}
            min={0}
            max={spec.cap}
            step={5}
            onChange={(value) => onChange(spec.key, value)}
          >
            <span className="font-mono tabular-nums">
              {pct(values[spec.key])}{spec.key === "management" ? "/year" : ""}{" "}
              <span className="text-muted-foreground">max {pct(spec.cap)}{spec.key === "management" ? "/year" : ""}</span>
            </span>
          </RangeField>
          {explanation(spec) && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{explanation(spec)}</p>
          )}
        </div>
      ))}

      <p className="text-xs leading-5 text-muted-foreground">
        Rates are fixed at deploy. Fee shares go 90% to you and 10% to the treasury.
      </p>
    </div>
  );
}

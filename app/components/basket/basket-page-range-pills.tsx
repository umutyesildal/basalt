"use client";

/**
 * Monochrome pill range picker for the share-price chart (1D / 7D / 30D / All).
 * Filled-active per the ui-plan Dalga-2 spec: the active pill is a solid
 * foreground fill with background text — one chrome accent, no chart hues.
 * Buttons carry `aria-pressed`; keyboard focus uses the shared ring.
 */

export interface RangePillOption<T extends string> {
  value: T;
  label: string;
}

export function RangePills<T extends string>({
  options,
  value,
  onChange,
  ariaLabel = "Chart range",
  className = "",
}: {
  options: readonly RangePillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={`flex flex-wrap items-center gap-1 ${className}`}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none ${
              active
                ? "border-transparent bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </nav>
  );
}

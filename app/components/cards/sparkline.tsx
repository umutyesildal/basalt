import { CHANGE_DOWN_CLASS, CHANGE_UP_CLASS } from "@/components/stocks/change-value";
import { cn } from "@/lib/utils";

/**
 * Stroke tone for the sparkline — the SAME semantic tokens ChangeValue uses
 * (components/stocks/change-value.tsx is the single source; imported, not
 * re-declared). Owner feedback 2026-09-14: the mini chart may not sit on the
 * chart-1 data hue anymore — direction decides the color, green ≥ 0, red < 0.
 * The SVG strokes `currentColor`, so the text-color classes drive the line.
 */
const TONE_CLASS = {
  up: CHANGE_UP_CLASS,
  down: CHANGE_DOWN_CLASS,
  muted: "text-muted-foreground/50",
} as const;

/**
 * Inline SVG sparkline — no gradient, no axes. Moved verbatim from
 * components/stocks/stock-card.tsx so the shared card kit draws the one
 * identical sparkline (reuse rule: no new chart components). Renders nothing
 * below two points — absent data renders no element, never a placeholder.
 * Default tone stays the quiet gray (non-directional callers); /stocks and
 * /etfs pass the 7d direction as `tone`.
 */
export function MiniSparkline({
  points,
  className,
  tone = "muted",
}: {
  /** Series values, oldest → newest. */
  points: number[];
  className?: string;
  /** Direction hue: "up" → status-positive green, "down" → destructive red. */
  tone?: "up" | "down" | "muted";
}) {
  if (points.length < 2) return null;
  const width = 120;
  const height = 32;
  const pad = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (width - pad * 2) / (points.length - 1);
  const path = points
    .map((value, i) => {
      const x = pad + i * step;
      const y = height - pad - ((value - min) / span) * (height - pad * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("h-8 w-full", TONE_CLASS[tone], className)}
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

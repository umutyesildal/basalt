"use client";

import { arc as arcGenerator } from "@visx/shape";
import { pie as d3Pie } from "d3-shape";
import { motion, useReducedMotion } from "motion/react";
import { useMemo } from "react";

import { formatBpsAsPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface CreatePreviewSlice {
  /** Stable key (constituent mint) used to sync hover with breakdown rows. */
  key: string;
  label: string;
  /** Weight in bps (non-zero — zero-weight constituents are filtered out). */
  value: number;
  color: string;
}

/**
 * Live composition donut for the create wizard preview (Dalga 2). Same visual
 * language as the basket About page donut (PieChart + chart-1..5 cycling):
 * thin ring, no glow, hover shows ticker + weight in the center. Geometry is
 * drawn directly from d3-shape arcs (like PieChart's geometryScrubbing mode)
 * so slider drags re-plot every frame; slice shape changes tween ~200ms
 * ease-out and render instantly under reduced motion.
 */
export function CreatePreviewDonut({
  slices,
  size = 136,
  hoveredKey,
  onHoverChange,
  className,
}: {
  slices: CreatePreviewSlice[];
  size?: number;
  /** Hovered slice key (mint), controlled so breakdown rows can drive it. */
  hoveredKey?: string | null;
  onHoverChange?: (key: string | null) => void;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();

  const total = useMemo(() => slices.reduce((sum, s) => sum + s.value, 0), [slices]);

  const arcs = useMemo(() => {
    if (total <= 0) return [];
    return d3Pie<CreatePreviewSlice>()
      .value((d) => d.value)
      .sort(null)
      .startAngle(-Math.PI / 2)
      .endAngle((3 * Math.PI) / 2)(slices);
  }, [slices, total]);

  const outerRadius = size / 2 - 2;
  const innerRadius = Math.round(outerRadius * 0.68);
  const generator = arcGenerator<(typeof arcs)[number]>({ innerRadius, outerRadius });
  const hoveredIndex = hoveredKey ? slices.findIndex((s) => s.key === hoveredKey) : -1;
  const hoveredSlice = hoveredIndex >= 0 ? slices[hoveredIndex] : null;
  const center = size / 2;
  const ringMid = (innerRadius + outerRadius) / 2;

  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg aria-hidden="true" height={size} width={size}>
        <g transform={`translate(${center}, ${center})`}>
          {arcs.length === 0 ? (
            // Honest empty state — muted ring, no fabricated composition.
            <circle
              r={ringMid}
              fill="none"
              stroke="hsl(var(--muted))"
              strokeWidth={outerRadius - innerRadius}
            />
          ) : (
            arcs.map((arcDatum, index) => {
              const d = generator(arcDatum);
              if (!d) return null;
              const dimmed = hoveredIndex >= 0 && hoveredIndex !== index;
              return (
                <motion.path
                  key={arcDatum.data.key}
                  initial={false}
                  animate={{ d, opacity: dimmed ? 0.35 : 1 }}
                  d={d}
                  fill={arcDatum.data.color}
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : {
                          d: { duration: 0.2, ease: "easeOut" },
                          opacity: { duration: 0.15, ease: "easeOut" },
                        }
                  }
                  onMouseEnter={() => onHoverChange?.(arcDatum.data.key)}
                  onMouseLeave={() => onHoverChange?.(null)}
                />
              );
            })
          )}
        </g>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        {hoveredSlice ? (
          <span className="px-3 text-center font-mono text-xs tabular-nums text-foreground">
            {hoveredSlice.label}{" "}
            <span className="text-muted-foreground">
              {formatBpsAsPercent(hoveredSlice.value)}
            </span>
          </span>
        ) : (
          <>
            <span className="font-mono text-sm tabular-nums text-foreground">{slices.length}</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              assets
            </span>
          </>
        )}
      </div>
    </div>
  );
}

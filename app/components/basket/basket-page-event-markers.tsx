"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useChartStable } from "@/components/charts/chart-context";
import { formatAsOf, formatTokenAmount, formatUsd } from "@/lib/format";
import type { BasketEventMarker, BasketEventType } from "@/components/basket/basket-page-events";

/**
 * Marker colors — data hues only (never chrome): mint = green (chart-4),
 * redeem = magenta (chart-3), fee accrual = cyan (chart-2). Exported so the
 * legend row under the chart quotes the exact same tokens.
 */
export function eventMarkerColor(type: BasketEventType): string {
  switch (type) {
    case "Minted":
      return "hsl(var(--chart-4))";
    case "Redeemed":
      return "hsl(var(--chart-3))";
    case "FeeAccrued":
      return "hsl(var(--chart-2))";
  }
}

interface PositionedMarker {
  marker: BasketEventMarker;
  x: number;
}

/**
 * On-chain event markers as an AreaChart child layer. Each indexed
 * Minted/Redeemed/FeeAccrued event renders as a small dot + tick on the time
 * axis (bottom edge of the plot), colored by type. Hovering a dot portals a
 * compact tooltip (type · date · amount) into the chart container — the same
 * portal target the Bklit ChartTooltip uses.
 *
 * Events outside the visible x-domain are skipped, not clamped — a marker
 * must sit on the time range the price series actually shows.
 */
export function BasketEventMarkers({ markers }: { markers: BasketEventMarker[] }) {
  const { xScale, innerWidth, innerHeight, margin, containerRef } = useChartStable();
  const [mounted, setMounted] = useState(false);
  const [hovered, setHovered] = useState<PositionedMarker | null>(null);

  useEffect(() => setMounted(true), []);

  // Edge clamp for the portal tooltip: measure the rendered box, then keep its
  // center within the chart container (never off the left/right edge). The
  // layout effect corrects before paint, so there is no visible jump.
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [clampedLeft, setClampedLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!hovered) {
      setClampedLeft(null);
      return;
    }
    const el = tooltipRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const half = el.offsetWidth / 2;
    const pad = 6;
    const min = half + pad;
    const max = Math.max(container.clientWidth - half - pad, min);
    const center = margin.left + hovered.x;
    setClampedLeft(Math.min(Math.max(center, min), max));
  }, [hovered, margin.left, containerRef]);

  const points = useMemo<PositionedMarker[]>(
    () =>
      markers
        .map((marker) => {
          const t = new Date(marker.ts);
          if (Number.isNaN(t.getTime())) return null;
          const x = xScale(t);
          if (x === null || !Number.isFinite(x) || x < 0 || x > innerWidth) return null;
          return { marker, x };
        })
        .filter((p): p is PositionedMarker => p !== null),
    [markers, xScale, innerWidth],
  );

  if (points.length === 0) return null;

  const dotY = innerHeight - 18;

  return (
    <>
      <g data-slot="basket-event-markers">
        {points.map(({ marker, x }) => {
          const color = eventMarkerColor(marker.type);
          const isHovered = hovered?.marker === marker;
          return (
            <g
              key={`${marker.sig}-${marker.ts}`}
              onMouseEnter={() => setHovered({ marker, x })}
              onMouseLeave={() =>
                setHovered((current) => (current?.marker === marker ? null : current))
              }
              style={{ cursor: "default" }}
            >
              {/* faint tick pinning the event to the time axis — opacity is the
                  only hover feedback on the mark itself; the tooltip carries
                  the rest (no scale/grow on hover). */}
              <line
                x1={x}
                x2={x}
                y1={dotY + 6}
                y2={innerHeight}
                stroke={color}
                strokeWidth={1}
                opacity={isHovered ? 0.6 : 0.28}
              />
              <circle
                cx={x}
                cy={dotY}
                r={3}
                fill={color}
                stroke="hsl(var(--chart-background))"
                strokeWidth={1.5}
              />
            </g>
          );
        })}
      </g>

      {/* Tooltip portal — same container the Bklit tooltip uses, so it floats
          above the SVG without foreignObject quirks. Left is clamped to the
          container after measurement (see the layout effect above). */}
      {mounted && containerRef.current && hovered ? (
        createPortal(
          <div
            role="status"
            ref={tooltipRef}
            className="pointer-events-none absolute z-40 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-sm"
            style={{
              left: clampedLeft ?? margin.left + hovered.x,
              top: margin.top + 4,
            }}
          >
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <span
                aria-hidden="true"
                className="inline-block size-1.5 rounded-full"
                style={{ backgroundColor: eventMarkerColor(hovered.marker.type) }}
              />
              {hovered.marker.type}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-foreground">
              {hovered.marker.shares !== null
                ? `${formatTokenAmount(hovered.marker.shares, { maximumFractionDigits: 2 })} shares`
                : "—"}
              {hovered.marker.usdValue !== null
                ? ` · ${formatUsd(hovered.marker.usdValue)} est.`
                : ""}
            </p>
            <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {formatAsOf(hovered.marker.ts)}
            </p>
          </div>,
          containerRef.current,
        )
      ) : null}
    </>
  );
}

export default BasketEventMarkers;

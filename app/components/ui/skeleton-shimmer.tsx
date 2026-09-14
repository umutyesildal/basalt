import { cn } from "@/lib/utils";

import { SHIMMER } from "./motion";

/**
 * SkeletonShimmer — single shimmering skeleton bar (complements the pulse
 * variants in components/states/skeleton.tsx, which stay untouched).
 *
 * Shape-matching loading placeholder: pass width/height (any CSS value) so
 * loading content occupies the same space as loaded content — no layout
 * shift, no fake data. The sweep highlight is token-derived
 * (foreground/5%, see motion.css); the base surface is bg-muted.
 *
 * prefers-reduced-motion: the animation is disabled by motion.css and the
 * bar rests as a static muted surface.
 *
 * Rounds via the token radius scale (--radius 0.25rem → sm 0 / md 2 / lg 4).
 */

type SkeletonShimmerRounded = "none" | "sm" | "md" | "lg";

const ROUNDED: Record<SkeletonShimmerRounded, string> = {
  none: "",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
};

function toCssLength(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

export function SkeletonShimmer({
  width = "100%",
  height = "1rem",
  rounded = "sm",
  /** Accessible loading label; renders a role="status" wrapper with sr-only text. */
  label,
  className,
}: {
  /** Any CSS width: number = px, string = verbatim ("100%", "12rem", …). */
  width?: string | number;
  /** Any CSS height: number = px, string = verbatim. */
  height?: string | number;
  rounded?: SkeletonShimmerRounded;
  label?: string;
  className?: string;
}) {
  return (
    <div
      // With a label the bar itself announces loading (role="status");
      // without one it is a decorative aria-hidden bar — the caller owns
      // the status wrapper (house pattern in components/states/skeleton.tsx).
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ width: toCssLength(width), height: toCssLength(height) }}
      className={cn("bg-muted", ROUNDED[rounded], SHIMMER, className)}
    />
  );
}

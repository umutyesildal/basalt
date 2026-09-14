/*
 * Motion helpers — class-string constants for the house motion rules
 * (ui-plan §0.4): 150–250ms ease-out transitions, staggered fade-up entrances,
 * no confetti/neon/glow.
 *
 * This module side-effect imports `motion.css`, which owns the keyframes
 * (tailwind.config.js is off-limits for parallel-agent ownership), so importing
 * anything from here ships the styles. Pairs with `transition-<property>`
 * utilities — `transition-all` is banned by brand.md.
 *
 * Durations: fast 150ms (hover/color), base 200ms (default), slow 250ms
 * (layout-ish shifts). Ambient loops (shimmer) run longer and are exempt.
 */

import "./motion.css";

/** Duration steps in ms (for inline styles and documentation). */
export const DURATION = { fast: 150, base: 200, slow: 250 } as const;

/** House easing — always ease-out for entrances/hover, never bounce. */
export const EASING = "ease-out" as const;

/**
 * Duration + easing fragments. Pair with a specific property utility, e.g.
 * `cn("transition-colors", TRANSITION_FAST)` — never `transition-all`.
 */
export const TRANSITION_FAST = "duration-150 ease-out";
export const TRANSITION_BASE = "duration-200 ease-out";
export const TRANSITION_SLOW = "duration-250 ease-out";

/** Fade-up entrance class (one-shot, 220ms ease-out, translateY 8px). */
export const FADE_UP = "basalt-fade-up";

/** Stagger step classes, 60ms apart (index 0–5). */
export const FADE_UP_DELAYS = [
  "basalt-fade-up-0",
  "basalt-fade-up-1",
  "basalt-fade-up-2",
  "basalt-fade-up-3",
  "basalt-fade-up-4",
  "basalt-fade-up-5",
] as const;

/**
 * Full fade-up class for the i-th staggered child (clamped at 5 — deeper
 * steps read as lag, and later children can share the last step).
 */
export function fadeUpStagger(index: number): string {
  const clamped = Math.max(0, Math.min(FADE_UP_DELAYS.length - 1, index));
  return `${FADE_UP} ${FADE_UP_DELAYS[clamped]}`;
}

/** Shimmer highlight class — used by SkeletonShimmer, exported for reuse. */
export const SHIMMER = "basalt-shimmer";

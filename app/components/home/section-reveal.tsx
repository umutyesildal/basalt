"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * SectionReveal — one-shot staggered fade-up when a home section first
 * scrolls into view (wave-2 polish, 2026-09-14): 200ms ease-out, ≤8px
 * travel, optional small `delay` (ms) to stagger siblings.
 *
 * OWNER FIX (2026-09-14, "anasayfada gözükmeyen bi kısım"): the previous
 * implementation listed `phase` in the effect deps. Arming the animation
 * (idle → hidden) re-rendered, the re-render ran the effect cleanup, the
 * cleanup disconnected the just-created IntersectionObserver, and the
 * `hidden` early-return never re-armed one — so every section that
 * hydrated below the first viewport was stuck at opacity-0 forever (the
 * SSR HTML was fine; the content vanished right after hydration). Fixed
 * guarantees, in order of importance:
 *
 * - Content is VISIBLE by default: the server render, no-JS, and every
 *   failure path leave the section on screen. The hidden state is applied
 *   only AFTER hydration, only when the element sits below the first
 *   viewport, only when IntersectionObserver exists, and never without an
 *   armed observer whose callback reveals it again. There is no path to
 *   permanent invisibility.
 * - The effect runs once on mount; the observer lives until first reveal
 *   or unmount — reveal state no longer drives the effect deps.
 * - Sections already in the viewport at load (the hero zone) never
 *   animate: no added hero motion (owner rule).
 * - prefers-reduced-motion: the element stays static and visible.
 * - Specific transition properties only — `transition-all` stays banned.
 */
export function SectionReveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** Stagger offset in ms — keep steps small (e.g. 60 per sibling). */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No IntersectionObserver → never hide: content must simply be there.
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already in the first viewport at load → stay visible, animate nothing.
    if (el.getBoundingClientRect().top < window.innerHeight) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setHidden(false);
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    setHidden(true);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The transition classes live on the element permanently (so the
  // hidden → shown change is the animated one); `hidden` alone toggles
  // the from-state. Idle (SSR / no-JS / in-viewport) renders fully
  // visible with nothing to animate.
  return (
    <div
      ref={ref}
      className={cn(
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        hidden && "translate-y-2 opacity-0",
        className,
      )}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}

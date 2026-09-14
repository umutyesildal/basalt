"use client";

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Fade-up wrapper for tab-panel content: remounts on `activeKey`, so each
 * section switch plays one 180ms ease-out rise (ui-plan §0 rule 4 — measured
 * motion, no confetti). `prefers-reduced-motion` renders the content
 * immediately with no transform and no duration.
 */
export function FadeUpOnKey({
  activeKey,
  className,
  children,
}: {
  /** Changing this key replays the entrance (e.g. the active section tab). */
  activeKey: string;
  className?: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      key={activeKey}
      className={className}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.18, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

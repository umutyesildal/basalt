"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { consumeCreatedPreview } from "@/components/create/create-feedback";
import styles from "./creation-celebration.module.css";

/** Small deterministic burst, limited to the completed creation action in this tab. */
const PIECES = Array.from({ length: 18 }, (_, index) => ({
  left: `${8 + index * 4.9}%`,
  "--drift": `${(index % 2 === 0 ? 1 : -1) * (20 + (index % 5) * 11)}px`,
  "--turn": `${(index % 2 === 0 ? 1 : -1) * (100 + index * 23)}deg`,
  "--delay": `${(index % 4) * 40}ms`,
})) as CSSProperties[];

export function CreationCelebration({ created, previewHref }: { created: boolean; previewHref: string }) {
  const [visible, setVisible] = useState(false);
  const [confetti, setConfetti] = useState(false);

  useEffect(() => {
    if (!created) return;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Private browsing may disable storage. */ }
    if (consumeCreatedPreview(previewHref, storage)) {
      setVisible(true);
      setConfetti(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("created")) {
      url.searchParams.delete("created");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [created, previewHref]);

  useEffect(() => {
    if (!confetti) return;
    const timeout = window.setTimeout(() => setConfetti(false), 2_100);
    return () => window.clearTimeout(timeout);
  }, [confetti]);

  if (!visible) return null;
  return <>
    <div role="status" className="flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-4 sm:px-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check size={18} aria-hidden="true" /></span>
      <h2 className="font-display text-lg font-medium leading-snug sm:text-xl">Your stock basket is ready to share</h2>
    </div>
    {confetti && <div className={styles.confetti} aria-hidden="true">{PIECES.map((style, index) => <i key={index} className={styles.piece} style={style} />)}</div>}
  </>;
}

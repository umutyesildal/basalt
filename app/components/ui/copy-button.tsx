"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Copy affordances for addresses/mints — the single source of the
 * copy-button family (wave-4 merge: `ui/copy-button`, `components/copy-button`
 * and `app/stock/[ticker]/MintCopyButton` all repeated the same clipboard
 * call and 1.6s confirm timer; only the chrome differed).
 *
 * Two visual variants share one implementation:
 *  - CopyButton      bordered mono text chip, "copy" → "copied" text swap.
 *  - IconCopyButton  borderless icon → check swap; optional visible "Copied"
 *                    text (showCopiedText) or a fixed square icon-only target
 *                    (iconOnly — ex MintCopyButton).
 *
 * Touch scale: h-6 max-md:h-10 (iconOnly: size-8 max-md:size-10) — desktop
 * rhythm preserved, below 768px every variant reaches the 40px house minimum
 * (audit wave-3 §2.d). Monochrome chrome only: icons inherit
 * text-muted-foreground / foreground on hover; success uses the same muted
 * treatment (never a data hue — copy feedback is chrome, and red stays
 * errors-only). When the Clipboard API is unavailable (http origins, older
 * browsers) the button still acknowledges the press instead of throwing —
 * the address text beside it stays selectable either way.
 */

const COPY_FEEDBACK_MS = 1600;

/** Shared clipboard write + timed confirm (1.6s), timer-safe on unmount. */
function useCopyConfirmation(value: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS,
      );
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(done).catch(done);
    } else {
      done();
    }
  }, [value]);

  return { copied, copy };
}

function CopyGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * Bordered mono text chip (the original ui/copy-button): announces the copy
 * via a temporary "copied" mono label (no toast chrome).
 */
export function CopyButton({
  value,
  label = "Copy to clipboard",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const { copied, copy } = useCopyConfirmation(value);

  return (
    <button
      type="button"
      onClick={copy}
      title={label}
      aria-label={`${label}: ${value}`}
      className={cn(
        "inline-flex h-6 max-md:h-10 items-center gap-1 rounded-lg border border-border bg-background px-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}

/**
 * Icon variant (ex components/copy-button + MintCopyButton): the icon swaps
 * to a check while the copied state is active. `showCopiedText` renders the
 * copied label inline (default); `iconOnly` keeps a fixed square target with
 * no layout shift and no visible text (ex MintCopyButton).
 */
export function IconCopyButton({
  value,
  label = "Copy address",
  copiedLabel = "Copied",
  showCopiedText = true,
  iconOnly = false,
  className,
}: {
  /** The exact string written to the clipboard (full address, never truncated). */
  value: string;
  /** Accessible name + tooltip of the idle button. */
  label?: string;
  /** Text shown while the copied state is active. */
  copiedLabel?: string;
  /** Set false to render icon-only feedback (check swap only). */
  showCopiedText?: boolean;
  /** Fixed square hit target — no layout shift, never shows visible text. */
  iconOnly?: boolean;
  className?: string;
}) {
  const { copied, copy } = useCopyConfirmation(value);

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? copiedLabel : label}
      aria-label={copied ? copiedLabel : label}
      className={cn(
        "inline-flex h-6 max-md:h-10 items-center justify-center gap-1 rounded-lg font-mono text-[10px] tabular-nums text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        iconOnly
          ? // Square target (ex MintCopyButton); tailwind-merge lets the
            // size tokens below replace the h-6/max-md:h-10 above.
            "size-8 max-md:size-10"
          : "px-1",
        className,
      )}
    >
      {copied ? (
        <>
          <span className={showCopiedText && !iconOnly ? "" : "sr-only"}>
            {copiedLabel}
          </span>
          <CheckGlyph />
        </>
      ) : (
        <>
          <span className="sr-only">{label}</span>
          <CopyGlyph />
        </>
      )}
    </button>
  );
}

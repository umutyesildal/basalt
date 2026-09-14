"use client";

/**
 * Half / Max quick-fill pair for a raw-amount input (the Cesto invest-panel
 * pattern, monochrome application). HONESTY RULE: the buttons enable only when
 * a wallet balance was actually read from a token account — otherwise they
 * render disabled with a title explaining exactly why. Nothing is ever guessed:
 * no balance, no fill.
 */

export type HalfMaxKind = "half" | "max";

/** floor(balance / 2) in raw base units — BigInt-exact, no float drift. */
export function halfOfRaw(balance: bigint): bigint {
  return balance / 2n;
}

/**
 * Disabled reason for the pair, or null when fills are possible. Exported so
 * pages can surface the same explanation next to the balance line.
 */
export function halfMaxDisabledReason(
  connected: boolean,
  balance: bigint | null,
  balanceLabel: string,
  loading = false,
): string | null {
  if (!connected) return "Connect a wallet to use Half / Max";
  if (balance === null) {
    return loading
      ? `Reading the wallet ${balanceLabel} — Half / Max enables once it loads.`
      : `${balanceLabel} could not be read — the token account may not exist yet. Enter an amount manually.`;
  }
  if (balance <= 0n) return `No ${balanceLabel} to draw from.`;
  return null;
}

export function HalfMaxButtons({
  connected,
  balance,
  balanceLabel,
  loading = false,
  onPick,
  className = "",
}: {
  connected: boolean;
  /** Raw base-unit wallet balance, or null when unreadable. */
  balance: bigint | null;
  /** Human label for the disabled titles, e.g. "share balance", "USDC balance". */
  balanceLabel: string;
  /** True while the balance read is still in flight (distinct honest title). */
  loading?: boolean;
  onPick: (kind: HalfMaxKind) => void;
  className?: string;
}) {
  const reason = halfMaxDisabledReason(connected, balance, balanceLabel, loading);
  const enabled = reason === null;
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      role="group"
      aria-label="Half or maximum amount"
    >
      {(["half", "max"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={!enabled}
          title={reason ?? undefined}
          onClick={() => onPick(kind)}
          className="max-md:min-h-10 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none"
        >
          {kind}
        </button>
      ))}
    </span>
  );
}

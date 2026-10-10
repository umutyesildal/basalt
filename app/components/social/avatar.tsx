"use client";

import { useState } from "react";
import { UserRound } from "lucide-react";
import { avatarArt } from "@/lib/avatar-art";

import { cn } from "@/lib/utils";
import { truncateAddress } from "@/lib/format";

/** Actual profile pictures take priority; local line portraits cover missing/broken images. */
function AvatarPicture({ primary, fallback }: { primary?: string | null; fallback: string }) {
  const [source, setSource] = useState<string | null>(primary || fallback);
  return source ? <img src={source} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => setSource(source === fallback ? null : fallback)} /> : <UserRound className="size-1/2" />;
}

export function SocialAvatar({
  wallet,
  handle,
  displayName,
  avatarUrl,
  size = "sm",
  className,
}: {
  wallet: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  /** sm = feed rows (7), md = profile header (14, tailwind size units). */
  size?: "sm" | "md";
  className?: string;
}) {
  const fallback = avatarArt(wallet);
  const dim = size === "md" ? "h-14 w-14" : "h-7 w-7";
  return (
    <span aria-hidden="true" className={cn("inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted text-foreground", dim, className)}>
      <AvatarPicture key={`${avatarUrl || ""}:${fallback}`} primary={avatarUrl} fallback={fallback} />
    </span>
  );
}

/**
 * "actor line" — avatar + name/handle-or-truncated-wallet, used on cards.
 *
 * `friendlyFallback` softens the anonymous case for marketing surfaces: when
 * the actor has neither a displayName nor a handle, the label reads "a trader"
 * instead of a truncated wallet pubkey. Honest, not fabricated — the wallet
 * address stays on the label's `title` attribute either way (hover reveals
 * it), and avatars still key off the wallet. Default false: every existing
 * caller keeps the truncated-pubkey terminal label unchanged.
 */
export function ActorLine({
  wallet,
  handle,
  displayName,
  avatarUrl,
  className,
  emphasis = false,
  friendlyFallback = false,
}: {
  wallet: string;
  handle?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  className?: string;
  /** Feed mode: regular-case, bolder label so the chosen username is what
   *  reads — default keeps the quiet terminal whisper for other surfaces. */
  emphasis?: boolean;
  /** When true AND there is no displayName and no handle, render the friendly
   *  text "a trader" instead of the truncated wallet address. Styling classes
   *  are unchanged — only the fallback text swaps. */
  friendlyFallback?: boolean;
}) {
  const anonymous = !displayName?.trim() && !handle;
  const label =
    friendlyFallback && anonymous
      ? "a trader"
      : displayName?.trim() || (handle ? `@${handle}` : truncateAddress(wallet, 4, 4));
  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      <SocialAvatar
        wallet={wallet}
        handle={handle}
        displayName={displayName}
        avatarUrl={avatarUrl}
      />
      <span
        className={cn(
          "truncate",
          emphasis
            ? "text-sm font-medium normal-case tracking-normal text-foreground"
            : "font-mono text-xs uppercase tracking-widest text-foreground",
        )}
        title={wallet}
      >
        {label}
      </span>
    </span>
  );
}

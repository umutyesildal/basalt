"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/format";

/**
 * Basket-page breadcrumb + share row (spec §9 detail header, Cesto-style
 * hierarchy): `Explore / <Basket Name>` on the left, Copy Link / Share on X
 * on the right. Monochrome chrome only — ghost buttons, muted icon treatment,
 * the single "Copied" acknowledgement — never a data hue.
 *
 * Client-side only, honestly degraded:
 *  - the page URL is read from `window.location` after mount (no SSR guess),
 *  - Copy Link falls back to acknowledging the press when the Clipboard API
 *    is unavailable (http origins, older browsers),
 *  - the X intent opens in a new tab with `noopener` and no return promises
 *    in the prefilled text — baskets are strategy baskets, always.
 * Before the basket resolves the crumb falls back to the truncated pubkey;
 * nothing is fabricated while loading.
 */
export function BasketPageBreadcrumb({ pubkey, name }: { pubkey: string; name: string | null }) {
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setPageUrl(window.location.href);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  const copyLink = useCallback(() => {
    const done = () => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(false), 1600);
    };
    if (pageUrl && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(pageUrl).then(done).catch(done);
    } else {
      done();
    }
  }, [pageUrl]);

  const shareOnX = useCallback(() => {
    if (!pageUrl) return;
    const text = name
      ? `${name} — strategy basket on Solana`
      : "Strategy basket on Solana";
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;
    window.open(intent, "_blank", "noopener,noreferrer");
  }, [name, pageUrl]);

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground"
    >
      <div className="min-w-0">
        <Link href="/explore" className="underline underline-offset-4 hover:text-foreground">
          Explore
        </Link>
        <span aria-hidden="true"> / </span>
        {name ? (
          <span className="text-foreground">{name}</span>
        ) : (
          <span className="font-mono tabular-nums">{truncateAddress(pubkey, 6, 6)}</span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={copyLink} disabled={!pageUrl}>
          {copied ? "Copied" : "Copy Link"}
        </Button>
        <Button variant="ghost" size="xs" onClick={shareOnX} disabled={!pageUrl}>
          <svg
            data-icon="inline-start"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Share
        </Button>
      </div>
    </nav>
  );
}

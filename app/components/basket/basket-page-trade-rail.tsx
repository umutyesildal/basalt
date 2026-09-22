"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AccrueCrankButton } from "@/components/basket/accrue-crank";
import { Button } from "@/components/ui/button";
import type { BasketDetail } from "@/components/basket/basket-api";

/**
 * Sticky trade rail for the basket detail page — buy/redeem stay reachable
 * from every tab (forms remain on their own routes). Cila: the rail opens with
 * a TRADE eyebrow, the two shortcut buttons read as the primary CTAs, and the
 * route the user is currently on is highlighted (`aria-current="page"` plus a
 * filled secondary treatment) so the rail doubles as a location cue when
 * browsing /buy or /redeem. "Buy shares" keeps the one primary-CTA slot on the
 * detail surface; when the buy form itself is open, that slot belongs to the
 * form below, so the rail button drops to the filled-secondary treatment.
 */
export function BasketPageTradeRail({
  detail,
  secondsSinceAccrual,
  onWriteThesis,
}: {
  detail: BasketDetail;
  secondsSinceAccrual: number | null;
  onWriteThesis: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const buyHref = `/basket/${detail.pubkey}/buy`;
  const redeemHref = `/basket/${detail.pubkey}/redeem`;
  const buyActive = pathname === buyHref;
  const redeemActive = pathname === redeemHref;

  return (
    <aside
      aria-label="Trade this basket"
      className="order-first shrink-0 lg:order-last lg:sticky lg:top-20 lg:self-start"
    >
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 pb-2.5 pt-4">
          <p className="section-label">Trade</p>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <Button
            render={<Link href={buyHref} />}
            className="hidden lg:inline-flex"
            variant={buyActive ? "secondary" : "default"}
            aria-current={buyActive ? "page" : undefined}
            title="Open the mint form — deposit the underlying xStocks in-kind or zap in with USDC"
          >
            Buy shares
          </Button>
          <Button
            render={<Link href={redeemHref} />}
            className="hidden lg:inline-flex"
            variant={redeemActive ? "secondary" : "outline"}
            aria-current={redeemActive ? "page" : undefined}
            title="Open the redeem form — burn shares, receive every underlying pro-rata"
          >
            Redeem shares
          </Button>
          <Button variant="outline" onClick={onWriteThesis}>
            Write thesis
          </Button>
          {/* Clone stays outline: "Buy shares" owns the one primary CTA slot
              on this surface (NEON FOUNDRY review, 2026-09-12). */}
          <Button
            variant="outline"
            onClick={() => router.push(`/create?clone=${encodeURIComponent(detail.pubkey)}`)}
            title="Start the create wizard pre-filled with this basket's constituents, weights and fees"
          >
            Clone this basket
          </Button>
          <details className="border-t border-border pt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium">Protocol details · oracle-free redemption</summary>
            <p className="mt-2 leading-5">Redemption is permissionless and oracle-free; it does not depend on price data, an active whitelist, or the backend.</p>
            <AccrueCrankButton
              basket={detail.pubkey}
              factory={detail.factory}
              creator={detail.creator}
              treasury={detail.treasury}
              shareMint={detail.share_mint}
              constituents={detail.constituents}
              secondsSinceAccrual={secondsSinceAccrual}
              variant="ghost"
            />
          </details>
        </div>
      </div>
    </aside>
  );
}

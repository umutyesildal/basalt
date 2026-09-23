"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, Plus, Rss, Trophy } from "lucide-react";

import { isRouteActive } from "@/components/shell/nav-items";
import { cn } from "@/lib/utils";

/**
 * Floating bottom pill nav (wave-3, 2026-09-14) — the mobile adaptation of
 * the Cesto floating-pill pattern under the locked monochrome system: one
 * blurred, hairline-bordered surface (the same surface language as the
 * scrolled header), no shadow, exactly one accent slot. Phone-only (<md,
 * wave-4): in the md–lg band the header nav is again the sole primary
 * control, which removes the two-navs overlap reported to the owner.
 */
const MOBILE_NAV_ITEMS = [
  { href: "/explore", label: "Baskets", Icon: Compass },
  { href: "/feed", label: "Feed", Icon: Rss },
  { href: "/leaderboard", label: "Ideas", Icon: Trophy },
] as const;

/**
 * Shared cell anatomy: icon over a 10px mono micro-label (brand rule —
 * uppercase micro-labels are mono), inside a ≥44px tap target. Color-only
 * active state, 150ms — no transforms, so it is reduced-motion safe by
 * construction and never shifts layout.
 */
const itemBase =
  "flex h-12 min-w-[64px] flex-col items-center justify-center gap-1 rounded-full px-3 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
const labelBase = "font-mono text-[10px] uppercase tracking-wide leading-none";

export function MobileNav() {
  const pathname = usePathname();

  return (
    // pointer-events-none wrapper + auto pill: page edges stay clickable
    // outside the pill; px-4 keeps it clear of the screen edge, and
    // safe-area padding lifts it above the iOS home indicator.
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-0 z-10 flex justify-center px-4",
        // reversible: lg:hidden yapılırsa tablet bandında pill geri gelir
        // (wave-4: md–lg çakışması için lg → md; header nav md+ tek kontrol).
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden",
      )}
    >
      <nav
        aria-label="Primary (mobile)"
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-background/90 p-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/75 dark:border-border/40"
      >
        {MOBILE_NAV_ITEMS.map(({ href, label, Icon }) => {
          // Exact-or-strict-prefix check only: /basket/<id> must NOT light up
          // Explore (isRouteActive in shell/nav-items.ts).
          const active = isRouteActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemBase,
                // Monochrome active state — a quiet muted wash, no yellow:
                // the pill carries exactly one accent, reserved for Create.
                active
                  ? "bg-muted/60 text-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
              <span className={labelBase}>{label}</span>
            </Link>
          );
        })}

        {/* Create: the single yellow accent slot — the mobile translation of
            the header's desktop primary Create button (yellow fill +
            near-black icon, AA-checked pair). Icon-only inside the fill;
            the mono label below keeps parity with the other cells. */}
        <Link
          href="/create"
          aria-current={isRouteActive(pathname, "/create") ? "page" : undefined}
          className={cn(itemBase, "min-w-[68px]")}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
          </span>
          <span className={cn(labelBase, "text-primary-text")}>Create</span>
        </Link>
      </nav>
    </div>
  );
}

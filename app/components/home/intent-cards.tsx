import Link from "next/link";

import { SectionReveal } from "@/components/home/section-reveal";
import { SectionHeader } from "@/components/ui/section-header";
import { CLUSTER } from "@/lib/wallet";

const DEVNET_PREVIEW = CLUSTER === "devnet" || CLUSTER === "localnet";
const DEMO = process.env.NEXT_PUBLIC_HOME_DEMO === "1";

/**
 * Intent cards — replace the deleted asset-class gateway with a
 * route-by-intent row (route-by-intent research; Jupiter verb taxonomy:
 * browse / follow / read / build). Four full-surface links, social
 * surfaces (leaderboard, feed) surfaced beside research and create so
 * every way in is one click from the home page. Owner feedback 2026-09-12.
 *
 * Wave-2 polish (2026-09-14): each card is a quiet face — hairline border,
 * faint card wash — that lifts ~2px on hover while its ↗ drifts one notch
 * diagonally (150–200ms, transform-only, reduced-motion honored). Cards
 * stagger in with the page's SectionReveal.
 */

const CARDS = [
  {
    label: "Browse baskets",
    line: "Weighted, on-chain, live",
    devnetLine: DEMO ? "Devnet preview · sample baskets" : "Devnet · project mock tokens",
    href: "/explore",
  },
  {
    label: "Follow top traders",
    line: "Estimated ROI, real wallets",
    devnetLine: DEMO ? "Sample profiles · demo performance" : "Devnet profiles · test activity",
    href: "/leaderboard",
  },
  {
    label: "Open the feed",
    line: "Every trade, verified on-chain",
    devnetLine: DEMO ? "Sample activity · not live trades" : "Devnet events · public ledger",
    href: "/feed",
  },
  {
    label: "Build your own",
    line: "Pick the stocks, set the weights",
    devnetLine: "Choose mock tokens, set weights",
    href: "/create",
  },
] as const;

export function IntentCards() {
  return (
    <section
      aria-label="Start where you like"
      className="border-t border-border pt-16 dark:border-border/60"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Section header — tracked mono eyebrow + the one line. */}
        <SectionHeader
          size="eyebrow"
          index={3}
          label="START WHERE YOU LIKE"
          lead="Four ways in — all of them non-custodial."
        />

        <div className="mt-12 grid grid-cols-1 gap-3 sm:grid-cols-4">
          {CARDS.map((card, index) => (
            <SectionReveal key={card.href} delay={index * 60} className="h-full">
              <Link
                href={card.href}
                className="group flex h-full items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/40 px-4 py-5 transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:shadow-none sm:flex-col sm:items-start sm:justify-start sm:gap-5"
              >
                <span className="section-label">{card.label}</span>
                <span className="text-sm leading-5 text-foreground">
                  {DEVNET_PREVIEW ? card.devnetLine : card.line}
                </span>
                <span
                  aria-hidden="true"
                  className="font-mono text-sm text-muted-foreground transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary-text motion-reduce:transform-none motion-reduce:transition-none"
                >
                  ↗
                </span>
              </Link>
            </SectionReveal>
          ))}
        </div>
        <div className="pb-8" />
      </div>
    </section>
  );
}

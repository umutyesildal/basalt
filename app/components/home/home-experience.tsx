import Link from "next/link";
import { ArrowDown, ArrowUpRight } from "lucide-react";

import { BasketStoryCard } from "@/components/basket/basket-story-card";
import { ModelPerformanceNote } from "@/components/basket/basket-performance";
import { FEATURED_BASKETS } from "@/lib/concept-samples";
import { CreatorRewardVisual } from "@/components/home/creator-reward-visual";

export function HomeExperience() {
  return (
    <div data-home-experience className="home-experience">
      <section id="overview" className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">Stock baskets, made by people</p>
        <h1 id="home-title" className="font-display">Find a stock basket<br /><span>you believe in.</span></h1>
        <p className="home-hero-description">Stock baskets built around a point of view.<br />Find one you like, or share your own.</p>
        <div className="home-hero-actions"><Link href="#discover" className="home-primary-action">Explore baskets<ArrowDown className="size-4" aria-hidden="true" /></Link><Link href="/create" className="home-text-action">Create a basket<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
        <p className="home-status">Basket sharing is open. Investing is in development.</p>
      </section>

      <section id="discover" className="home-discovery" aria-labelledby="discovery-title">
        <div className="home-section-heading"><div><h2 id="discovery-title" className="font-display">Different takes.</h2></div><Link href="/explore" className="home-text-action">All baskets<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
        <div className="home-basket-gallery">{FEATURED_BASKETS.map((basket) => <BasketStoryCard key={basket.id} basket={basket} />)}</div>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3"><ModelPerformanceNote /><Link href="/leaderboard" className="home-text-action">This week’s top 10<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
      </section>

      <section id="build" className="home-maker" aria-labelledby="belief-title">
        <div className="home-maker-copy">
          <h2 id="belief-title" className="font-display">Good stock picks<br />can come from<br /><span>anyone.</span></h2>
          <p>Share your strategy in a stock basket. When investing opens, earn management fees as people back it.</p>
          <Link href="/create" className="home-primary-action">Build your stock basket<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </div>
        <CreatorRewardVisual />
      </section>

      <section id="how-it-works" className="home-finer-details" aria-label="About xStocks and fees">
        <p className="home-xstocks-note">Built for xStocks, tokenized stocks and ETFs on Solana.</p>
        <div className="home-details">
          <details><summary>Why xStocks?<span aria-hidden="true">+</span></summary><p>xStocks bring stocks and ETFs onchain, so a basket can hold them together in one token. They are issued instruments, not direct company shares. <a href="https://docs.xstocks.fi/docs/frequently-asked-questions" target="_blank" rel="noreferrer">Learn about xStocks <ArrowUpRight aria-hidden="true" className="inline size-3" /></a></p></details>
          <details id="fees"><summary>How will fees work?<span aria-hidden="true">+</span></summary><p>Choose an annual rate up to 3% when investing launches. This fee accrues on the basket’s value over time, whether prices rise or fall. You receive 90% of the fee shares and Basalt receives 10%. Fees are paid in newly issued basket shares, diluting existing holders.</p></details>
        </div>
      </section>

      <footer className="home-footer"><Link href="#overview" className="font-display">Basalt</Link><span>Stock ideas, shared.</span><Link href="/legal">Disclosures</Link></footer>
    </div>
  );
}

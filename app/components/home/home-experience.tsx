import Link from "next/link";
import { ArrowDown, ArrowUpRight, Compass, Eye, Layers3, Link2, Percent, SlidersHorizontal } from "lucide-react";

import { BasketStoryCard } from "@/components/basket/basket-story-card";
import { FEATURED_BASKETS } from "@/lib/concept-samples";
import { CreatorRewardVisual } from "@/components/home/creator-reward-visual";
import { RoleJourneys } from "@/components/home/role-journeys";
import { Card } from "@/components/ui/card";

const BENEFITS = [
  { icon: Compass, title: "Find your view", description: "Explore stock baskets built around an idea you believe in." },
  { icon: Eye, title: "See every pick", description: "The stocks, weights and thesis, all in one place." },
  { icon: SlidersHorizontal, title: "Make your own mix", description: "Choose your stocks. Set the mix your way." },
  { icon: Link2, title: "Share your thinking", description: "One link to the basket and the idea behind it." },
  { icon: Percent, title: "Earn management fees", description: "Set your rate for when investors can back your basket." },
  { icon: Layers3, title: "Built for xStocks", description: "Tokenized stocks and ETFs, brought together on Solana." },
];

export function HomeExperience() {
  return (
    <div data-home-experience className="home-experience">
      <section id="overview" className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">Stock baskets, made by people</p>
        <h1 id="home-title" className="font-display">Find a stock basket<br /><span>you believe in.</span></h1>
        <p className="home-hero-description">Or create one that fits your needs.</p>
        <div className="home-hero-actions"><Link href="#discover" className="home-primary-action">Explore baskets<ArrowDown className="size-4" aria-hidden="true" /></Link><Link href="/create" className="home-text-action">Create a basket<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
      </section>

      <section id="discover" className="home-discovery" aria-labelledby="discovery-title">
        <div className="home-section-heading"><div><h2 id="discovery-title" className="font-display">Different takes.</h2></div><Link href="/explore" className="home-text-action">All baskets<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
        <div className="home-basket-gallery">{FEATURED_BASKETS.map((basket) => <BasketStoryCard key={basket.id} basket={basket} />)}</div>
        <div className="mt-4 flex justify-end"><Link href="/leaderboard" className="home-text-action">This week’s top 10<ArrowUpRight className="size-4" aria-hidden="true" /></Link></div>
      </section>

      <section id="benefits" className="home-benefits" aria-labelledby="benefits-title">
        <h2 id="benefits-title" className="font-display">Built for people with a point of view.</h2>
        <div className="home-benefit-grid">
          {BENEFITS.map(({ icon: Icon, title, description }) => (
            <Card key={title} className="home-benefit-card">
              <Icon className="home-benefit-icon" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="font-display">{title}</h3>
              <p>{description}</p>
            </Card>
          ))}
        </div>
      </section>

      <section id="build" className="home-maker" aria-labelledby="belief-title">
        <div className="home-maker-copy">
          <h2 id="belief-title" className="font-display">Good stock picks<br />can come from<br /><span>anyone.</span></h2>
          <p>Share your strategy in a stock basket. When investing opens, earn management fees as people back it.</p>
          <Link href="/create" className="home-primary-action">Build your stock basket<ArrowUpRight className="size-4" aria-hidden="true" /></Link>
        </div>
        <CreatorRewardVisual />
      </section>

      <RoleJourneys />

      <section className="home-finer-details" aria-label="About xStocks and fees">
        <div className="home-details">
          <details><summary>Why xStocks?<span aria-hidden="true">+</span></summary><p>xStocks bring stocks and ETFs onchain, so a basket can hold them together in one token. They are issued instruments, not direct company shares. <a href="https://docs.xstocks.fi/docs/frequently-asked-questions" target="_blank" rel="noreferrer">Learn about xStocks <ArrowUpRight aria-hidden="true" className="inline size-3" /></a></p></details>
          <details id="fees"><summary>How will fees work?<span aria-hidden="true">+</span></summary><p>Choose an annual rate up to 3% when investing launches. This fee accrues on the basket’s value over time, whether prices rise or fall. You receive 90% of the fee shares and Basalt receives 10%. Fees are paid in newly issued basket shares, diluting existing holders.</p></details>
        </div>
      </section>

      <footer className="home-footer"><Link href="#overview" className="font-display">Basalt</Link><span>Stock ideas, shared.</span><Link href="/legal">Disclosures</Link></footer>
    </div>
  );
}

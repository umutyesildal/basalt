"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDown, ArrowUpRight, Check, FileText, UserRound } from "lucide-react";

import { BasketCover } from "@/components/basket/basket-story-card";
import { Card } from "@/components/ui/card";
import { CONCEPT_BASKETS, conceptBasketHref } from "@/lib/concept-samples";
import { logoUrl } from "@/lib/logos";
import styles from "./role-journeys.module.css";

const ROLES = ["I am an investor", "I am a basket manager"] as const;
const EXAMPLES = CONCEPT_BASKETS.slice(0, 2);
const PICKS = [
  { symbol: "NVDA", name: "NVIDIA", weight: 40 },
  { symbol: "MSFT", name: "Microsoft", weight: 35 },
  { symbol: "AAPL", name: "Apple", weight: 25 },
];

function StockMark({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);
  return <span className={styles.stockMark} aria-hidden="true">{failed ? symbol.slice(0, 2) : <img src={logoUrl(symbol)} width={28} height={28} alt="" loading="lazy" onError={() => setFailed(true)} />}</span>;
}

function Step({ number, title, description, children }: { number: string; title: string; description: string; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <div className={styles.stepHeading}><span className={`${styles.number} font-mono`} aria-hidden="true">{number}</span><h3 className="font-display">{title}</h3></div>
      <p className={styles.description}>{description}</p>
      <Card className={styles.visual}>{children}</Card>
    </li>
  );
}

export function RoleJourneys() {
  const id = useId();
  const [role, setRole] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function navigateTabs(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % ROLES.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + ROLES.length) % ROLES.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = ROLES.length - 1;
    else return;
    event.preventDefault();
    setRole(next);
    buttons.current[next]?.focus();
  }

  return (
    <section id="how-it-works" className={styles.section} aria-labelledby={`${id}-title`}>
      <div className={styles.heading}>
        <h2 id={`${id}-title`} className="font-display">How will you use Basalt?</h2>
        <div className={styles.tabs} role="tablist" aria-label="Choose your path">
          {ROLES.map((label, index) => <button key={label} ref={(node) => { buttons.current[index] = node; }} id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={role === index} aria-controls={`${id}-panel-${index}`} tabIndex={role === index ? 0 : -1} onClick={() => setRole(index)} onKeyDown={(event) => navigateTabs(event, index)}>{label}</button>)}
        </div>
      </div>

      <div id={`${id}-panel-0`} role="tabpanel" aria-labelledby={`${id}-tab-0`} hidden={role !== 0}>
        <ol className={`${styles.steps} ${styles.investorSteps}`}>
          <Step number="01" title="Find your kind of basket" description="Pick a strategy that fits how you see the world.">
            <div className={styles.basketPair}>{EXAMPLES.map((basket) => <Link key={basket.id} href={conceptBasketHref(basket)} className={styles.sampleLink} aria-label={`Explore ${basket.name}`}><BasketCover basket={basket} className={styles.sampleCover} /><div className={styles.sampleLabel}><span className="font-display">{basket.name}</span><ArrowUpRight size={15} aria-hidden="true" /></div><span className={styles.sampleAssets}>{basket.allocations.length} stocks & ETFs</span></Link>)}</div>
          </Step>
          <Step number="02" title="Choose how much to back" description="Back the basket when investing opens.">
            <div className={styles.amountIllustration}>
              <div className={styles.selectedBasket}><div className={styles.smallCover}><BasketCover basket={EXAMPLES[0]} /></div><span><strong className="font-display">{EXAMPLES[0].name}</strong><span>A strategy you believe in</span></span><Check className={styles.selectedCheck} size={18} aria-hidden="true" /></div>
              <div className={styles.amount}><span>Your amount</span><strong className="font-display">$1,000<span className="font-mono">USD</span></strong></div>
              <div className={styles.amountCaption}><span className={styles.amountDots} aria-hidden="true"><StockMark symbol="NVDA" /><StockMark symbol="MSFT" /><StockMark symbol="AAPL" /></span><span>One basket. Multiple stock picks.</span></div>
            </div>
          </Step>
        </ol>
        <div className={styles.action}><Link href="/explore" className="home-primary-action">Explore baskets<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
      </div>

      <div id={`${id}-panel-1`} role="tabpanel" aria-labelledby={`${id}-tab-1`} hidden={role !== 1}>
        <ol className={`${styles.steps} ${styles.managerSteps}`}>
          <Step number="01" title="Pick your stocks" description="Choose your companies. Give each a weight.">
            <div className={styles.stockList}>{PICKS.map((stock) => <div key={stock.symbol} className={styles.stockRow}><StockMark symbol={stock.symbol} /><span><strong>{stock.name}</strong><span className="font-mono">{stock.symbol}</span></span><span className={`${styles.weight} font-mono`}>{stock.weight}%</span></div>)}<div className={styles.stockTotal}><span>Your mix</span><span className="font-mono">100%</span></div></div>
          </Step>
          <Step number="02" title="Give your basket a story" description="Name it. Write your thesis. Share your point of view.">
            <div className={styles.thesisIllustration}><FileText size={24} strokeWidth={1.5} aria-hidden="true" /><p className={`${styles.thesisTitle} font-display`}>The everyday tech basket</p><p className={styles.thesisCopy}>The companies behind the tools we use every day.</p><div className={styles.thesisSignature}><span className={styles.person}><UserRound size={16} aria-hidden="true" /></span><span>Your basket, by you</span></div></div>
          </Step>
          <Step number="03" title="Set your management fee" description="Earn fee shares as people back your basket, once investing opens.">
            <div className={styles.feeIllustration}><div className={styles.feeRate}><strong className="font-display">1<span>%</span></strong><span>Example annual rate</span></div><ArrowDown size={18} className={styles.feeArrow} aria-hidden="true" /><div className={styles.feeShare}><span>Your share of the fee</span><strong className="font-display">90%</strong></div></div>
          </Step>
        </ol>
        <div className={styles.action}><Link href="/create" className="home-primary-action">Create your basket<ArrowUpRight size={16} aria-hidden="true" /></Link></div>
      </div>
    </section>
  );
}

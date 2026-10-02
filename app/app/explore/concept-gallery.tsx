"use client";

import Link from "next/link";
import { ModelPerformanceNote } from "@/components/basket/basket-performance";
import { BasketStoryCard } from "@/components/basket/basket-story-card";
import { CONCEPT_BASKETS } from "@/lib/concept-samples";

/** Illustrative baskets stay available independently of the live indexer. */
export function ConceptGallery() {
  return (
    <section aria-labelledby="concept-gallery-title" className="space-y-4">
      <div className="flex items-center justify-between gap-4"><h2 id="concept-gallery-title" className="text-sm font-medium text-muted-foreground">
        Sample baskets
      </h2><Link href="/leaderboard" className="inline-flex min-h-11 items-center text-sm underline decoration-border underline-offset-4">This week’s top 10 ↗</Link></div>
      <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {CONCEPT_BASKETS.map((basket) => (
          <li key={basket.id} className="min-w-0">
            <BasketStoryCard basket={basket} />
          </li>
        ))}
      </ul>
      <ModelPerformanceNote />
    </section>
  );
}

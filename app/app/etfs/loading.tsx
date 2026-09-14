import { EtfGridShimmerSkeleton } from "@/app/etfs/grid-skeleton";
import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";

/** Route-level loading for /etfs — mirrors the page header + listing-card grid shape. */
export default function EtfsLoading() {
  return (
    <div aria-busy="true">
      <div className="space-y-2 pb-8">
        <SkeletonShimmer width="14rem" height="2rem" />
        <SkeletonShimmer height="1rem" className="w-full max-w-2xl" />
      </div>
      <section aria-label="Loading tokenized ETF listings" className="border-t border-border py-8">
        <EtfGridShimmerSkeleton />
      </section>
    </div>
  );
}

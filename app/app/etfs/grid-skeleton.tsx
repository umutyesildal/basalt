import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";

/**
 * Shimmer grid skeleton for the /etfs listing — same footprint as the
 * rendered AssetCard (logo + ticker headline, context, price, 7d chart slot),
 * upgraded to the house SkeletonShimmer sweep. aria shape is identical:
 * role="status" wrapper, bars aria-hidden.
 */
export function EtfGridShimmerSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading tokenized ETF listings"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} aria-hidden="true" className="rounded-xl border border-border bg-card p-5">
          {/* Headline = [28px logo circle] ticker + context column (AssetCard anatomy). */}
          <div className="flex items-center gap-2.5">
            <SkeletonShimmer
              width="1.75rem"
              height="1.75rem"
              rounded="none"
              className="shrink-0 rounded-full"
            />
            <div className="min-w-0 space-y-1.5">
              <SkeletonShimmer width="4.5rem" height="1.25rem" />
              <SkeletonShimmer width="8rem" height="0.75rem" />
            </div>
          </div>
          <SkeletonShimmer width="7rem" height="1.75rem" className="mt-5" />
          <div className="mt-4 flex items-end justify-between gap-3 border-t border-border/60 pt-3">
            <SkeletonShimmer height="2.25rem" className="flex-1" />
            <SkeletonShimmer width="3rem" height="2rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

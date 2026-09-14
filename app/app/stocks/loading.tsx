import { SkeletonShimmer } from "@/components/ui/skeleton-shimmer";

/** Route-level loading for /stocks — mirrors the page header + token-card grid shape. */
export default function StocksLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-2">
        <SkeletonShimmer width="10rem" height="2rem" />
        <SkeletonShimmer height="1rem" className="w-full max-w-2xl" />
      </div>
      <div
        role="status"
        aria-label="Loading tokenized stocks"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: 6 }, (_, i) => (
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
                <SkeletonShimmer width="6rem" height="0.75rem" />
              </div>
            </div>
            <SkeletonShimmer width="7rem" height="1.75rem" className="mt-5" />
            <SkeletonShimmer height="2.25rem" className="mt-4" />
          </div>
        ))}
      </div>
    </div>
  );
}

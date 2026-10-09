import { basketDataMessage, type BasketDataQuality } from "@/lib/basket-data-quality";

/** Quiet context beside this basket's values; it never controls transaction actions. */
export function BasketDataNote({ quality, details = false }: { quality: BasketDataQuality; details?: boolean }) {
  const summary = basketDataMessage(quality);
  if (!summary) return null;
  const remaining = quality.reasons.slice(1);
  return (
    <div className="space-y-2 text-sm leading-6 text-muted-foreground" aria-label="Basket data availability">
      <p>{summary}</p>
      {details && remaining.length > 0 ? (
        <details>
          <summary className="min-h-10 cursor-pointer content-center font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">More about these values</summary>
          <ul className="list-disc space-y-1 pl-5">{remaining.map(reason => <li key={reason.code}>{reason.message}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

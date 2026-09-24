import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  managedBasketExample,
  type ManagedAssetExample,
  type ManagedChartTone,
} from "@/lib/managed-sample";

const SEGMENT_CLASS: Record<ManagedChartTone, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
};

function percent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

function delta(currentBps: number, proposedBps: number) {
  const difference = proposedBps - currentBps;
  const points = Math.abs(difference / 100);
  if (difference === 0) return "—";
  return `${difference > 0 ? "+" : "−"}${Number.isInteger(points) ? points : points.toFixed(2)} pp`;
}

function MixBar({
  label,
  field,
}: {
  label: string;
  field: "currentBps" | "proposedBps";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="font-mono text-xs tabular-nums text-muted-foreground">
          {managedBasketExample.assets.reduce((total, asset) => total + asset[field], 0) / 100}%
        </p>
      </div>
      <div
        aria-hidden="true"
        className="flex h-3 overflow-hidden rounded-sm bg-muted"
      >
        {managedBasketExample.assets.map((asset) => (
          <span
            key={`${label}-${asset.symbol}`}
            className={`${SEGMENT_CLASS[asset.tone]} h-full border-r border-background/70 last:border-r-0`}
            style={{ width: `${asset[field] / 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function AllocationTable({ assets }: { assets: readonly ManagedAssetExample[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/80">
      <table className="w-full table-fixed text-left text-xs sm:text-sm">
        <caption className="sr-only">
          Simulated allocation before and after the proposed mix change.
        </caption>
        <thead className="bg-muted/50 font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:text-[11px]">
          <tr>
            <th scope="col" className="w-[36%] px-3 py-2.5 font-medium sm:px-4">Asset</th>
            <th scope="col" className="w-[22%] px-2 py-2.5 text-right font-medium sm:px-3">Current</th>
            <th scope="col" className="w-[22%] px-2 py-2.5 text-right font-medium sm:px-3">Target</th>
            <th scope="col" className="w-[20%] px-2 py-2.5 text-right font-medium sm:px-3">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {assets.map((asset) => (
            <tr key={asset.symbol}>
              <th scope="row" className="px-3 py-3 font-medium text-foreground sm:px-4">
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${SEGMENT_CLASS[asset.tone]}`} />
                  <span className="min-w-0">
                    <span className="block truncate">{asset.symbol}</span>
                    <span className="hidden truncate text-xs font-normal text-muted-foreground sm:block">{asset.name}</span>
                  </span>
                </span>
              </th>
              <td className="px-2 py-3 text-right font-mono tabular-nums text-foreground sm:px-3">
                {percent(asset.currentBps)}
              </td>
              <td className="px-2 py-3 text-right font-mono tabular-nums text-foreground sm:px-3">
                {percent(asset.proposedBps)}
              </td>
              <td className="px-2 py-3 text-right font-mono tabular-nums text-muted-foreground sm:px-3">
                {delta(asset.currentBps, asset.proposedBps)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AllocationComparison() {
  const { assets, currentVersion, proposedVersion, rationale } = managedBasketExample;

  return (
    <section id="allocation" aria-labelledby="allocation-heading" className="scroll-mt-24">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-label">Example mix</p>
          <h2 id="allocation-heading" className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
            One proposal, two allocations
          </h2>
        </div>
        <p className="w-fit rounded-md border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
          Simulated · v{currentVersion} → v{proposedVersion}
        </p>
      </div>

      <Card className="overflow-visible">
        <CardHeader className="gap-2 sm:flex sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="text-base">{managedBasketExample.name}</CardTitle>
            <p className="mt-1.5 max-w-prose text-sm leading-6 text-muted-foreground">
              {rationale}
            </p>
          </div>
          <span className="inline-flex w-fit items-center rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
            Example only
          </span>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-5 rounded-lg border border-border/70 bg-muted/20 p-4 sm:p-5">
            <MixBar label={`Current holdings · v${currentVersion}`} field="currentBps" />
            <MixBar label={`Proposed target · v${proposedVersion}`} field="proposedBps" />
          </div>

          <AllocationTable assets={assets} />

          <details className="rounded-lg border border-border/70 bg-muted/20 p-4">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              How a mix change works
            </summary>
            <div className="mt-3 max-w-prose space-y-3 text-sm leading-6 text-muted-foreground">
              <p>A creator may propose new weights within the fixed asset list. A proposal does not change the vault.</p>
              <p>After the notice period, a bounded trade may fill. Only a confirmed fill updates current holdings for every share in the basket.</p>
            </div>
          </details>
        </CardContent>
      </Card>
    </section>
  );
}

import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AllocationComparison } from "@/components/managed/allocation-comparison";
import { TokenRoles } from "@/components/managed/token-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { managedBasketExample } from "@/lib/managed-sample";
import { isLocalManagedEndpoint } from "@/lib/managed-chain";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";

function BasaltMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="miter"
      className="size-14 text-primary sm:size-16"
    >
      <path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
      <path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
      <path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
    </svg>
  );
}

function FlowStep({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 py-4 first:pt-0 last:pb-0">
      <span className="font-mono text-xs tabular-nums text-primary-text">{number}</span>
      <div className="min-w-0">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

function FeeConcept() {
  const { fees, illustrativeCreatorSplitBps, illustrativeTreasurySplitBps } = managedBasketExample;
  const currentFees = [
    { label: "Entry", value: fees.entryBps },
    { label: "Exit", value: fees.exitBps },
    { label: "Annual", value: fees.annualManagementBps },
  ];

  return (
    <Card className="h-full">
      <CardHeader>
        <p className="section-label">Fee model</p>
        <CardTitle className="mt-1 text-lg">Zero fees in this prototype</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border/80 bg-muted/20 py-3">
          {currentFees.map((fee) => (
            <div key={fee.label} className="px-2 text-center sm:px-3">
              <dt className="text-xs text-muted-foreground">{fee.label}</dt>
              <dd className="mt-1 font-mono text-base tabular-nums text-foreground">{(fee.value / 100).toFixed(0)}%</dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-border pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-medium text-foreground">Illustrative future fee split</h3>
            <span className="font-mono text-[11px] text-muted-foreground">Concept only</span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-sm bg-muted" aria-hidden="true">
            <span className="bg-primary" style={{ width: `${illustrativeCreatorSplitBps / 100}%` }} />
            <span className="bg-border-strong" style={{ width: `${illustrativeTreasurySplitBps / 100}%` }} />
          </div>
          <div className="mt-2 flex justify-between gap-3 text-xs">
            <span className="text-foreground">Creator {illustrativeCreatorSplitBps / 100}%</span>
            <span className="text-muted-foreground">Treasury {illustrativeTreasurySplitBps / 100}%</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            No creator fees accrue in this prototype.
          </p>
        </div>

        <details className="border-t border-border pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Fee details
          </summary>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The 90/10 split is an illustrative future concept, not an active protocol setting. Trade costs would be shown separately from basket fees.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function ChangeFlow() {
  return (
    <Card className="h-full">
      <CardHeader>
        <p className="section-label">A shared basket</p>
        <CardTitle className="mt-1 text-lg">How a change reaches holders</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="divide-y divide-border/70">
          <FlowStep number="01" title="Propose" body="The creator suggests weights within the fixed asset list." />
          <FlowStep number="02" title="Review" body={`${managedBasketExample.noticeHours}-hour public notice; holders can redeem.`} />
          <FlowStep number="03" title="Fill" body="A bounded trade updates the shared vault after confirmation." />
        </ol>
        <details className="mt-4 border-t border-border pt-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Execution details
          </summary>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            A guardian approves the trade limit; an eligible counterparty may fill after the notice period. A proposal or approval alone never changes holdings.
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

export function ManagedOverview() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-14 pb-12 pt-2 sm:space-y-20">
      <header className="grid items-center gap-8 border-b border-border pb-8 md:grid-cols-[minmax(0,1.35fr)_minmax(14rem,0.65fr)] md:pb-10">
        <div className="min-w-0">
          <p className="section-label">Managed basket prototype</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            One basket.<br className="hidden sm:block" /> Two distinct tokens.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            An identity NFT names the basket. Fungible shares represent a claim on its assets. Creators can propose delayed weight changes within a fixed asset list.
          </p>
          <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground" />
            {managedBasketExample.provenance.label}
          </p>
          <a
            href="#allocation"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See an example mix
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
          {isLocalManagedEndpoint(CLUSTER, RPC_ENDPOINT) && (
            <Link href="/managed/lab" className="ml-4 inline-flex min-h-11 items-center text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Try with a wallet
            </Link>
          )}
        </div>

        <div className="relative flex min-h-52 items-center justify-between overflow-hidden rounded-xl border border-border bg-card p-6 sm:p-8">
          <div className="absolute inset-0 bg-grid opacity-35" aria-hidden="true" />
          <div className="relative space-y-3">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">One shared vault</p>
            <p className="max-w-40 font-display text-2xl font-semibold leading-tight">A mix for every share</p>
          </div>
          <div className="relative grid size-28 shrink-0 place-items-center rounded-full border border-primary/25 bg-background/70 sm:size-32">
            <div className="absolute inset-2 rounded-full border border-border" />
            <BasaltMark />
          </div>
        </div>
      </header>

      <AllocationComparison />
      <TokenRoles />

      <section aria-label="Managed basket mechanics" className="grid gap-4 lg:grid-cols-2">
        <ChangeFlow />
        <FeeConcept />
      </section>

      <details className="rounded-xl border border-border bg-card p-5 sm:p-6">
        <summary className="flex min-h-11 cursor-pointer items-center font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Technical details
        </summary>
        <div className="mt-4 grid gap-5 border-t border-border pt-4 text-sm leading-6 text-muted-foreground sm:grid-cols-2">
          <div>
            <h2 className="font-medium text-foreground">Share accounting</h2>
            <p className="mt-1">A holder’s pro-rata amount is based on actual vault balances and share supply. A confirmed rebalance changes the common holdings, not share balances.</p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">NFT authority</h2>
            <p className="mt-1">The single identity NFT is minted to the creator. Manager authority lives in a separate role account and cannot be transferred with the NFT.</p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">Prototype data</h2>
            <p className="mt-1">Allocations on this page are fixed sample values. The page does not read a wallet or on-chain account, request a signature, submit a proposal, or execute a trade.</p>
          </div>
          <div>
            <h2 className="font-medium text-foreground">Asset backing</h2>
            <p className="mt-1">The example uses simulated project mock assets. It does not represent official xStocks or assets with economic backing.</p>
          </div>
        </div>
      </details>

    </div>
  );
}

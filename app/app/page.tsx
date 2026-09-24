import Link from "next/link";

const previewMix = [
  { symbol: "NVDA", weight: "40%", color: "#FCEE0A" },
  { symbol: "AAPL", weight: "32%", color: "#D7D3C6" },
  { symbol: "MSFT", weight: "28%", color: "#77766F" },
] as const;

export default function LandingPage() {
  return (
    <div className="space-y-20 pb-16 md:space-y-28">
      <section className="bg-grid relative overflow-hidden rounded-2xl border border-border/50">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--background))_5%,hsl(var(--background)/0.82)_55%,hsl(var(--background)/0.28)_100%)]" />
        <div className="relative grid gap-12 px-6 py-16 sm:px-10 md:grid-cols-[minmax(0,1fr)_320px] md:items-center md:gap-8 md:py-24 lg:px-14">
          <div className="max-w-2xl">
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-primary">Concept preview</span>
            <h1 className="mt-5 max-w-2xl font-display text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              Build your basket idea.
              <br />
              <span className="text-primary">Share your thesis.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground md:text-lg">
              Choose stocks and ETFs, set your mix, and share your idea. Explore other creators without connecting a wallet.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href="/create"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Build a basket idea <span aria-hidden="true" className="ml-3">↗</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card/80 px-6 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Explore ideas
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/95 p-5 shadow-2xl shadow-black/10" aria-label="Example basket allocation: NVDA 40%, AAPL 32%, MSFT 28%">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Your basket</span>
              <span className="rounded border border-primary/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-primary">Preview</span>
            </div>
            <h2 className="mt-4 font-display text-xl font-semibold">Your idea, at a glance</h2>
            <div className="mx-auto my-7 flex size-40 items-center justify-center rounded-full" style={{ background: "conic-gradient(#FCEE0A 0% 40%, #D7D3C6 40% 72%, #77766F 72% 100%)" }}>
              <div className="flex size-28 flex-col items-center justify-center rounded-full bg-card">
                <span className="font-display text-2xl font-semibold">3</span>
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">assets</span>
              </div>
            </div>
            <ul className="divide-y divide-border/70">
              {previewMix.map((asset) => (
                <li key={asset.symbol} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2.5"><span className="size-2 rounded-full" style={{ backgroundColor: asset.color }} />{asset.symbol}</span>
                  <span className="font-mono tabular-nums">{asset.weight}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section aria-labelledby="how-it-works" className="mx-auto max-w-5xl">
        <div className="max-w-xl">
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-primary">How Basalt works</span>
          <h2 id="how-it-works" className="mt-3 font-display text-3xl font-semibold sm:text-4xl">Build a mix. Make it yours.</h2>
        </div>
        <div className="mt-9 grid gap-3 md:grid-cols-3">
          {[
            ["01", "Build", "Choose the stocks and set their weights."],
            ["02", "Copy a mix", "Open someone’s basket, use its mix, then change it to fit your view."],
            ["03", "Share", "Send your basket link. Others can use it as a starting point too."],
          ].map(([number, title, body]) => (
            <div key={number} className="rounded-xl border border-border bg-card p-6">
              <span className="font-mono text-xs text-primary">{number}</span>
              <h3 className="mt-6 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">Copying a mix does not copy future trades or buy assets.</p>
        <div className="mt-7 flex flex-col gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-2xl">
            <h3 className="font-display text-xl font-semibold">How creator fees work</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">A preview earns nothing. If you deploy a basket, you can set optional entry, exit, and annual fees. When fees are generated, 90% of the fee shares go to the creator and 10% to the treasury.</p>
            <p className="mt-2 text-xs text-muted-foreground">The current onchain flow uses Devnet mock tokens and has no real earnings.</p>
          </div>
          <Link href="/create/onchain" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-border px-5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">Explore onchain creation</Link>
        </div>
      </section>
    </div>
  );
}

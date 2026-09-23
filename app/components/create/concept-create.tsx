"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CreatePreviewDonut } from "@/components/create/create-preview-donut";
import { CONCEPT_ASSETS, getConceptAsset } from "@/lib/concept-assets";
import { type ConceptBasket, validateConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref } from "@/lib/concept-share";
import { formatBpsAsPercent, formatUsd } from "@/lib/format";

const COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
] as const;

const TEMPLATE_OPTIONS = [
  {
    id: "mega-cap-tech",
    name: "Mega-Cap Tech",
    description: "Big names shaping tech.",
    assets: [
      { symbol: "AAPL", weightBps: 2_500 },
      { symbol: "MSFT", weightBps: 2_500 },
      { symbol: "NVDA", weightBps: 3_000 },
      { symbol: "GOOGL", weightBps: 2_000 },
    ],
  },
  {
    id: "index-core",
    name: "Index Core",
    description: "Broad market, tech tilt.",
    assets: [
      { symbol: "SPY", weightBps: 6_000 },
      { symbol: "QQQ", weightBps: 4_000 },
    ],
  },
  {
    id: "motion",
    name: "Motion",
    description: "The future of mobility.",
    assets: [
      { symbol: "TSLA", weightBps: 5_000 },
      { symbol: "UBER", weightBps: 3_000 },
      { symbol: "ABNB", weightBps: 2_000 },
    ],
  },
] as const;

const STEPS = ["Choose", "Set up", "Start", "Review"] as const;
type Step = 0 | 1 | 2 | 3;
type SelectedAsset = ConceptBasket["assets"][number];

const INITIAL_ASSETS = TEMPLATE_OPTIONS[0].assets.map((asset) => ({ ...asset }));

function equalWeights(count: number): number[] {
  if (count < 1) return [];
  const base = Math.floor(10_000 / count);
  const remainder = 10_000 - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Keep every chosen asset above zero while distributing exactly 10,000 bps. */
function distributeWeights(weights: number[], total = 10_000): number[] {
  if (weights.length === 0) return [];
  const minimumTotal = weights.length;
  const distributable = Math.max(0, total - minimumTotal);
  const ratios = weights.map((weight) => Math.max(0, weight - 1));
  const ratioTotal = ratios.reduce((sum, value) => sum + value, 0);
  const source = ratioTotal > 0 ? ratios : weights.map(() => 1);
  const sourceTotal = source.reduce((sum, value) => sum + value, 0);
  const extras = source.map((value) => Math.floor((value / sourceTotal) * distributable));
  let remainder = distributable - extras.reduce((sum, value) => sum + value, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % extras.length) {
    extras[index] += 1;
    remainder -= 1;
  }
  return extras.map((value) => value + 1);
}

function formatCompactPercent(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function asBasket(
  name: string,
  thesis: string,
  assets: SelectedAsset[],
  amountUsd: number,
  fees: ConceptBasket["fees"],
): ConceptBasket {
  return { v: 1, name, thesis, assets, amountUsd, fees };
}

export default function ConceptCreate() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [activeTemplate, setActiveTemplate] = useState<string | null>("mega-cap-tech");
  const [assets, setAssets] = useState<SelectedAsset[]>(INITIAL_ASSETS);
  const [search, setSearch] = useState("");
  const [showAllAssets, setShowAllAssets] = useState(false);
  const [amountDraft, setAmountDraft] = useState("1000");
  const [feesOpen, setFeesOpen] = useState(false);
  const [fees, setFees] = useState<ConceptBasket["fees"]>({ entryBps: 0, exitBps: 0, managementBps: 0 });
  const [name, setName] = useState("Mega-Cap Tech");
  const [thesis, setThesis] = useState("");
  const [shareError, setShareError] = useState<string | null>(null);

  const parsedAmount = amountDraft.trim() === "" ? Number.NaN : Number(amountDraft);
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000;
  const selectedSymbols = useMemo(() => new Set(assets.map((asset) => asset.symbol)), [assets]);
  const matchingAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = CONCEPT_ASSETS.filter((asset) =>
      !query || asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query) || asset.category.toLowerCase().includes(query),
    );
    return showAllAssets || query ? matches : matches.slice(0, 8);
  }, [search, showAllAssets]);

  const currentBasket = asBasket(name, thesis, assets, amountIsValid ? parsedAmount : 0, fees);
  const validation = validateConceptBasket(currentBasket);
  const mixIsValid =
    assets.length >= 2 &&
    assets.length <= 20 &&
    assets.reduce((sum, asset) => sum + asset.weightBps, 0) === 10_000 &&
    assets.every((asset) => asset.weightBps > 0) &&
    new Set(assets.map((asset) => asset.symbol)).size === assets.length;
  const canContinue = step === 0
    ? assets.length >= 2 && assets.length <= 20
    : step === 1
      ? mixIsValid
      : step === 2
        ? amountIsValid
        : validation.ok;

  function chooseTemplate(templateId: string) {
    const template = TEMPLATE_OPTIONS.find((option) => option.id === templateId);
    setActiveTemplate(templateId);
    if (!template) {
      setAssets([]);
      setName("My index");
      setSearch("");
      setShowAllAssets(false);
      return;
    }
    setAssets(template.assets.map((asset) => ({ ...asset })));
    setName(template.name);
  }

  function toggleAsset(symbol: string) {
    const existing = assets.some((asset) => asset.symbol === symbol);
    setActiveTemplate(null);
    if (existing) {
      const remaining = assets.filter((asset) => asset.symbol !== symbol);
      const nextWeights = distributeWeights(remaining.map((asset) => asset.weightBps));
      setAssets(remaining.map((asset, index) => ({ ...asset, weightBps: nextWeights[index] })));
      return;
    }
    if (assets.length >= 20) return;
    const nextSymbols = [...assets.map((asset) => asset.symbol), symbol];
    const weights = equalWeights(nextSymbols.length);
    setAssets(nextSymbols.map((nextSymbol, index) => ({ symbol: nextSymbol, weightBps: weights[index] })));
  }

  function setAssetWeight(index: number, rawValue: number) {
    const safeMaximum = Math.max(1, 10_000 - (assets.length - 1));
    const nextValue = Math.max(1, Math.min(safeMaximum, Math.round(rawValue)));
    const otherIndices = assets.map((_, i) => i).filter((i) => i !== index);
    const nextWeights = Array<number>(assets.length).fill(0);
    nextWeights[index] = nextValue;
    const rest = distributeWeights(otherIndices.map((i) => assets[i].weightBps), 10_000 - nextValue);
    otherIndices.forEach((otherIndex, i) => { nextWeights[otherIndex] = rest[i]; });
    setActiveTemplate(null);
    setAssets(assets.map((asset, i) => ({ ...asset, weightBps: nextWeights[i] })));
  }

  function setAmount(value: number) {
    setAmountDraft(String(value));
  }

  function next() {
    if (!canContinue) return;
    if (step < 3) setStep((step + 1) as Step);
  }

  function createPreview() {
    setShareError(null);
    if (!validation.ok || !amountIsValid) {
      setShareError(validation.ok ? "Choose a valid starting amount." : validation.errors[0]);
      return;
    }
    try {
      router.push(conceptPreviewHref(validation.value));
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "This preview could not be created. Try again.");
    }
  }

  const stepTitle = ["Choose a starting point", "Set your mix", "Choose a starting amount", "Review your basket"][step];
  const stepDescription = [
    "Pick a template, then make it your own.",
    "Shape the allocation until it reflects your idea.",
    "See how your mix could be sized. You can adjust fees if you need to.",
    "Give your idea a name and make sure everything feels right.",
  ][step];

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="section-label">Stock baskets</p>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Create your basket</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pick stocks and ETFs, shape the mix, then share your idea.
          </p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
          Concept preview
        </span>
      </div>

      <nav aria-label="Create steps" className="mb-8">
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((label, index) => {
            const complete = index < step;
            const active = index === step;
            return (
              <li key={label} className="min-w-0">
                <div className={`flex items-center gap-2 border-t-2 pt-3 ${active ? "border-primary" : complete ? "border-primary/55" : "border-border"}`}>
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs ${active ? "bg-primary text-primary-foreground" : complete ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground"}`}>
                    {complete ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={`truncate text-xs sm:text-sm ${active ? "font-medium text-foreground" : "text-muted-foreground"}`}>{label}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader className="border-b border-border/70 px-5 py-5 sm:px-7">
            <div className="section-label">Step {step + 1} of 4</div>
            <h2 className="font-display mt-1 text-2xl font-semibold">{stepTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{stepDescription}</p>
          </CardHeader>
          <CardContent className="space-y-7 px-5 py-6 sm:px-7">
            {step === 0 && (
              <section aria-labelledby="template-heading" className="space-y-6">
                <div>
                  <h3 id="template-heading" className="mb-3 text-sm font-medium">Start with a template</h3>
                  <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-2">
                    {TEMPLATE_OPTIONS.map((template) => (
                      <TemplateCard
                        key={template.id}
                        name={template.name}
                        description={template.description}
                        assets={template.assets}
                        selected={activeTemplate === template.id}
                        onSelect={() => chooseTemplate(template.id)}
                      />
                    ))}
                    <button
                      type="button"
                      aria-pressed={activeTemplate === "custom"}
                      onClick={() => chooseTemplate("custom")}
                      className={`group flex min-h-32 flex-col justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeTemplate === "custom" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">Create your own index</span>
                        <span className="flex size-7 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground group-hover:text-foreground">
                          <Plus className="size-4" aria-hidden="true" />
                        </span>
                      </span>
                      <span className="mt-2 text-xs leading-5 text-muted-foreground">Pick your own companies.</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3 border-t border-border/70 pt-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium">Your assets <span className="font-mono text-muted-foreground">{assets.length}/20</span></h3>
                    <p className="text-xs text-muted-foreground">Choose at least 2</p>
                  </div>
                  {assets.length > 0 ? (
                    <ul className="flex flex-wrap gap-2" aria-label="Selected assets">
                      {assets.map((asset) => (
                        <li key={asset.symbol}>
                          <span className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-muted/30 pl-2 pr-1">
                            <AssetLogo symbol={asset.symbol} size={24} />
                            <span className="font-mono text-xs font-medium">{asset.symbol}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${asset.symbol}`}
                              onClick={() => toggleAsset(asset.symbol)}
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <X className="size-3.5" aria-hidden="true" />
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Choose assets below to start your mix.</p>
                  )}

                  <div className="relative">
                    <label htmlFor="asset-search" className="sr-only">Search assets by name or ticker</label>
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="asset-search"
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search assets"
                      className="min-h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Curated assets">
                    {matchingAssets.map((asset) => {
                      const selected = selectedSymbols.has(asset.symbol);
                      const disabled = !selected && assets.length >= 20;
                      return (
                        <button
                          key={asset.symbol}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          onClick={() => toggleAsset(asset.symbol)}
                          className={`flex min-h-12 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
                        >
                          <AssetLogo symbol={asset.symbol} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs font-medium">{asset.symbol}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{asset.name}</span>
                          </span>
                          <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"}`}>
                            {selected ? <Check className="size-3" aria-hidden="true" /> : <Plus className="size-3" aria-hidden="true" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {matchingAssets.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No matching assets. Try a company name or ticker.</p>
                  )}
                  {!search && !showAllAssets && (
                    <button type="button" onClick={() => setShowAllAssets(true)} className="min-h-10 text-sm text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Browse all {CONCEPT_ASSETS.length} assets
                    </button>
                  )}
                  <p className="text-xs leading-5 text-muted-foreground">This curated catalog is for the concept preview. Availability and prices are not checked.</p>
                </div>
              </section>
            )}

            {step === 1 && (
              <section aria-labelledby="mix-heading" className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 id="mix-heading" className="text-sm font-medium">Set each asset’s share</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Moving one allocation redistributes the rest automatically.</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => {
                    setActiveTemplate(null);
                    setAssets(assets.map((asset, index) => ({ ...asset, weightBps: equalWeights(assets.length)[index] })));
                  }}>
                    Equal mix
                  </Button>
                </div>
                {assets.length < 2 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center">
                    <p className="text-sm font-medium">Add one more asset to set your mix</p>
                    <p className="mt-1 text-xs text-muted-foreground">A basket preview needs at least two constituents.</p>
                    <Button type="button" variant="outline" className="mt-4 min-h-11" onClick={() => setStep(0)}>Choose assets</Button>
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border/70 rounded-xl border border-border bg-background">
                      {assets.map((asset, index) => {
                        const info = getConceptAsset(asset.symbol);
                        const dollars = amountIsValid ? (parsedAmount * asset.weightBps) / 10_000 : 0;
                        const max = Math.max(1, 10_000 - (assets.length - 1));
                        return (
                          <div key={asset.symbol} className="px-4 py-4 sm:px-5">
                            <div className="mb-2 flex items-center justify-between gap-4">
                              <div className="flex min-w-0 items-center gap-3">
                                <AssetLogo symbol={asset.symbol} size={34} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{info?.name ?? asset.symbol}</p>
                                  <p className="font-mono text-xs text-muted-foreground">{asset.symbol}</p>
                                </div>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="font-mono text-sm tabular-nums">{formatCompactPercent(asset.weightBps)}</p>
                                <p className="font-mono text-xs tabular-nums text-muted-foreground">{formatUsd(dollars)}</p>
                              </div>
                            </div>
                            <label className="sr-only" htmlFor={`weight-${asset.symbol}`}>Allocation for {asset.symbol}</label>
                            <input
                              id={`weight-${asset.symbol}`}
                              type="range"
                              min={1}
                              max={max}
                              step={1}
                              value={asset.weightBps}
                              onChange={(event) => setAssetWeight(index, Number(event.target.value))}
                              className="h-11 w-full cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              aria-valuetext={formatBpsAsPercent(asset.weightBps)}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted/35 px-4 py-3 text-sm">
                      <span className="text-muted-foreground">Total allocation</span>
                      <span className="font-mono font-medium tabular-nums">100.00%</span>
                    </div>
                  </>
                )}
              </section>
            )}

            {step === 2 && (
              <section aria-labelledby="amount-heading" className="space-y-7">
                <div>
                  <h3 id="amount-heading" className="text-sm font-medium">How much would you start with?</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">See an illustrative dollar split across your assets. This is not a live quote.</p>
                  <div className="mt-4 flex items-center rounded-xl border border-input bg-background px-4 focus-within:ring-2 focus-within:ring-ring">
                    <span className="font-mono text-lg text-muted-foreground" aria-hidden="true">$</span>
                    <label htmlFor="starting-amount" className="sr-only">Illustrative starting amount in US dollars</label>
                    <input
                      id="starting-amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountDraft}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (/^\d{0,7}(?:\.\d{0,2})?$/.test(value)) setAmountDraft(value);
                      }}
                      aria-invalid={amountIsValid ? undefined : true}
                      aria-describedby={amountIsValid ? "amount-help" : "amount-help amount-error"}
                      className="min-h-16 w-full bg-transparent px-3 font-display text-3xl tabular-nums outline-none placeholder:text-muted-foreground"
                    />
                    <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">USD</span>
                  </div>
                  <p id="amount-help" className="mt-2 text-xs text-muted-foreground">Just a sizing example. Nothing is deposited or purchased.</p>
                  {!amountIsValid && <p id="amount-error" className="mt-1 text-xs text-destructive">Enter an amount above $0 and up to $1,000,000.</p>}
                  <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Starting amount shortcuts">
                    {[10, 100, 1_000].map((value) => (
                      <Button key={value} type="button" variant={parsedAmount === value ? "secondary" : "outline"} className="min-h-11" aria-pressed={parsedAmount === value} onClick={() => setAmount(value)}>
                        {formatUsd(value, { maximumFractionDigits: 0 })}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border/70 pt-5">
                  <button
                    type="button"
                    aria-expanded={feesOpen}
                    onClick={() => setFeesOpen((open) => !open)}
                    className="flex min-h-11 w-full items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block text-sm font-medium">Optional fees</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Start at 0%. Set a fee only if your concept calls for one.</span>
                    </span>
                    <span className="flex max-w-[65%] items-center justify-end gap-2 text-right text-xs text-muted-foreground">
                      {feeSummary(fees)} <ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${feesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                    </span>
                  </button>
                  {feesOpen && (
                    <div className="mt-4 space-y-4 rounded-xl border border-border bg-background p-4">
                      <FeeSlider label="Entry fee" detail="Applied when basket shares are created." value={fees.entryBps} max={300} onChange={(value) => setFees((current) => ({ ...current, entryBps: value }))} />
                      <FeeSlider label="Exit fee" detail="Applied when basket shares are redeemed." value={fees.exitBps} max={100} onChange={(value) => setFees((current) => ({ ...current, exitBps: value }))} />
                      <FeeSlider label="Management fee" detail="Annual fee represented by new basket shares over time." value={fees.managementBps} max={300} suffix="/ year" onChange={(value) => setFees((current) => ({ ...current, managementBps: value }))} />
                      <p className="border-t border-border pt-3 text-xs leading-5 text-muted-foreground">These rates are part of the concept preview. The transaction flow shows the complete fee terms before deployment.</p>
                    </div>
                  )}
                </div>
              </section>
            )}

            {step === 3 && (
              <section aria-labelledby="review-heading" className="space-y-6">
                <div>
                  <label htmlFor="basket-name" className="mb-1.5 block text-sm font-medium">Basket name <span className="text-destructive">*</span></label>
                  <input
                    id="basket-name"
                    type="text"
                    autoComplete="off"
                    maxLength={60}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    aria-invalid={!name.trim()}
                    aria-describedby="basket-name-hint"
                    placeholder="e.g. The AI Infrastructure Index"
                    className="min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p id="basket-name-hint" className="mt-1.5 text-xs text-muted-foreground">A short name helps people understand the idea at a glance.</p>
                </div>
                <div>
                  <label htmlFor="basket-thesis" className="mb-1.5 block text-sm font-medium">Your thesis <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <textarea
                    id="basket-thesis"
                    rows={3}
                    maxLength={240}
                    value={thesis}
                    onChange={(event) => setThesis(event.target.value)}
                    placeholder="What connects these companies?"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground"><span>Share the point of view behind your mix.</span><span className="font-mono tabular-nums">{thesis.length}/240</span></p>
                </div>

                <div className="lg:hidden">
                  <LiveSummary basket={currentBasket} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <SummaryStat label="Starting amount" value={amountIsValid ? formatUsd(parsedAmount) : "—"} />
                  <SummaryStat label="Fees" value={feeSummary(fees)} detail="Entry · exit · management" />
                </div>

                {!validation.ok && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{validation.errors[0]}</p>}
                {shareError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{shareError}</p>}

                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  Your preview is a shareable idea. It does not deploy a basket, buy shares or represent real investment performance.
                </div>
              </section>
            )}
          </CardContent>
          <div className="flex items-center justify-between gap-3 border-t border-border/70 px-5 py-4 sm:px-7">
            <Button type="button" variant="outline" className="min-h-11 min-w-24" disabled={step === 0} onClick={() => setStep((step - 1) as Step)}>
              <ArrowLeft className="size-4" aria-hidden="true" /> Back
            </Button>
            {step < 3 ? (
              <Button type="button" className="min-h-11 min-w-32" disabled={!canContinue} onClick={next}>
                Continue <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="button" className="min-h-11 min-w-40" disabled={!validation.ok || !amountIsValid} onClick={createPreview}>
                Create preview <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        </Card>

        <aside className="hidden lg:block lg:sticky lg:top-6" aria-label="Live basket summary">
          <LiveSummary basket={currentBasket} />
          <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground">Reference allocation only. The values above are calculated from your example amount and target mix.</p>
        </aside>
      </div>

      {step !== 3 && <div className="mt-5 lg:hidden">
        <LiveSummary basket={currentBasket} />
        <p className="mt-3 px-1 text-xs leading-5 text-muted-foreground">Reference allocation only. Values use your example amount and target mix.</p>
      </div>}

      <div className="mt-8 border-t border-border/70 pt-5">
        <p className="text-sm text-muted-foreground">
          Looking for the devnet transaction flow? <Link href="/create/onchain" className="font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Open onchain create</Link>
        </p>
      </div>
    </div>
  );
}

function TemplateCard({
  name,
  description,
  assets,
  selected,
  onSelect,
}: {
  name: string;
  description: string;
  assets: readonly SelectedAsset[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-32 flex-col rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-4 ${selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
    >
      <span className="flex w-full items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-medium leading-5">{name}</span>
          <span className="mt-1 block text-xs leading-4 text-muted-foreground">{description}</span>
        </span>
        <span className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"}`}>
          {selected ? <Check className="size-3" aria-hidden="true" /> : null}
        </span>
      </span>
      <span className="mt-auto flex items-center gap-1.5 pt-3" aria-label={`${assets.length} assets`}>
        {assets.slice(0, 2).map((asset) => <AssetLogo key={asset.symbol} symbol={asset.symbol} size={24} />)}
        <span className="hidden sm:contents">
          {assets.slice(2, 4).map((asset) => <AssetLogo key={asset.symbol} symbol={asset.symbol} size={24} />)}
        </span>
        <span className="ml-1 font-mono text-[11px] text-muted-foreground">{assets.length} assets</span>
      </span>
    </button>
  );
}

function AssetLogo({ symbol, size }: { symbol: string; size: number }) {
  const asset = getConceptAsset(symbol);
  const [failed, setFailed] = useState(false);
  const colorIndex = symbol.split("").reduce((value, char) => value + char.charCodeAt(0), 0) % COLORS.length;
  const style = {
    width: size,
    height: size,
    color: COLORS[colorIndex],
    borderColor: `color-mix(in hsl, ${COLORS[colorIndex]} 45%, transparent)`,
    backgroundColor: `color-mix(in hsl, ${COLORS[colorIndex]} 14%, transparent)`,
  } as CSSProperties;
  if (!asset || failed) {
    return (
      <span style={style} className="flex shrink-0 items-center justify-center rounded-full border font-mono text-[10px] font-semibold" aria-label={`${symbol} logo fallback`} role="img" title={symbol}>
        {symbol.slice(0, 2)}
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted" style={{ width: size, height: size }}>
      {/* External company marks skip Next image optimization; letter fallback appears on 404/offline. */}
      <img src={asset.logoUrl} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-cover" />
    </span>
  );
}

function LiveSummary({ basket }: { basket: ConceptBasket }) {
  const total = basket.assets.reduce((sum, asset) => sum + asset.weightBps, 0);
  const chartSlices = basket.assets.map((asset, index) => ({
    key: asset.symbol,
    label: asset.symbol,
    value: asset.weightBps,
    color: COLORS[index % COLORS.length],
  }));

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div className="min-w-0">
          <p className="section-label">Live preview</p>
          <h2 className="font-display mt-1 truncate text-lg font-semibold">{basket.name || "Your basket"}</h2>
        </div>
        <span className="rounded-full border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Concept</span>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-center py-2">
          <div role="img" aria-label={`Allocation chart with ${basket.assets.length} assets, total ${formatBpsAsPercent(total)}`}>
            <CreatePreviewDonut slices={chartSlices} size={176} />
          </div>
        </div>
        {basket.assets.length > 0 ? (
          <ul className="space-y-2.5" aria-label="Basket allocation">
            {basket.assets.map((asset, index) => {
              const info = getConceptAsset(asset.symbol);
              const amount = (basket.amountUsd * asset.weightBps) / 10_000;
              return (
                <li key={asset.symbol} className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-xs">{info?.name ?? asset.symbol}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{formatCompactPercent(asset.weightBps)}</span>
                  <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums">{formatUsd(amount)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">Choose two or more assets to see your mix.</p>
        )}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Starting amount</span>
          <span className="font-mono text-sm font-medium tabular-nums">{basket.amountUsd > 0 ? formatUsd(basket.amountUsd) : "—"}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Fees</span>
          <span className="max-w-[65%] break-words text-right font-mono text-xs tabular-nums">
            {feeSummary(basket.fees)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function feeSummary(fees: ConceptBasket["fees"]): string {
  if (fees.entryBps === 0 && fees.exitBps === 0 && fees.managementBps === 0) return "None";
  return `Entry ${formatCompactPercent(fees.entryBps)} · exit ${formatCompactPercent(fees.exitBps)} · mgmt ${formatCompactPercent(fees.managementBps)}/yr`;
}

function SummaryStat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-4">
      <p className="section-label">{label}</p>
      <p className="mt-2 font-display text-lg font-semibold tabular-nums">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function FeeSlider({
  label,
  detail,
  value,
  max,
  suffix,
  onChange,
}: {
  label: string;
  detail: string;
  value: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const inputId = `fee-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <label htmlFor={inputId} className="text-sm font-medium">{label}</label>
          <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
        </div>
        <span className="shrink-0 font-mono text-xs tabular-nums">{formatBpsAsPercent(value)}{suffix ?? ""}</span>
      </div>
      <input id={inputId} type="range" min={0} max={max} step={5} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-11 w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-valuetext={`${formatBpsAsPercent(value)}${suffix ?? ""}`} />
      <p className="-mt-1 text-right font-mono text-[11px] text-muted-foreground">Up to {formatBpsAsPercent(max)}{suffix ?? ""}</p>
    </div>
  );
}

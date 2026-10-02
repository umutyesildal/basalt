"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { CreatePreviewDonut } from "@/components/create/create-preview-donut";
import { canScrollDown, distributeWeights, equalWeights, formatAmountEdit, initialAmountDraft, parseCreateAmount } from "@/components/create/concept-create-utils";
import { DISCOVERY_ASSETS, getConceptAsset } from "@/lib/concept-assets";
import { type ConceptBasket, validateConceptBasket } from "@/lib/concept-basket";
import { conceptPreviewHref } from "@/lib/concept-share";
import { formatBpsAsPercent, formatGroupedAmountInput, formatUsd, parseGroupedAmountInput } from "@/lib/format";

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

/* Create storyboard: the step rail and sticky actions stay still.
 * 0ms  New step content is present and usable.
 * 200ms New step content settles 6px upward; selection feedback is immediate.
 * The live donut has its own 200ms weight transition. */
const STEP_ENTER_MS = 200;

const INITIAL_ASSETS = TEMPLATE_OPTIONS[0].assets.map((asset) => ({ ...asset }));

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

export default function ConceptCreate({ initialBasket = null }: { initialBasket?: ConceptBasket | null }) {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState<Step>(initialBasket ? 1 : 0);
  const [hasNavigated, setHasNavigated] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<string | null>(initialBasket ? null : "mega-cap-tech");
  const [assets, setAssets] = useState<SelectedAsset[]>(initialBasket?.assets ?? INITIAL_ASSETS);
  const [search, setSearch] = useState("");
  const [moreAssetsBelow, setMoreAssetsBelow] = useState(false);
  const [amountDraft, setAmountDraft] = useState(initialAmountDraft(initialBasket?.amountUsd ?? 1000));
  const [feesOpen, setFeesOpen] = useState(Boolean(initialBasket && (initialBasket.fees.entryBps || initialBasket.fees.exitBps)));
  const [fees, setFees] = useState<ConceptBasket["fees"]>(initialBasket?.fees ?? { entryBps: 0, exitBps: 0, managementBps: 0 });
  const [name, setName] = useState(initialBasket?.name ?? "Mega-Cap Tech");
  const [thesis, setThesis] = useState(initialBasket?.thesis ?? "");
  const [shareError, setShareError] = useState<string | null>(null);
  const [mixStatus, setMixStatus] = useState("");
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const assetSearchRef = useRef<HTMLInputElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  const catalogContentRef = useRef<HTMLDivElement>(null);
  const scrollButtonRef = useRef<HTMLButtonElement>(null);
  const addStocksButtonRef = useRef<HTMLButtonElement>(null);
  const nextStepFocusRef = useRef<"heading" | "search">("heading");
  const nextMixFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasNavigated) return;
    if (nextStepFocusRef.current === "search") assetSearchRef.current?.focus();
    else stepHeadingRef.current?.focus();
    nextStepFocusRef.current = "heading";
  }, [step, hasNavigated]);

  useEffect(() => {
    const target = nextMixFocusRef.current;
    if (!target || step !== 1) return;
    nextMixFocusRef.current = null;
    if (target === "add-stocks") addStocksButtonRef.current?.focus();
    else document.getElementById(`weight-${target}`)?.focus();
  }, [assets, step]);

  useEffect(() => {
    const catalog = catalogRef.current;
    if (step !== 0 || !catalog) return;
    catalog.scrollTop = 0;
    updateCatalogScroll();
    const observer = new ResizeObserver(updateCatalogScroll);
    observer.observe(catalog);
    if (catalogContentRef.current) observer.observe(catalogContentRef.current);
    return () => observer.disconnect();
  }, [step, search]);

  const parsedAmount = parseCreateAmount(amountDraft, initialBasket?.amountUsd ?? 1000) ?? Number.NaN;
  const amountIsValid = Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount <= 1_000_000;
  const selectedSymbols = useMemo(() => new Set(assets.map((asset) => asset.symbol)), [assets]);
  const matchingAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return DISCOVERY_ASSETS.filter((asset) =>
      !query || asset.symbol.toLowerCase().includes(query) || asset.name.toLowerCase().includes(query) || asset.category.toLowerCase().includes(query),
    );
  }, [search]);

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
      setName("My stock basket");
      setSearch("");
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
    setAmountDraft(formatGroupedAmountInput(value));
  }

  function updateCatalogScroll() {
    const catalog = catalogRef.current;
    if (!catalog) return;
    const more = canScrollDown(catalog);
    if (!more && document.activeElement === scrollButtonRef.current) catalog.focus({ preventScroll: true });
    setMoreAssetsBelow(more);
  }

  function scrollCatalogDown() {
    const catalog = catalogRef.current;
    if (!catalog) return;
    catalog.scrollBy({ top: Math.max(96, catalog.clientHeight * 0.75), behavior: reducedMotion ? "instant" : "smooth" });
  }

  function addStocks() {
    nextStepFocusRef.current = "search";
    setSearch("");
    setMixStatus("");
    goToStep(0);
  }

  function removeFromMix(symbol: string) {
    const index = assets.findIndex((asset) => asset.symbol === symbol);
    const remaining = assets.filter((asset) => asset.symbol !== symbol);
    nextMixFocusRef.current = remaining.length < 2 ? "add-stocks" : remaining[Math.min(index, remaining.length - 1)].symbol;
    setMixStatus(`${symbol} removed. ${remaining.length} ${remaining.length === 1 ? "stock" : "stocks"} remaining.`);
    toggleAsset(symbol);
  }

  function next() {
    if (!canContinue) return;
    if (step < 3) goToStep((step + 1) as Step);
  }

  function goToStep(nextStep: Step) {
    setHasNavigated(true);
    setStep(nextStep);
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
      setShareError(error instanceof Error ? error.message : "Could not create the link. Try again.");
    }
  }

  const stepTitle = ["Pick your stocks", "Set the weights", "Try an amount", "Review and share"][step];
  const stepDescription = [
    "Pick a template, then make it your own.",
    "How much of each stock belongs in your basket?",
    "See the dollar split across your stocks.",
    "Name your basket and check the mix.",
  ][step];

  return (
    <div className="mx-auto w-full max-w-6xl pb-12">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Create a stock basket</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Pick your stocks. Set the mix. Share your basket.
          </p>
        </div>
      </div>

      <nav aria-label="Create steps" className="mb-8">
        <ol className="grid grid-cols-4 gap-2">
          {STEPS.map((label, index) => {
            const complete = index < step;
            const active = index === step;
            return (
              <li key={label} aria-current={active ? "step" : undefined} className="min-w-0">
                <div className={`flex items-center gap-2 border-t-2 pt-3 transition-colors duration-150 motion-reduce:transition-none ${active ? "border-primary" : complete ? "border-primary/55" : "border-border"}`}>
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
        <Card className="min-w-0 overflow-visible">
          <CardHeader className="border-b border-border/70 px-5 py-5 sm:px-7">
            <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display mt-1 scroll-mt-20 text-2xl font-semibold focus:outline-none">{stepTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{stepDescription}</p>
          </CardHeader>
          <CardContent className="px-5 py-6 sm:px-7">
            <motion.div
              key={step}
              className="space-y-7"
              initial={!hasNavigated || reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : STEP_ENTER_MS / 1000, ease: "easeOut" }}
            >
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
                      className={`basalt-choice group flex min-h-32 flex-col justify-between rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeTemplate === "custom" ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-medium">Pick your own stocks</span>
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
                    <h3 className="text-sm font-medium">Your assets <span className="font-mono tabular-nums text-muted-foreground">{assets.length}/20</span></h3>
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
                      ref={assetSearchRef}
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search assets"
                      className="min-h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="relative">
                  <div
                    id="create-asset-catalog"
                    ref={catalogRef}
                    role="region"
                    aria-label="Stocks and ETFs"
                    tabIndex={0}
                    onScroll={updateCatalogScroll}
                    className="max-h-72 overflow-y-auto overscroll-contain rounded-lg p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-h-80"
                  >
                  <div ref={catalogContentRef} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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
                          className={`basalt-choice flex min-h-12 items-center gap-2 rounded-lg border px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-primary/60 bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
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
                  </div>
                  {moreAssetsBelow && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-20 items-end justify-center rounded-b-lg bg-gradient-to-t from-card via-card/80 to-transparent pb-2">
                      <button
                        ref={scrollButtonRef}
                        type="button"
                        aria-controls="create-asset-catalog"
                        aria-label="Scroll down to see more stocks"
                        onClick={scrollCatalogDown}
                        className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-4 text-xs font-medium shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        More stocks <ChevronDown className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  </div>
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
                  <div className="flex flex-wrap gap-2">
                  <Button ref={addStocksButtonRef} type="button" variant="outline" size="sm" className="min-h-11" onClick={addStocks}>
                    <Plus className="size-4" aria-hidden="true" /> Add stocks
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={assets.length < 2} onClick={() => {
                    setActiveTemplate(null);
                    setAssets(assets.map((asset, index) => ({ ...asset, weightBps: equalWeights(assets.length)[index] })));
                  }}>
                    Equal mix
                  </Button>
                  </div>
                </div>
                <p role="status" className="sr-only">{mixStatus}</p>
                {assets.length < 2 && (
                  <p className="rounded-lg border border-border bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                    {assets.length === 1 ? "Add one more stock to continue." : "Add at least two stocks to continue."}
                  </p>
                )}
                {assets.length > 0 && (
                  <>
                    <div className="divide-y divide-border/70 rounded-xl border border-border bg-background">
                      {assets.map((asset, index) => {
                        const info = getConceptAsset(asset.symbol);
                        const dollars = amountIsValid ? (parsedAmount * asset.weightBps) / 10_000 : 0;
                        const max = Math.max(1, 10_000 - (assets.length - 1));
                        return (
                          <div key={asset.symbol} className="px-4 py-4 sm:px-5">
                            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                              <div className="flex min-w-0 items-center gap-3">
                                <AssetLogo symbol={asset.symbol} size={34} />
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">{info?.name ?? asset.symbol}</p>
                                  <p className="font-mono text-xs text-muted-foreground">{asset.symbol}</p>
                                </div>
                              </div>
                              <div className="order-3 col-span-2 flex items-baseline justify-between gap-2 sm:order-2 sm:col-span-1 sm:block sm:text-right">
                                <p className="font-mono text-sm tabular-nums">{formatCompactPercent(asset.weightBps)}</p>
                                <p className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">{formatUsd(dollars)}</p>
                              </div>
                              <button
                                type="button"
                                aria-label={`Remove ${asset.symbol} from basket`}
                                onClick={() => removeFromMix(asset.symbol)}
                                className="order-2 flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:order-3"
                              >
                                <X className="size-4" aria-hidden="true" />
                              </button>
                            </div>
                            <label className="sr-only" htmlFor={`weight-${asset.symbol}`}>Allocation for {asset.symbol}</label>
                            <input
                              id={`weight-${asset.symbol}`}
                              type="range"
                              min={1}
                              max={max}
                              step={1}
                              value={asset.weightBps}
                              disabled={assets.length < 2}
                              onChange={(event) => setAssetWeight(index, Number(event.target.value))}
                              className="h-11 w-full cursor-pointer accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <h3 id="amount-heading" className="text-sm font-medium">Example amount</h3>
                  <div className="mt-4 flex items-center rounded-xl border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring sm:px-4">
                    <span className="font-mono text-lg text-muted-foreground" aria-hidden="true">$</span>
                    <label htmlFor="starting-amount" className="sr-only">Illustrative starting amount in US dollars</label>
                    <input
                      id="starting-amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={amountDraft}
                      onChange={(event) => {
                        const edit = formatAmountEdit(event.target.value, event.target.selectionStart);
                        if (!edit) return;
                        event.target.value = edit.value;
                        event.target.setSelectionRange(edit.caret, edit.caret);
                        setAmountDraft(edit.value);
                      }}
                      onPaste={(event) => {
                        const pasted = event.clipboardData.getData("text");
                        if (pasted.includes(",") && parseGroupedAmountInput(pasted) === null) event.preventDefault();
                      }}
                      aria-invalid={amountIsValid ? undefined : true}
                      aria-describedby={amountIsValid ? undefined : "amount-error"}
                      className={`min-h-16 min-w-0 flex-1 bg-transparent px-2 font-mono tabular-nums outline-none placeholder:text-muted-foreground ${amountDraft.length > 9 ? "text-xl" : "text-2xl"} sm:text-3xl`}
                    />
                    <span className="hidden font-mono text-xs uppercase tracking-wider text-muted-foreground sm:block">USD</span>
                  </div>
                  {!amountIsValid && <p id="amount-error" className="mt-1 text-xs text-destructive">Enter an amount above $0 and up to $1,000,000.</p>}
                  <div className="mt-3 grid grid-cols-3 gap-2" aria-label="Starting amount shortcuts">
                    {[10, 100, 1_000].map((value) => (
                      <Button key={value} type="button" variant={parsedAmount === value ? "secondary" : "outline"} className="min-h-11" aria-pressed={parsedAmount === value} onClick={() => setAmount(value)}>
                        {formatUsd(value, { maximumFractionDigits: 0 })}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4 border-t border-border/70 pt-5">
                  <FeeSlider label="Management fee" detail="A yearly fee on your basket’s value, paid in basket shares when investing opens." value={fees.managementBps} max={300} suffix="/ year" onChange={(value) => setFees((current) => ({ ...current, managementBps: value }))} />
                  <p className="text-xs leading-5 text-muted-foreground">Future fee shares: <span className="font-mono tabular-nums">90%</span> to you, <span className="font-mono tabular-nums">10%</span> to Basalt.</p>
                  <div className="border-t border-border/70 pt-4">
                  <button
                    type="button"
                    aria-expanded={feesOpen}
                    aria-controls="create-secondary-fees"
                    onClick={() => setFeesOpen((open) => !open)}
                    className="flex min-h-11 w-full items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block text-sm font-medium">Entry and exit fees</span>
                    </span>
                    <span className="flex shrink-0 items-center justify-end gap-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                      {formatCompactPercent(fees.entryBps)} / {formatCompactPercent(fees.exitBps)} <ChevronDown className={`size-4 transition-transform motion-reduce:transition-none ${feesOpen ? "rotate-180" : ""}`} aria-hidden="true" />
                    </span>
                  </button>
                  {feesOpen && (
                    <div id="create-secondary-fees" className="mt-4 space-y-4 rounded-xl border border-border bg-background p-4">
                      <FeeSlider label="Entry fee" detail="Rate for joining the basket." value={fees.entryBps} max={300} onChange={(value) => setFees((current) => ({ ...current, entryBps: value }))} />
                      <FeeSlider label="Exit fee" detail="Rate for leaving the basket." value={fees.exitBps} max={100} onChange={(value) => setFees((current) => ({ ...current, exitBps: value }))} />
                    </div>
                  )}
                  </div>
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
                    placeholder="e.g. My tech basket"
                    className="min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div>
                  <label htmlFor="basket-thesis" className="mb-1.5 block text-sm font-medium">Why these stocks? <span className="font-normal text-muted-foreground">(optional)</span></label>
                  <textarea
                    id="basket-thesis"
                    rows={3}
                    maxLength={240}
                    value={thesis}
                    onChange={(event) => setThesis(event.target.value)}
                    placeholder="What connects these companies?"
                    className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2.5 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <p className="mt-1 text-right font-mono text-xs tabular-nums text-muted-foreground">{thesis.length}/240</p>
                </div>

                <div className="lg:hidden">
                  <LiveSummary basket={currentBasket} />
                </div>

                {!validation.ok && <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{validation.errors[0]}</p>}
                {shareError && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{shareError}</p>}

              </section>
            )}
            </motion.div>
          </CardContent>
          <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-b-xl border-t border-border/70 bg-card/95 px-5 py-4 shadow-[0_-12px_30px_-20px_rgba(0,0,0,0.7)] backdrop-blur sm:px-7 md:bottom-0">
            <Button type="button" variant="outline" className="min-h-11 min-w-0 flex-1 px-2 sm:min-w-24 sm:flex-none sm:px-2.5" disabled={step === 0} onClick={() => goToStep((step - 1) as Step)}>
              <ArrowLeft className="hidden size-4 sm:block" aria-hidden="true" /> Back
            </Button>
            {step < 3 ? (
              <Button type="button" className="min-h-11 min-w-0 flex-1 px-2 sm:min-w-32 sm:flex-none sm:px-2.5" disabled={!canContinue} onClick={next}>
                Continue <ArrowRight className="hidden size-4 sm:block" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="button" className="min-h-11 min-w-0 flex-1 px-2 sm:min-w-40 sm:flex-none sm:px-2.5" disabled={!validation.ok || !amountIsValid} onClick={createPreview}>
                Share basket <ArrowRight className="hidden size-4 sm:block" aria-hidden="true" />
              </Button>
            )}
          </div>
        </Card>

        <aside className="hidden lg:block lg:sticky lg:top-6" aria-label="Live basket summary">
          <LiveSummary basket={currentBasket} />
        </aside>
      </div>

      {step !== 3 && <div className="mt-5 lg:hidden">
        <LiveSummary basket={currentBasket} />
      </div>}

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
      className={`basalt-choice flex min-h-32 flex-col rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-4 ${selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/40"}`}
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
          <h2 className="font-display mt-1 truncate text-lg font-semibold">{basket.name || "Your basket"}</h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex justify-center py-2">
          <div role="img" aria-label={`Allocation chart with ${basket.assets.length} ${basket.assets.length === 1 ? "asset" : "assets"}, total ${formatBpsAsPercent(total)}`}>
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
                  <span className="min-w-16 shrink-0 whitespace-nowrap text-right font-mono text-xs tabular-nums">{formatUsd(amount)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">Choose two or more assets to see your mix.</p>
        )}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">Example amount</span>
          <span className="font-mono text-sm font-medium tabular-nums">{basket.amountUsd > 0 ? formatUsd(basket.amountUsd) : "Not set"}</span>
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
  return `Management ${formatCompactPercent(fees.managementBps)}/yr · entry ${formatCompactPercent(fees.entryBps)} · exit ${formatCompactPercent(fees.exitBps)}`;
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

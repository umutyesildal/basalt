"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { XStockLogo } from "@/components/xstocks/xstock-logo";
import { formatNumber, formatUsd } from "@/lib/format";
import { XSTOCK_SNAPSHOT, fetchXStockCatalog, fetchXStockPricePage, filterXStocks, mergeXStockQuotes, sortXStocksForDiscovery, type XStockCatalog, type XStockQuote, type XStockMarketSession } from "@/lib/xstock-catalog";

const PAGE_SIZE = 24;
const CONTROL = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text disabled:cursor-not-allowed disabled:opacity-40";

export function XStockCatalogGrid({ assetClass = "all" }: { assetClass?: "all" | "etf" }) {
  const [catalog, setCatalog] = useState<XStockCatalog>(XSTOCK_SNAPSHOT);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [quotes, setQuotes] = useState<Map<string, XStockQuote>>(new Map());
  const [pricesLoading, setPricesLoading] = useState(true);
  const marketSessionRef = useRef<XStockMarketSession | null>(null);
  const [refresh, setRefresh] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const firstCardRef = useRef<HTMLAnchorElement>(null);
  const focusPage = useRef(false);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    fetchXStockCatalog(refresh > 0).then((value) => { if (active) { setCatalog(value); setCatalogLoading(false); } });
    return () => { active = false; };
  }, [refresh]);

  const matching = useMemo(() => filterXStocks(sortXStocksForDiscovery(catalog.data), query, assetClass), [catalog.data, query, assetClass]);
  const totalPages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const visible = matching.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const mintKey = visible.map((asset) => asset.mint).join(",");

  useEffect(() => {
    const controller = new AbortController();
    const mints = mintKey ? mintKey.split(",") : [];
    setQuotes(previous => new Map(mints.flatMap(mint => previous.has(mint) ? [[mint, previous.get(mint)!] as const] : [])));
    let running = false;
    async function update() {
      if (running || controller.signal.aborted || !mints.length) return;
      running = true;
      setPricesLoading(true);
      try {
        const result = await fetchXStockPricePage(mints, controller.signal);
        if (!controller.signal.aborted) {
          setQuotes(previous => mergeXStockQuotes(previous, result.data));
          if (result.marketSession) { marketSessionRef.current = result.marketSession; }
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) setPricesLoading(false);
      }
    }
    if (mints.length) void update();
    else setPricesLoading(false);
    function canPoll() {
      const session = marketSessionRef.current;
      return session?.status !== "closed" || !!session.nextOpenAt && Date.now() >= Date.parse(session.nextOpenAt);
    }
    const timer = window.setInterval(() => { if (!document.hidden && canPoll()) void update(); }, 60_000);
    const onVisible = () => { if (!document.hidden && canPoll()) void update(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mintKey, refresh]);

  useEffect(() => {
    if (focusPage.current) { firstCardRef.current?.focus(); focusPage.current = false; }
  }, [currentPage]);

  const label = assetClass === "etf" ? "ETFs" : "assets";
  const countLabel = matching.length === 1 ? (assetClass === "etf" ? "ETF" : "asset") : label;

  function changePage(next: number) { focusPage.current = true; setPage(next); }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <label htmlFor={`xstocks-search-${assetClass}`} className="sr-only">Search {label} by name, ticker or mint</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input ref={searchRef} id={`xstocks-search-${assetClass}`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search name, ticker or Solana mint" className="min-h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text" />
        </div>
        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">{formatNumber(matching.length)} {countLabel}</span>
          <button type="button" onClick={() => setRefresh((value) => value + 1)} disabled={catalogLoading || pricesLoading} className={CONTROL} aria-label="Refresh catalog and prices"><RefreshCw className="size-4" aria-hidden="true" /><span>Refresh</span></button>
        </div>
      </div>

      {matching.length === 0 ? <Card className="items-center gap-3 px-5 py-10 text-center"><h2 className="font-display text-xl">No matching {label}</h2><p className="text-sm text-muted-foreground">Try a company name, ticker or Solana mint.</p><button type="button" className={CONTROL} onClick={() => { setQuery(""); setPage(0); searchRef.current?.focus(); }}>Clear search</button></Card> : <div data-xstocks-catalog data-count={matching.length} data-visible-count={visible.length} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visible.map((asset, index) => {
          const quote = quotes.get(asset.mint);
          const price = quote?.priceUsd ?? null;
          return <Card key={asset.mint}><Link ref={index === 0 ? firstCardRef : undefined} href={`/stock/${encodeURIComponent(asset.symbol)}`} className="flex h-full min-w-0 flex-col p-4 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-text" aria-label={`View ${asset.name}`}>
            <div className="flex items-center gap-3"><XStockLogo asset={asset} size={36} /><div className="min-w-0 flex-1"><h2 className="truncate font-mono text-sm font-medium" title={asset.symbol}>{asset.symbol}</h2><p className="mt-1 truncate text-xs text-muted-foreground" title={asset.name}>{asset.name.replace(/ xStock$/i, "")}</p></div><ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /></div>
            <div className="mt-4 flex items-baseline justify-between gap-2"><span className="font-mono text-xl tabular-nums">{formatUsd(price)}</span><span className="text-right text-xs text-muted-foreground">{asset.status === "halted" ? "Trading halted" : asset.assetClass === "etf" ? "ETF" : "xStock"}</span></div>
          </Link></Card>;
        })}
      </div>}

      {totalPages > 1 && <nav aria-label="Catalog pages" className="flex items-center justify-between gap-3 border-t border-border pt-4"><button type="button" className={CONTROL} disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}><ArrowLeft size={16} aria-hidden="true" />Previous</button><span className="font-mono text-xs text-muted-foreground">{formatNumber(currentPage + 1)} / {formatNumber(totalPages)}</span><button type="button" className={CONTROL} disabled={currentPage + 1 >= totalPages} onClick={() => changePage(currentPage + 1)}>Next<ArrowRight size={16} aria-hidden="true" /></button></nav>}
    </div>
  );
}

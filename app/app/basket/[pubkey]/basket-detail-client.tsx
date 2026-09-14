"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ThesisComposerModal } from "@/components/social/thesis-composer";

import {
  EmptyState,
  ErrorState,
  Skeleton,
  TableRowSkeleton,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeLinks } from "@/components/ui/range-links";
import {
  ApiError,
  fetchBasketDetail,
  fetchBasketPerformance,
  fetchMintTickers,
  fetchNavHistory,
  fetchSpy24h,
  numericToNumber,
  type BasketDetail,
  type NavHistoryRow,
} from "@/components/basket/basket-api";
import { BasketPageAbout } from "@/components/basket/basket-page-about";
import { BasketPageBreadcrumb } from "@/components/basket/basket-page-breadcrumb";
import { FadeUpOnKey } from "@/components/basket/basket-page-fade-up";
import {
  BasketPageHistory,
  NAV_RANGES,
  type NavRangeKey,
} from "@/components/basket/basket-page-history";
import { BasketPageRisk } from "@/components/basket/basket-page-risk";
import { BasketPageTheses } from "@/components/basket/basket-page-theses";
import { BasketPageTradeRail } from "@/components/basket/basket-page-trade-rail";
import { IconCopyButton as CopyButton } from "@/components/ui/copy-button";
import { ChangeValue } from "@/components/stocks/change-value";
import { formatAsOf, formatTokenAmount, formatUsd, truncateAddress } from "@/lib/format";
import { formatRawShares6 } from "@/components/basket/basket-math";

type SectionTab = "about" | "history" | "risk" | "thesis";

const SECTION_TABS: { value: SectionTab; label: string }[] = [
  { value: "about", label: "About" },
  { value: "history", label: "History" },
  { value: "risk", label: "Risk" },
  { value: "thesis", label: "Thesis" },
];

const MAX_COMPOSITION_PARTS = 4;

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaObj(mj: unknown): Record<string, unknown> | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
}

/**
 * Basket detail — client body of the detail page (the route's server component
 * owns SEO metadata). Name-first header, metric strip, then a two-column
 * layout: tabbed sections on the left (About — composition + copyable mints +
 * holdings + fees; History — share-price chart with on-chain event markers;
 * Risk — static protocol-level method & risks; Thesis — posts linked to this
 * basket), and a sticky trade rail on the right (buy/redeem stay reachable
 * from every tab, the Cesto-style invest-panel pattern — forms remain on
 * their own routes). All figures are API-driven; missing data renders as an
 * em dash or a quiet centered note, never a fabricated value.
 */
export default function BasketDetailClient({
  pubkey,
}: {
  pubkey: string;
}) {
  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [thesisOpen, setThesisOpen] = useState(false);
  const [navRows, setNavRows] = useState<NavHistoryRow[] | null>(null);
  const [navSource, setNavSource] = useState<string | null>(null);
  const [navFailed, setNavFailed] = useState(false);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [spy24h, setSpy24h] = useState<number | null>(null);
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());
  const [range, setRange] = useState<NavRangeKey>("All");
  const [tab, setTab] = useState<SectionTab>("about");
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Detail is load-bearing — it alone decides page status.
  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    setErrorInfo(null);

    async function load() {
      try {
        const loaded = await fetchBasketDetail(pubkey, controller.signal);
        setDetail(loaded);
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof ApiError && err.status === 404) {
          setStatus("not-found");
          return;
        }
        setErrorInfo({
          message: err instanceof Error ? err.message : "Could not reach the basket API.",
          code: err instanceof ApiError ? err.code : undefined,
        });
        setStatus("error");
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  // NAV series for the selected range (raw snapshots, date_bin bucketing only).
  useEffect(() => {
    const controller = new AbortController();
    setNavRows(null);
    setNavFailed(false);

    async function load() {
      const selected = NAV_RANGES.find((r) => r.key === range) ?? NAV_RANGES[NAV_RANGES.length - 1];
      try {
        const res = await fetchNavHistory(pubkey, controller.signal, {
          from: selected.fromHours !== null ? new Date(Date.now() - selected.fromHours * 3600_000) : undefined,
          interval: selected.interval ?? undefined,
        });
        setNavRows(res.rows);
        setNavSource(res.source);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setNavRows([]);
        setNavFailed(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [pubkey, range, reloadKey]);

  // Optional context — 24h return, SPY benchmark, whitelist tickers. Any
  // failure degrades its metric to an em dash; never blocks the page.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      const [perfRes, spyRes, tickersRes] = await Promise.allSettled([
        fetchBasketPerformance(pubkey, controller.signal),
        fetchSpy24h(controller.signal),
        fetchMintTickers(controller.signal),
      ]);
      if (perfRes.status === "fulfilled") setChange24h(perfRes.value.change24hPct);
      if (spyRes.status === "fulfilled") setSpy24h(spyRes.value);
      if (tickersRes.status === "fulfilled") setMintTickers(tickersRes.value);
    }

    void load().catch(() => {
      // Aborts racing unmount — optional panels keep their defaults.
    });
    return () => controller.abort();
  }, [pubkey, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // ---- derived metrics (honest: null renders as an em dash) ----
  const sharePrice = numericToNumber(detail?.nav?.sharePrice ?? null);
  const nav = numericToNumber(detail?.nav?.value ?? null);
  const supply = detail?.nav?.supply ?? null;
  const asOf = detail?.nav?.asOf ?? detail?.asOf ?? null;
  const weights = detail?.weights_bps ?? [];
  const lastAccrualSeconds = numericToNumber(detail?.last_fee_accrual_ts ?? null);
  const secondsSinceAccrual =
    lastAccrualSeconds !== null && lastAccrualSeconds > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastAccrualSeconds)
      : null;

  // Name-first identity, same resolution order as the /explore cards.
  const composition = useMemo(() => {
    if (!detail) return null;
    const parts: string[] = [];
    detail.constituents.forEach((mint, i) => {
      const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
      const bps = weights[i];
      parts.push(bps !== undefined ? `${ticker} ${Math.round(bps / 100)}` : ticker);
    });
    if (parts.length === 0) return null;
    const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
    return parts.length > MAX_COMPOSITION_PARTS
      ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
      : shown;
  }, [detail, mintTickers, weights]);

  const name = useMemo(() => {
    const n = metaObj(detail?.metadata_json)?.name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }, [detail]);

  const headline = name ?? composition ?? truncateAddress(pubkey, 6, 6);
  const vsSpy = change24h !== null && spy24h !== null ? change24h - spy24h : null;

  return (
    <div className="space-y-8">
      <BasketPageBreadcrumb pubkey={pubkey} name={name} />

      {status === "loading" ? <DetailSkeleton /> : null}

      {status === "not-found" ? (
        <EmptyState
          chip="NOT INDEXED"
          title="This basket is not indexed"
          description={`The backend has no basket ${truncateAddress(pubkey, 6, 6)} — baskets only appear here after a create_basket transaction is indexed. Nothing is fabricated to fill the page.`}
          action={
            <Button render={<Link href="/explore" />} size="sm">
              Back to explore
            </Button>
          }
        />
      ) : null}

      {status === "error" ? (
        <ErrorState
          title="Basket detail unavailable"
          message={
            errorInfo
              ? `${errorInfo.code ? `${errorInfo.code}: ` : ""}${errorInfo.message}`
              : "Could not reach the basket API."
          }
          onRetry={retry}
        />
      ) : null}

      {status === "ready" && detail ? (
        <>
          {/* identity header */}
          <div className="min-w-0 space-y-1.5">
            <h1 className="font-display text-3xl font-semibold tracking-tight" title={detail.pubkey}>
              {headline}
            </h1>
            {name && composition ? (
              <p className="font-mono text-xs tabular-nums text-muted-foreground">{composition}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span className="whitespace-nowrap">
                {truncateAddress(detail.pubkey, 6, 6)} · creator{" "}
                {truncateAddress(detail.creator, 4, 4)} · created {formatAsOf(detail.created_at)}
              </span>
              <CopyButton value={detail.pubkey} label="Copy basket address" showCopiedText={false} />
            </div>
          </div>

          {/* metric strip */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>Share price</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums text-glow">
                  {sharePrice !== null ? formatUsd(sharePrice) : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>AUM</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  {nav !== null ? formatUsd(nav, { maximumFractionDigits: 0 }) : "—"}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription>24h</CardDescription>
                <CardTitle className="font-mono text-2xl tabular-nums">
                  <ChangeValue changePct={change24h} className="text-2xl" />
                </CardTitle>
              </CardHeader>
            </Card>
            {vsSpy !== null ? (
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardDescription>vs SPY 24h</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {vsSpy >= 0 ? "+" : ""}
                    {vsSpy.toFixed(2)}%
                  </CardTitle>
                </CardHeader>
              </Card>
            ) : (
              <Card className="h-full">
                <CardHeader className="pb-2">
                  <CardDescription>Share supply</CardDescription>
                  <CardTitle className="font-mono text-2xl tabular-nums">
                    {supply !== null && /^\d+$/.test(supply.trim())
                      ? formatTokenAmount(Number(formatRawShares6(BigInt(supply.trim()))), {
                          maximumFractionDigits: 0,
                        })
                      : "—"}
                  </CardTitle>
                </CardHeader>
              </Card>
            )}
          </div>

          {/* tabbed sections + sticky trade rail */}
          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
            <div className="min-w-0">
              <div className="border-b border-border pb-3">
                <RangeLinks
                  options={SECTION_TABS}
                  value={tab}
                  onChange={setTab}
                  label={null}
                  ariaLabel="Basket sections"
                />
              </div>

              <FadeUpOnKey activeKey={tab} className="pt-6">
                {tab === "about" ? <BasketPageAbout detail={detail} mintTickers={mintTickers} /> : null}
                {tab === "history" ? (
                  <BasketPageHistory
                    pubkey={detail.pubkey}
                    navRows={navRows}
                    navSource={navSource}
                    navFailed={navFailed}
                    asOf={asOf}
                    range={range}
                    onRangeChange={setRange}
                  />
                ) : null}
                {tab === "risk" ? <BasketPageRisk /> : null}
                {tab === "thesis" ? (
                  <BasketPageTheses
                    pubkey={detail.pubkey}
                    onWriteThesis={() => setThesisOpen(true)}
                  />
                ) : null}
              </FadeUpOnKey>
            </div>

            {/* sticky trade rail — buy/redeem stay visible from every tab */}
            <BasketPageTradeRail
              detail={detail}
              secondsSinceAccrual={secondsSinceAccrual}
              onWriteThesis={() => setThesisOpen(true)}
            />
          </div>
        </>
      ) : null}

      <ThesisComposerModal
        open={thesisOpen}
        onClose={() => setThesisOpen(false)}
        basket={detail?.pubkey ?? null}
        basketLabel={name ?? undefined}
      />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true">
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["Share price", "AUM", "24h", "Supply"].map((label) => (
          <div key={label} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <TableRowSkeleton rows={4} columns={5} label="Loading basket" />
        </div>
      </div>
    </div>
  );
}

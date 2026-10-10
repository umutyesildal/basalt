"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

import { EmptyState, ErrorState, FreshnessBadge, Skeleton } from "@/components/states";
import { WalletButton } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { LegalReviewTag } from "@/components/create";
import { PortfolioPositionCard } from "@/components/portfolio/position-card";
import { formatUsd, prettyTicker, truncateAddress } from "@/lib/format";
import { apiFetch } from "@/lib/api-client";
import { fetchMintTickers } from "@/components/basket/basket-api";
import { parsePortfolioData, portfolioCoverageMessage, portfolioEmptyState, type PortfolioData, type PortfolioPosition } from "@/lib/portfolio-data";

type Numeric = string | number | null | undefined;

/** Basket list-feed row — optional identity and composition enrichment. */
interface ConstituentLike {
  ticker?: unknown;
  symbol?: unknown;
  name?: unknown;
  mint?: unknown;
  weight?: unknown;
  weight_bps?: unknown;
  weightBps?: unknown;
  weight_pct?: unknown;
  weightPct?: unknown;
}

interface BasketRow {
  pubkey: string;
  metadata_json?: string | Record<string, unknown> | null;
  constituents?: (ConstituentLike | string)[] | null;
  weights_bps?: Numeric[] | null;
}

function num(v: Numeric): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function metaObj(mj: BasketRow["metadata_json"]): Record<string, unknown> | null {
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

function nameOf(b: BasketRow): string | null {
  const name = metaObj(b.metadata_json)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function constituentTicker(c: ConstituentLike): string | null {
  for (const key of [c.ticker, c.symbol]) {
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
  if (typeof c.mint === "string" && c.mint) return truncateAddress(c.mint, 4, 4);
  return null;
}

function constituentWeightPct(c: ConstituentLike): number | null {
  const pct = num(c.weight_pct as Numeric) ?? num(c.weightPct as Numeric);
  if (pct !== null) return pct;
  const bps = num(c.weight_bps as Numeric) ?? num(c.weightBps as Numeric);
  if (bps !== null) return bps / 100;
  const w = num(c.weight as Numeric);
  if (w === null) return null;
  return w <= 100 ? w : w / 100;
}

const MAX_COMPOSITION_PARTS = 4;

/** Composition string, e.g. "AAPLx 50 · TSLAx 50" (same rule as /explore). */
function compositionOf(b: BasketRow, mintTickers: Map<string, string>): string | null {
  const parts: string[] = [];
  const rawList = Array.isArray(b.constituents) ? b.constituents : null;
  if (rawList && rawList.length > 0) {
    const weights = Array.isArray(b.weights_bps) ? b.weights_bps : null;
    rawList.forEach((c, i) => {
      const mint = typeof c === "string" ? c : typeof c.mint === "string" ? c.mint : null;
      const ticker =
        (typeof c === "object" && c !== null ? constituentTicker(c) : null) ??
        (mint ? mintTickers.get(mint) ?? null : null) ??
        (mint ? truncateAddress(mint, 4, 4) : null);
      if (!ticker) return;
      const bps = weights ? num(weights[i]) : null;
      parts.push(bps !== null ? `${ticker} ${Math.round(bps / 100)}` : ticker);
    });
  } else {
    let list: ConstituentLike[] | null = null;
    const metaConstituents = metaObj(b.metadata_json)?.constituents;
    if (Array.isArray(metaConstituents)) list = metaConstituents as ConstituentLike[];
    for (const c of list ?? []) {
      const ticker = constituentTicker(c);
      if (!ticker) continue;
      const weight = constituentWeightPct(c);
      parts.push(weight !== null ? `${ticker} ${Math.round(weight)}` : ticker);
    }
  }
  if (parts.length === 0) return null;
  const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
  return parts.length > MAX_COMPOSITION_PARTS
    ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
    : shown;
}

/** Card-shaped skeleton — same block as a loaded position card. */
function PositionCardSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-1.5 h-3 w-40" />
      <Skeleton className="mt-4 h-7 w-24" />
      <Skeleton className="mt-1.5 h-3 w-32" />
      <Skeleton className="mt-6 h-3 w-full" />
    </div>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

interface PositionCardProps {
  position: PortfolioPosition;
  meta: BasketRow | null;
  mintTickers: Map<string, string>;
}

/** Basket metadata enriches identity only; financial values come from row evidence. */
function PositionCard({ position, meta, mintTickers }: PositionCardProps) {
  const name = meta ? nameOf(meta) : null;
  const composition = meta ? compositionOf(meta, mintTickers) : null;
  return <PortfolioPositionCard position={position}
    headline={name ?? composition ?? truncateAddress(position.basket, 6, 4)}
    composition={name ? composition : null} />;
}

/**
 * Portfolio — wallet-gated positions from GET /api/v1/users/:pubkey/portfolio.
 * Same visual family as /explore: position cards, mono tabular numerics, and
 * honest states (no wallet, empty, indexer down). Nothing is fabricated.
 */
export default function PortfolioPage() {
  const { publicKey, connected } = useWallet();

  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [portfolio, setPortfolio] = useState<PortfolioData>(() => parsePortfolioData(null));
  const { positions, source, asOf, totalValue } = portfolio;
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Optional enrichment from the basket list feed + whitelist — used for card
  // names and composition only. Failures degrade quietly.
  const [basketMeta, setBasketMeta] = useState<Map<string, BasketRow>>(new Map());
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!publicKey) {
      setPortfolio(parsePortfolioData(null));
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const wallet = publicKey.toBase58();
    setStatus("loading");
    setPortfolio(parsePortfolioData(null));
    setError(null);

    async function run() {
      try {
        const res = await apiFetch(
          `/api/v1/users/${encodeURIComponent(wallet)}/portfolio`,
          { signal: controller.signal, cache: "no-store" },
        );
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setPortfolio(parsePortfolioData(null));
          setStatus("error");
          setError(
            payload?.error?.message ??
              `Indexed positions are unavailable (HTTP ${res.status}).`,
          );
          return;
        }
        setPortfolio(parsePortfolioData(payload));
        setStatus("ready");
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
        setPortfolio(parsePortfolioData(null));
        setStatus("error");
        setError(
          err instanceof Error
            ? err.message
            : "The portfolio API did not respond. The indexer is convenience only — redeem still works on-chain.",
        );
      }
    }

    void run();
    return () => controller.abort();
  }, [publicKey, reloadKey]);

  // Keep the page honest if the wallet disconnects mid-session.
  useEffect(() => {
    if (!connected) setStatus("idle");
  }, [connected]);

  // Whitelist mint→ticker map (composition strings) — fetched once, optional.
  useEffect(() => {
    const controller = new AbortController();

    async function loadTickers() {
      try {
        const map = await fetchMintTickers(controller.signal);
        if (!controller.signal.aborted) setMintTickers(map);
      } catch {
        // composition falls back to metadata name / mint fragments
      }
    }

    void loadTickers();
    return () => controller.abort();
  }, []);

  // Basket list feed — enrichment map keyed by basket pubkey. Only rows we
  // hold a position in matter, but the feed is paginated plainly, so take the
  // standard list and index it.
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();

    async function loadBaskets() {
      try {
        const res = await apiFetch("/api/v1/baskets?limit=100", {
          signal: controller.signal,
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { data?: BasketRow[] };
        const map = new Map<string, BasketRow>();
        for (const row of payload.data ?? []) {
          if (typeof row?.pubkey === "string" && row.pubkey) map.set(row.pubkey, row);
        }
        setBasketMeta(map);
      } catch {
        // cards fall back to pubkey headlines — no enrichment, no fabrication
      }
    }

    void loadBaskets();
    return () => controller.abort();
  }, [connected]);

  const metaFor = useCallback(
    (pubkey: string) => basketMeta.get(pubkey) ?? null,
    [basketMeta],
  );

  if (!connected || !publicKey) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Basket share positions held by the connected wallet.
          </p>
        </div>
        <EmptyState
          className="mt-6"
          chip="NO WALLET"
          title="No wallet connected"
          description="Positions are read from your wallet's basket share balances as indexed by the backend — nothing is shown until a wallet is connected."
          action={<WalletButton />}
          previewLabel="Layout preview — position cards"
          preview={
            <CardGrid>
              {Array.from({ length: 2 }, (_, i) => (
                <PositionCardSkeleton key={i} />
              ))}
            </CardGrid>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h1 className="font-display text-3xl font-semibold tracking-tight">Portfolio</h1>
          <p className="max-w-2xl font-mono text-xs tabular-nums text-muted-foreground">
            {truncateAddress(publicKey.toBase58(), 6, 6)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {source && <FreshnessBadge source={source} asOf={asOf ?? undefined} />}
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={status === "loading"}
          >
            Refresh
          </Button>
        </div>
      </div>

      {status === "loading" && (
        <div role="status" aria-label="Loading positions" className="mt-6">
          <span className="sr-only">Loading positions</span>
          <CardGrid>
            {Array.from({ length: 4 }, (_, i) => (
              <PositionCardSkeleton key={i} />
            ))}
          </CardGrid>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6">
          <ErrorState
            title="Positions unavailable"
            message={error ?? "The portfolio API did not respond."}
            onRetry={load}
          />
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            The indexer is convenience only — mint and redeem still work directly
            against the on-chain programs.
          </p>
        </div>
      )}

      {status === "ready" && positions.length === 0 && (
        <EmptyState className="mt-6" {...portfolioEmptyState(portfolio)} />
      )}

      {status === "ready" && positions.length > 0 && (
        <div className="mt-6 space-y-3">
          {/* Missing coverage or unpriced positions withhold the aggregate. */}
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Total value (reference)
              </span>
              <span
                className={`font-mono text-2xl font-semibold tabular-nums ${
                  totalValue !== null ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {totalValue !== null ? formatUsd(totalValue) : "—"}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                Positions
              </span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
                {positions.length}
              </span>
            </div>
          </div>

          <p className="text-xs leading-5 text-muted-foreground">
            {portfolioCoverageMessage(portfolio)}
            {portfolio.withheldPositions > 0 && " Unverified position records are hidden while their history is checked."}
          </p>

          <CardGrid>
            {positions.map((position) => (
              <PositionCard
                key={position.basket}
                position={position}
                meta={metaFor(position.basket)}
                mintTickers={mintTickers}
              />
            ))}
          </CardGrid>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 text-xs leading-5 text-muted-foreground">
        <p>
          Finalized snapshots verify current raw balances, not transaction history,
          acquisition costs or returns. Shares use six decimals. Indexed USD values
          require eligible current prices and remain references, not quotes.{" "}
          <LegalReviewTag />
        </p>
      </div>
    </div>
  );
}

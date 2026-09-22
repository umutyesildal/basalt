"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  EmptyState,
  ErrorState,
  FreshnessBadge,
  Skeleton,
} from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { ThesisShareCta } from "@/components/social/thesis-share-cta";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { useAltPrewarm } from "@/components/basket/use-alt-prewarm";
import { AccrueCrankButton } from "@/components/basket/accrue-crank";
import { HalfMaxButtons, halfOfRaw } from "@/components/basket/basket-page-half-max";
import { TradeFeePreview } from "@/components/basket/basket-page-fee-preview";
import {
  bpsToPct,
  grouped,
  SummaryRow,
  TxSummaryCard,
} from "@/components/basket/summary-card";
import { computeRedeemPreview, formatRawShares6, parseShareAmount6 } from "@/components/basket/basket-math";
import {
  ApiError,
  fetchBasketDetail,
  fetchMintTickers,
  numericToNumber,
  type BasketDetail,
} from "@/components/basket/basket-api";
import {
  buildRedeemInKind,
  buildRedeemInKindTransaction,
  deriveAta,
  type BasketCoreKeys,
  type ExpectedAccount,
} from "@/lib/transactions";
import { formatBpsAsPercent, formatUsd, scaledFromRaw, truncateAddress } from "@/lib/format";
import { withRetryOnce } from "@/lib/rpc-retry";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";

const MAX_COMPOSITION_PARTS = 4;

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaName(mj: unknown): string | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const n = (obj as Record<string, unknown>).name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * Redeem — burns basket shares and returns the underlying pro-rata, floored to
 * the raw token unit. The on-chain instruction is permissionless and
 * oracle-free: no whitelist, no pause, no backend account participates. This
 * page only previews and submits; it never gates redeem on any of them.
 */
export default function RedeemPage({ params }: { params: Promise<{ pubkey: string }> }) {
  const { pubkey: rawPubkey } = use(params);
  const pubkey = decodeURIComponent(rawPubkey);

  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();

  const [detail, setDetail] = useState<BasketDetail | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "not-found" | "error">("loading");
  const [errorInfo, setErrorInfo] = useState<{ message: string; code?: string } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sharesInput, setSharesInput] = useState("");
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [shareBalanceLoading, setShareBalanceLoading] = useState(true);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [mintTickers, setMintTickers] = useState<Map<string, string>>(new Map());

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

  // Optional ticker context for the composition line — degrades to truncated mints.
  useEffect(() => {
    const controller = new AbortController();
    fetchMintTickers(controller.signal)
      .then(setMintTickers)
      .catch(() => setMintTickers(new Map()));
    return () => controller.abort();
  }, [reloadKey]);

  const refreshShareBalance = useCallback(async () => {
    if (!publicKey || !detail) {
      setShareBalanceLoading(false);
      return;
    }
    setShareBalanceLoading(true);
    try {
      // Background page read: one calm retry through the shared loop before
      // the inline "no share ATA" fallback — never a hard failure surface.
      const res = await withRetryOnce(
        () =>
          connection.getTokenAccountBalance(
            deriveAta(publicKey, new PublicKey(detail.share_mint)),
          ),
        "share balance read",
      );
      setShareBalance(BigInt(res.value.amount));
    } catch {
      setShareBalance(null); // no share ATA — user holds no position
    } finally {
      setShareBalanceLoading(false);
    }
  }, [connection, detail, publicKey]);

  useEffect(() => {
    void refreshShareBalance();
  }, [refreshShareBalance]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // holdings aligned to constituents; supply from the latest NAV snapshot
  const vaultBalances = useMemo<(bigint | null)[]>(() => {
    if (!detail) return [];
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h.raw_amount]));
    return detail.constituents.map((mint) => {
      const raw = byMint.get(mint);
      return raw && /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
    });
  }, [detail]);

  const supply = useMemo(() => {
    const raw = detail?.nav?.supply;
    return raw && /^\d+$/.test(raw.trim()) ? BigInt(raw.trim()) : null;
  }, [detail?.nav?.supply]);

  const shares = parseShareAmount6(sharesInput);
  // The amount and snapshot preview remain visible before wallet connection.
  const sharesExceedBalance =
    connected && !shareBalanceLoading && shares !== null && (shareBalance ?? 0n) < shares;
  const preview =
    shares !== null && shares > 0n && supply !== null && !vaultBalances.some((v) => v === null)
      ? computeRedeemPreview(vaultBalances as bigint[], supply, shares, detail?.exit_fee_bps ?? 0)
      : null;

  // NAV reference estimate: burn / supply × latest NAV (marked as estimate).
  const nav = numericToNumber(detail?.nav?.value ?? null);
  const usdEstimate =
    preview && supply !== null && nav !== null && supply > 0n
      ? (Number(preview.burn) / Number(supply)) * nav
      : null;

  // Compact fee preview under the input — needs only the typed amount and the
  // basket's immutable exit bps, never a fabricated figure: hidden while the
  // input is empty/invalid or already tripping the balance check.
  const feePreviewRows =
    detail !== null && shares !== null && shares > 0n && !sharesExceedBalance
      ? (() => {
          // Spec §5.3: exitFee = floor(B × bps / 10_000), burn = B − exitFee.
          const exitFee = (shares * BigInt(detail.exit_fee_bps)) / 10000n;
          const burn = shares - exitFee;
          return [
            {
              label: `Exit fee (${formatBpsAsPercent(detail.exit_fee_bps)})`,
              value: `${grouped(formatRawShares6(exitFee))} shares`,
            },
            {
              label: "Shares exchanged for tokens",
              value: `${grouped(formatRawShares6(burn))} shares`,
              emphasis: true,
            },
          ];
        })()
      : null;

  const lastAccrualSeconds = numericToNumber(detail?.last_fee_accrual_ts ?? null);
  const secondsSinceAccrual =
    lastAccrualSeconds !== null && lastAccrualSeconds > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - lastAccrualSeconds)
      : null;
  const accrualStale = secondsSinceAccrual !== null && secondsSinceAccrual > 86400;

  // Name-first identity, same resolution order as the detail page.
  const name = useMemo(() => (detail ? metaName(detail.metadata_json) : null), [detail]);
  const composition = useMemo(() => {
    if (!detail) return null;
    const parts = detail.constituents.map((mint, i) => {
      const ticker = mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
      const bps = detail.weights_bps[i];
      return bps !== undefined ? `${ticker} ${formatBpsAsPercent(bps)}` : ticker;
    });
    if (parts.length === 0) return null;
    const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
    return parts.length > MAX_COMPOSITION_PARTS
      ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}`
      : shown;
  }, [detail, mintTickers]);
  const headline = name ?? composition ?? truncateAddress(pubkey, 6, 6);

  // n ≥ 4 baskets exceed the legacy packet limit — the redeem compiles through
  // a wallet-signed lookup table. Preparation starts in the background on page
  // open (one-time setup) and is shared with the buy page's table for the same
  // basket, so a trade is a single approval and redeem reuses it.
  const coreKeys: BasketCoreKeys | null = useMemo(
    () =>
      publicKey && detail
        ? {
            basket: new PublicKey(detail.pubkey),
            factory: new PublicKey(detail.factory),
            creator: new PublicKey(detail.creator),
            treasury: new PublicKey(detail.treasury),
            shareMint: new PublicKey(detail.share_mint),
            constituents: detail.constituents,
            user: publicKey,
          }
        : null,
    [detail, publicKey],
  );
  const prewarm = useAltPrewarm(coreKeys);
  const needsAlt = prewarm.needsAlt;

  const openReview = () => {
    if (!publicKey || !coreKeys || shares === null || preview === null) return;
    const built = buildRedeemInKind({
      keys: coreKeys,
      sharesToBurn: shares,
      vaultBalances: vaultBalances as bigint[],
    });
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    // Once a signature exists the tx is sent — closing only hides the UI; the
    // confirmation keeps running and the page-level banner reports the outcome.
    if (!flow.state.signature) flow.reset();
  };

  /**
   * Start (or Retry) the redeem flow. Re-invocable after a failure: the
   * lookup table is cached and re-verified on-chain, so a retry never re-asks
   * approvals for an existing table. If the background pre-warm is still
   * running this awaits the SAME preparation — no duplicate approvals.
   */
  const startRedeem = () => {
    if (!publicKey || !coreKeys || shares === null) return;
    const parsed = shares;
    void flow.run(
      async () => {
        if (!needsAlt) {
          return buildRedeemInKind({
            keys: coreKeys,
            sharesToBurn: parsed,
            vaultBalances: vaultBalances as bigint[],
          }).instructions;
        }
        const table = await prewarm.ensureAlt();
        return buildRedeemInKindTransaction({
          connection,
          keys: coreKeys,
          sharesToBurn: parsed,
          vaultBalances: vaultBalances as bigint[],
          lookupTableAddresses: [table],
        });
      },
      needsAlt ? () => prewarm.ensureAlt() : undefined,
      {
        onComplete: () => {
          void refreshShareBalance();
          retry(); // refetch detail → holdings/NAV update without a manual refresh
        },
        describe: {
          kind: "redeem",
          label: "redeem",
          successLine:
            preview !== null
              ? `Done — ${grouped(formatRawShares6(parsed))} shares redeemed${name ? ` from ${name}` : ""}`
              : "🎉 Done",
          actionHref: "/portfolio",
          actionLabel: "View Portfolio",
        },
      },
    );
  };

  const holdingsAligned = useMemo(() => {
    if (!detail) return [];
    const byMint = new Map(detail.holdings.map((h) => [h.mint, h]));
    return detail.constituents.map((mint) => byMint.get(mint) ?? null);
  }, [detail]);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link href="/explore" className="underline underline-offset-4 hover:text-foreground">
          Explore
        </Link>
        <span aria-hidden="true"> / </span>
        <Link
          href={`/basket/${pubkey}`}
          className="font-mono tabular-nums underline underline-offset-4 hover:text-foreground"
        >
          {truncateAddress(pubkey, 6, 6)}
        </Link>
        <span aria-hidden="true"> / </span>
        <span>redeem</span>
      </nav>

      {status === "loading" ? (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : null}

      {status === "not-found" ? (
        <>
          <EmptyState
            chip="NOT INDEXED"
            title="Basket details unavailable"
            description="This page needs indexed basket details to prepare a redemption. Try again after indexing completes."
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={retry}>Retry</Button>
                <Button render={<Link href="/explore" />} size="sm">
                  Back to explore
                </Button>
              </div>
            }
          />
          <details className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              On-chain protocol behavior
            </summary>
            <p className="mt-2 leading-5">
              The on-chain instruction is permissionless and oracle-free; it does not require a price oracle,
              whitelist status, or backend account. This page still needs indexed basket details to prepare a transaction.
            </p>
          </details>
        </>
      ) : null}

      {status === "error" ? (
        <ErrorState
          title="Basket unavailable"
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
          {/* compact identity header — name + composition, detail via the breadcrumb */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0 space-y-1.5">
              <h1 className="font-display text-3xl font-semibold tracking-tight" title={detail.pubkey}>
                {headline}
              </h1>
              {name && composition ? (
                <p className="font-mono text-xs tabular-nums text-muted-foreground">{composition}</p>
              ) : null}
              <p className="text-sm text-muted-foreground">
                Receive each underlying token pro rata. Exit fee: {" "}
                <span className="font-mono tabular-nums">{formatBpsAsPercent(detail.exit_fee_bps)}</span> of shares.
              </p>
              {CLUSTER === "devnet" || CLUSTER === "localnet" ? (
                <p className="text-xs text-muted-foreground">
                  {CLUSTER === "devnet"
                    ? "Devnet · project mock tokens, not issuer-backed xStocks · LEGAL_REVIEW_REQUIRED."
                    : "Localnet · test tokens, not issuer-backed xStocks · LEGAL_REVIEW_REQUIRED."}
                </p>
              ) : null}
            </div>
            <FreshnessBadge
              source={detail.source}
              asOf={detail.nav?.asOf ?? detail.asOf ?? undefined}
            />
          </div>

          {accrualStale ? (
            <p className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              Fee accrual is pending; displayed token amounts use the last indexed snapshot and may change before signing.
            </p>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Redeem shares</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col gap-1">
                  <label htmlFor="redeem-shares" className="text-xs font-medium text-muted-foreground">
                    Basket shares
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="redeem-shares"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="e.g. 1.5"
                      value={sharesInput}
                      onChange={(e) => setSharesInput(e.target.value)}
                      aria-invalid={sharesExceedBalance || (sharesInput.trim() !== "" && shares === null)}
                      aria-describedby="redeem-amount-help"
                      className="h-11 w-44 rounded-lg border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-ring sm:w-56"
                    />
                    <HalfMaxButtons
                      connected={connected}
                      balance={shareBalance}
                      balanceLabel="share balance"
                      loading={shareBalanceLoading}
                      onPick={(kind) => {
                        if (shareBalance === null || shareBalance <= 0n) return;
                        const raw = kind === "max" ? shareBalance : halfOfRaw(shareBalance);
                        if (raw <= 0n) return;
                        setSharesInput(formatRawShares6(raw));
                      }}
                    />
                  </div>
                  <span id="redeem-amount-help" className="text-[11px] text-muted-foreground">
                    Up to six decimal places.
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Balance</span>
                  <span className="flex items-center gap-2 font-mono text-sm tabular-nums">
                    {connected
                      ? shareBalanceLoading
                        ? "Loading…"
                        : shareBalance === null
                          ? "No basket shares found"
                          : `${grouped(formatRawShares6(shareBalance))} shares`
                      : "Connect to see your balance"}
                  </span>
                </div>
              </div>

              {/* live fee preview — spec §5.3 exit math on the typed amount
                  (floor(B × bps / 10_000), net = B − fee); hidden entirely when
                  the input is invalid or exceeds the balance — no estimates on
                  top of an error. */}
              <TradeFeePreview
                rows={feePreviewRows}
                label="Share breakdown"
                footer="Fee shares go to recipients; the rest are burned."
              />

              {sharesExceedBalance ? (
                <p role="alert" className="text-xs text-destructive">
                  This is more than the basket shares in your wallet.
                </p>
              ) : null}
              {sharesInput.trim() !== "" && shares === null ? (
                <p role="alert" className="text-xs text-destructive">
                  Enter a valid share amount with up to six decimal places.
                </p>
              ) : null}

              {preview && holdingsAligned ? (
                <div className="space-y-3">
                  <h2 className="text-sm font-medium">Tokens you receive</h2>
                  <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {detail.constituents.map((mint, i) => {
                      const holding = holdingsAligned[i];
                      const multiplier = Number(holding?.multiplier ?? 1);
                      const decimals = holding?.decimals ?? 6;
                      const out = preview.outs[i] ?? 0n;
                      return (
                        <li
                          key={mint}
                          className="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums" title={mint}>
                            {mintTickers.get(mint) ?? truncateAddress(mint, 6, 6)}
                          </span>
                          <span className="font-mono text-sm tabular-nums">
                            {scaledFromRaw(out, multiplier, decimals)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <dl className="grid gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                    {usdEstimate !== null ? (
                      <div className="flex justify-between gap-4">
                        <dt>Indexed NAV estimate (not cash)</dt>
                        <dd>≈ {formatUsd(usdEstimate)}</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {accrualStale
                      ? "Preview uses indexed balances; fee accrual is overdue, so supply may change before signing."
                      : "Preview uses the last indexed balances; amounts may change before signing."}{" "}
                    NAV is a reference estimate, not a cash quote.
                  </p>
                </div>
              ) : shares !== null && shares > 0n && (supply === null || vaultBalances.some((v) => v === null)) ? (
                <EmptyState
                  chip="NO SNAPSHOT"
                  title="Preview unavailable"
                  description="This page needs indexed supply and complete vault balances to calculate the preview and prepare a transaction."
                  action={
                    <Button size="sm" variant="outline" onClick={retry}>Retry snapshot</Button>
                  }
                />
              ) : null}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            A confirmed redemption is irreversible. Token values can move. LEGAL_REVIEW_REQUIRED.
          </p>

          <details className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Protocol details · permissionless, oracle-free redemption
            </summary>
            <div className="mt-3 space-y-3 leading-5">
              <p>
                On-chain redemption is permissionless and oracle-free. The program does not require a price
                oracle, whitelist status, or backend account. This page currently needs indexed supply and
                vault balances to prepare its preview and transaction.
              </p>
              <p>
                Of the shares entered, the exit-fee shares are transferred to fee recipients and
                the remaining shares are burned. Each token amount is rounded down from its vault
                balance × burned shares ÷ total supply, after any management fee accrual.
              </p>
              {preview ? (
                <p className="font-mono tabular-nums">
                  Raw shares: {shares?.toString()} entered · {preview.exitFee.toString()} fee · {preview.burn.toString()} burned.
                </p>
              ) : null}
              {preview ? (
                <ul className="space-y-1 font-mono tabular-nums">
                  {detail.constituents.map((mint, i) => (
                    <li key={mint} className="break-all">
                      {mint}: {preview.outs[i]?.toString() ?? "0"} raw token units
                    </li>
                  ))}
                </ul>
              ) : null}
              {accrualStale ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Management fee last accrued {secondsSinceAccrual !== null ? Math.floor(secondsSinceAccrual / 3600) : "?"}h ago.</span>
                  <AccrueCrankButton
                    basket={detail.pubkey}
                    factory={detail.factory}
                    creator={detail.creator}
                    treasury={detail.treasury}
                    shareMint={detail.share_mint}
                    constituents={detail.constituents}
                    secondsSinceAccrual={secondsSinceAccrual}
                    variant="ghost"
                    quiet
                  />
                </div>
              ) : null}
              <p>
                Where issuer-backed xStocks are used, they are structured instruments, not direct equity
                ownership. This transaction returns tokens, not company shares. LEGAL_REVIEW_REQUIRED.
              </p>
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={openReview}
              disabled={
                !connected ||
                shares === null ||
                shares <= 0n ||
                sharesExceedBalance ||
                preview === null
              }
              title={
                !connected
                  ? "Connect a wallet to redeem"
                  : shares === null || shares <= 0n
                    ? "Enter the number of basket shares to redeem"
                    : sharesExceedBalance
                      ? "Shares exceed your balance"
                      : preview === null
                        ? "No complete holdings snapshot — the token preview cannot be computed"
                        : undefined
              }
              data-testid="redeem-trigger"
            >
              Redeem shares
            </Button>
            {!connected ? (
              <span className="text-xs text-muted-foreground">Connect a wallet to redeem.</span>
            ) : null}
            {connected && shareBalance === 0n ? (
              <span className="text-xs text-muted-foreground">
                You hold no basket shares yet.
              </span>
            ) : null}
          </div>

          {/* one-time basket setup — chip while preparing, explainer line after */}
          {needsAlt && connected ? (
            <p
              data-testid="alt-prewarm"
              aria-live="polite"
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              {prewarm.status === "preparing" ? (
                <>
                  <Spinner sizeClassName="h-3 w-3" label={null} />
                  {prewarm.awaitingWallet
                    ? "Setup — approve in your wallet…"
                    : "Preparing your basket account… one-time setup"}
                </>
              ) : prewarm.status === "failed" ? (
                "One-time setup will be requested with your first trade."
              ) : (
                "One-time setup for this basket: approve 1–2 setup transactions."
              )}
            </p>
          ) : null}

          <TxReviewModal
            open={open}
            onClose={close}
            title={`Redeem ${name ?? "basket"}`}
            description="Review the shares and token estimates, then approve the irreversible transaction in your wallet."
            accounts={expectedAccounts ?? []}
            summary={
              preview && detail ? (
                <TxSummaryCard>
                  <SummaryRow
                    label="Shares leaving your wallet"
                    emphasis
                    value={`${grouped(formatRawShares6(shares ?? 0n))} shares`}
                  />
                  <SummaryRow
                    label="Exit fee"
                    value={`${grouped(formatRawShares6(preview.exitFee))} shares (${bpsToPct(detail.exit_fee_bps)})`}
                  />
                  <SummaryRow
                    label="Shares burned for tokens"
                    value={`${grouped(formatRawShares6(preview.burn))} shares`}
                  />
                  <SummaryRow
                    label="Estimated tokens received"
                    value={detail.constituents
                      .map((mint, i) => {
                        const holding = holdingsAligned[i];
                        const scaled = scaledFromRaw(
                          preview.outs[i] ?? 0n,
                          Number(holding?.multiplier ?? 1),
                          holding?.decimals ?? 6,
                        );
                        const ticker =
                          mintTickers.get(mint) ?? truncateAddress(mint, 4, 4);
                        return `${ticker} ${grouped(scaled)}`;
                      })
                      .join(" · ")}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Snapshot estimate; token quantities may change before execution.
                  </p>
                </TxSummaryCard>
              ) : undefined
            }
            flowState={flow.state}
            onConfirm={startRedeem}
            onRetry={startRedeem}
            confirmLabel="Redeem shares"
            endpoint={RPC_ENDPOINT}
            pendingTxId={flow.state.pendingTxId}
            successLine={
              preview !== null ? (
                <>
                  Done —{" "}
                  <span className="text-[hsl(var(--status-positive))]">
                    {grouped(formatRawShares6(shares ?? 0n))} shares redeemed
                  </span>
                  {name ? ` of ${name}` : ""}
                </>
              ) : (
                "🎉 Done"
              )
            }
            successExtra={
              flow.state.status === "confirmed" && detail ? (
                <ThesisShareCta basket={detail.pubkey} basketName={name} />
              ) : undefined
            }
            setupProgress={prewarm.setupProgress}
          />
        </>
      ) : null}

    </div>
  );
}

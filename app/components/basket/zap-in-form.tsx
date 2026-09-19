"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, FreshnessBadge } from "@/components/states";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { ThesisShareCta } from "@/components/social/thesis-share-cta";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { useAltPrewarm } from "@/components/basket/use-alt-prewarm";
import {
  bpsToPct,
  feesLine,
  grouped,
  SummaryRow,
  TxSummaryCard,
} from "@/components/basket/summary-card";
import { formatRawShares6 } from "@/components/basket/basket-math";
import { HalfMaxButtons, halfOfRaw } from "@/components/basket/basket-page-half-max";
import { TradeFeePreview } from "@/components/basket/basket-page-fee-preview";
import {
  fetchZapInQuote,
  type BasketDetail,
  type ZapInQuote,
} from "@/components/basket/basket-api";
import {
  buildCreateAtaInstructions,
  buildMintInKind,
  buildMintInKindTransaction,
  deriveAta,
  type BasketCoreKeys,
  type ExpectedAccount,
} from "@/lib/transactions";
import { formatBpsAsPercent, scaledFromRaw, truncateAddress } from "@/lib/format";
import { withRetry, withRetryOnce } from "@/lib/rpc-retry";
import { RPC_ENDPOINT, describeRpcError, describeWalletError } from "@/lib/wallet";
import { PROTOCOL_FEE_SPLIT_LABEL } from "@/lib/protocol-policy";
import {
  classifyLegRecovery,
  createZapBalanceSnapshot,
  minimumRawOutput,
  parseRawAmount,
  validateLegOrdering,
  ZapBalanceDeltaError,
  type ZapBalanceSnapshot,
} from "@/lib/zap-balance-delta";

const JUPITER_SWAP_URL = "https://quote-api.jup.ag/v6/swap";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // backend default (quotes.ts)
const ZAP_QUOTE_TTL_MS = 30_000;

/** Preset quick-fill amounts under the USDC input (Stax §5.10 amount chips). */
const PRESET_USDC_AMOUNTS = ["100", "500", "1000", "5000"] as const;

/** Basket display name out of the metadata JSON (null when unparseable). */
function basketName(detail: BasketDetail): string | null {
  const mj = detail.metadata_json;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  const n = obj && typeof obj === "object" ? (obj as Record<string, unknown>).name : null;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

type LegStatus = "idle" | "sending" | "confirmed" | "failed";
type Phase = "idle" | "quoting" | "quoted" | "swapping" | "ready-to-mint" | "done";

type ZapAttempt = {
  wallet: string;
  contextKey: string;
  quoteFingerprint: string;
  /** Raw ATA balances captured once, immediately before the first swap leg. */
  snapshot: ZapBalanceSnapshot;
  /** A leg is complete only after its raw post-pre delta passed min-out. */
  completed: boolean[];
  /** Signatures are retained even when confirmation/balance reconciliation is ambiguous. */
  signatures: (string | null)[];
  signatureHistory: string[][];
  /** Signed transaction bytes survive an ambiguous send and are retried byte-for-byte. */
  serializedTransactions: (Uint8Array | null)[];
  /** Only a definitively failed on-chain signature can be retried with the same quote. */
  retryable: boolean[];
  /** Frozen raw deltas used by the closing mint; never replaced with full balances. */
  frozenAmounts: bigint[] | null;
};

type LegReconciliation = {
  kind: "settled" | "empty" | "partial" | "invalid";
  delta: bigint;
  minimumOut: bigint | null;
};

function quoteFingerprint(quote: ZapInQuote): string {
  // Include the full leg quote payload: changing a route, amount, output mint,
  // or slippage creates a new attempt and therefore a new pre-balance baseline.
  return JSON.stringify({
    side: quote.side,
    basket: quote.basket,
    slippageBps: quote.slippageBps,
    asOf: quote.provenance.asOf,
    legs: quote.legs.map((leg) => ({
      index: leg.index,
      inputMint: leg.inputMint,
      outputMint: leg.outputMint,
      inAmount: leg.inAmount,
      expectedOutAmount: leg.expectedOutAmount,
      jupiterQuote: leg.jupiterQuote,
    })),
  });
}

function minimumOutputForLeg(leg: ZapInQuote["legs"][number], slippageBps: number): bigint {
  if (leg.minimumOutAmount !== null && leg.minimumOutAmount !== undefined) {
    const explicit = parseRawAmount(leg.minimumOutAmount, "minimum output amount");
    if (explicit <= 0n) throw new Error("minimum output amount must be greater than zero.");
    return explicit;
  }
  return minimumRawOutput(
    { ...leg, expectedOutAmount: leg.expectedOutAmount ?? undefined },
    slippageBps,
  );
}

function isZapQuoteStale(quote: ZapInQuote): boolean {
  const asOf = Date.parse(quote.provenance.asOf);
  return !Number.isFinite(asOf) || Date.now() - asOf > ZAP_QUOTE_TTL_MS;
}

/**
 * Zap USDC: POST /quotes/zap-in returns Jupiter QUOTE legs only (the backend
 * never signs). The client executes the swaps SEQUENTIALLY — V0 zap is
 * non-atomic — and then calls mint_in_kind with the actually received amounts.
 * The verbatim backend warning is rendered inline, always.
 */
export function ZapInForm({
  detail,
  vaultBalances,
  tickers,
  onSuccess,
}: {
  detail: BasketDetail;
  vaultBalances: (bigint | null)[];
  /** Mint → ticker map (page API data) for the human-language review card. */
  tickers?: Map<string, string>;
  /** Called after a confirmed closing mint so the page can refetch detail. */
  onSuccess?: () => void;
}) {
  const { publicKey, connected, signTransaction } = useWallet();
  const { connection } = useConnection();
  const flow = useTransactionFlow();

  // n ≥ 4 baskets: the closing mint compiles through a wallet-signed lookup
  // table — prepared in the background (shared with the in-kind form's table).
  const coreKeys: BasketCoreKeys | null = useMemo(
    () =>
      publicKey
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

  const [amountUsdc, setAmountUsdc] = useState("");
  const [slippageBps, setSlippageBps] = useState("50");
  const [quote, setQuote] = useState<ZapInQuote | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [legStates, setLegStates] = useState<LegStatus[]>([]);
  const [swapWarning, setSwapWarning] = useState<string | null>(null);
  const [expectedAccounts, setExpectedAccounts] = useState<ExpectedAccount[] | null>(null);
  const [mintAmounts, setMintAmounts] = useState<bigint[] | null>(null);
  const [open, setOpen] = useState(false);
  const attemptRef = useRef<ZapAttempt | null>(null);
  const [legSignatures, setLegSignatures] = useState<(string | null)[]>([]);
  const [legActualAmounts, setLegActualAmounts] = useState<(string | null)[]>([]);

  const walletAddress = publicKey?.toBase58() ?? null;

  const amountRaw = useMemo(() => {
    const s = amountUsdc.trim();
    if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
    const [int, frac = ""] = s.split(".");
    const raw = BigInt(int + frac.padEnd(6, "0"));
    return raw > 0n ? raw.toString() : null;
  }, [amountUsdc]);

  const slippage = useMemo(() => {
    const n = Number(slippageBps);
    return Number.isInteger(n) && n >= 0 && n < 10_000 ? n : null;
  }, [slippageBps]);

  const zapContextKey = `${walletAddress ?? "disconnected"}:${detail.pubkey}:${amountRaw ?? "invalid"}:${slippage ?? "invalid"}`;
  const activeZapContextKeyRef = useRef(zapContextKey);
  activeZapContextKeyRef.current = zapContextKey;
  const quoteRequestRef = useRef<AbortController | null>(null);

  // A wallet change, basket change, or quote input change invalidates the
  // balance baseline. Keeping the old baseline would let a later mint sweep
  // tokens that were already in the wallet before this zap attempt.
  useEffect(() => {
    quoteRequestRef.current?.abort();
    quoteRequestRef.current = null;
    attemptRef.current = null;
    setMintAmounts(null);
    setExpectedAccounts(null);
    setLegSignatures([]);
    setLegActualAmounts([]);
    setLegStates([]);
    setOpen(false);
    setSwapWarning(null);
    setPhase("idle");
    setQuote(null);
  }, [walletAddress, detail.pubkey, amountUsdc, slippageBps]);

  useEffect(
    () => () => {
      activeZapContextKeyRef.current = "unmounted";
      quoteRequestRef.current?.abort();
      attemptRef.current = null;
    },
    [],
  );

  // Stax §5.10 "Est. round-trip cost": entry + exit fees from the basket's own
  // bps config, plus blended price impact ONLY when the fetched Jupiter quote
  // carries it (priceImpactPct is a decimal fraction of 1, verbatim backend
  // passthrough; the legs partition the USDC input, so each leg's fraction is
  // weighted by its share of the total input). No quote / no impact data →
  // impact counts as zero and the UI labels the line "fees only" — never an
  // invented figure.
  const roundTripCost = useMemo(() => {
    const feesPct = detail.entry_fee_bps / 100 + detail.exit_fee_bps / 100;
    if (!quote) return { pct: feesPct, impactKnown: false };
    let totalIn = 0;
    for (const leg of quote.legs) {
      const n = Number(leg.inAmount);
      if (Number.isFinite(n)) totalIn += n;
    }
    let blended = 0; // fraction of 1
    let sawImpact = false;
    for (const leg of quote.legs) {
      if (!leg.priceImpactPct) continue;
      const frac = Number(leg.priceImpactPct);
      if (!Number.isFinite(frac) || frac < 0) continue;
      sawImpact = true;
      const share = totalIn > 0 ? Number(leg.inAmount) / totalIn : 0;
      blended += frac * share;
    }
    return sawImpact
      ? { pct: feesPct + blended * 100, impactKnown: true }
      : { pct: feesPct, impactKnown: false };
  }, [quote, detail.entry_fee_bps, detail.exit_fee_bps]);

  // USDC balance for the Half / Max quick-fill — one background read, honest
  // when it fails: the buttons disable with an explanation instead of guessing.
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [usdcBalanceLoading, setUsdcBalanceLoading] = useState(true);

  const refreshUsdcBalance = useCallback(async () => {
    if (!publicKey) {
      setUsdcBalance(null);
      setUsdcBalanceLoading(false);
      return;
    }
    setUsdcBalanceLoading(true);
    try {
      const res = await withRetryOnce(
        () =>
          connection.getTokenAccountBalance(
            deriveAta(publicKey, new PublicKey(USDC_MINT)),
          ),
        "USDC balance read",
      );
      setUsdcBalance(BigInt(res.value.amount));
    } catch {
      setUsdcBalance(null); // no USDC ATA / read failed — Half/Max stays disabled
    } finally {
      setUsdcBalanceLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    void refreshUsdcBalance();
  }, [refreshUsdcBalance]);

  const readConstituentBalances = useCallback(async (): Promise<bigint[]> => {
    if (!publicKey) throw new Error("Connect a wallet before starting a zap.");
    return Promise.all(
      detail.constituents.map(async (mint) => {
        const res = await withRetryOnce(
          () => connection.getTokenAccountBalance(deriveAta(publicKey, new PublicKey(mint))),
          "token balance read",
        );
        return parseRawAmount(res.value.amount, `raw balance for ${mint}`);
      }),
    );
  }, [connection, detail.constituents, publicKey]);

  const ensureZapAttempt = useCallback(async (nextQuote: ZapInQuote): Promise<ZapAttempt> => {
    if (!publicKey) throw new Error("Connect a wallet before starting a zap.");
    const wallet = publicKey.toBase58();
    const contextKey = activeZapContextKeyRef.current;
    const fingerprint = quoteFingerprint(nextQuote);
    const existing = attemptRef.current;
    if (existing) {
      if (
        existing.wallet !== wallet ||
        existing.contextKey !== contextKey ||
        existing.quoteFingerprint !== fingerprint
      ) {
        throw new Error("The wallet or quote changed. Start a new quote before retrying.");
      }
      return existing;
    }

    // This is deliberately after ATA creation in executeSwaps and immediately
    // before the first leg. It is never overwritten by a retry.
    validateLegOrdering(
      nextQuote.legs.map(({ index, outputMint }) => ({ index, outputMint })),
      detail.constituents,
    );
    const preBalances = await readConstituentBalances();
    const attempt: ZapAttempt = {
      wallet,
      contextKey,
      quoteFingerprint: fingerprint,
      snapshot: createZapBalanceSnapshot(detail.constituents, preBalances),
      completed: nextQuote.legs.map(() => false),
      signatures: nextQuote.legs.map(() => null),
      signatureHistory: nextQuote.legs.map(() => []),
      serializedTransactions: nextQuote.legs.map(() => null),
      retryable: nextQuote.legs.map(() => false),
      frozenAmounts: null,
    };
    attemptRef.current = attempt;
    setLegSignatures(attempt.signatures.slice());
    return attempt;
  }, [detail.constituents, publicKey, readConstituentBalances]);

  const reconcileLeg = useCallback(
    async (attempt: ZapAttempt, nextQuote: ZapInQuote, index: number): Promise<LegReconciliation> => {
      const leg = nextQuote.legs[index];
      const expectedMint = detail.constituents[index];
      if (!leg || leg.index !== index || leg.outputMint !== expectedMint) {
        return { kind: "invalid", delta: 0n, minimumOut: null };
      }
      const current = await readConstituentBalances();
      const post = current[index];
      const pre = attempt.snapshot.entries[index]?.raw;
      if (pre === undefined) return { kind: "invalid", delta: 0n, minimumOut: null };
      let minimumOut: bigint;
      try {
        minimumOut = minimumOutputForLeg(leg, nextQuote.slippageBps);
      } catch {
        return { kind: "invalid", delta: post - pre, minimumOut: null };
      }
      try {
        const recovery = classifyLegRecovery(pre, post, minimumOut);
        return {
          kind:
            recovery.action === "already-settled"
              ? "settled"
              : recovery.action === "execute"
                ? "empty"
                : "partial",
          delta: recovery.delta,
          minimumOut: recovery.minimumOut,
        };
      } catch (err) {
        if (err instanceof ZapBalanceDeltaError && err.code === "negative-delta") {
          return { kind: "invalid", delta: post - pre, minimumOut };
        }
        return { kind: "invalid", delta: 0n, minimumOut };
      }
    },
    [detail.constituents, readConstituentBalances],
  );

  const freezeMintAmounts = useCallback(
    async (attempt: ZapAttempt, nextQuote: ZapInQuote): Promise<bigint[]> => {
      if (attempt.frozenAmounts) return attempt.frozenAmounts;
      const reconciled: bigint[] = [];
      for (let i = 0; i < nextQuote.legs.length; i++) {
        if (!attempt.completed[i]) {
          throw new Error(`Swap leg ${i + 1} is not settled yet.`);
        }
        const result = await reconcileLeg(attempt, nextQuote, i);
        if (result.kind !== "settled") {
          throw new Error(
            `Swap leg ${i + 1} balance delta is not safely settled. Wait for the signature to land, then retry.`,
          );
        }
        reconciled.push(result.delta);
      }
      const frozen = reconciled.slice();
      attempt.frozenAmounts = frozen;
      return frozen;
    },
    [reconcileLeg],
  );

  const isZapContextActive = useCallback(
    (contextKey: string, attempt?: ZapAttempt): boolean =>
      activeZapContextKeyRef.current === contextKey &&
      (attempt === undefined || attemptRef.current === attempt),
    [],
  );

  const getQuote = useCallback(async () => {
    if (!amountRaw || slippage === null) return;
    const requestContextKey = zapContextKey;
    quoteRequestRef.current?.abort();
    const controller = new AbortController();
    quoteRequestRef.current = controller;
    setPhase("quoting");
    setQuoteError(null);
    setSwapWarning(null);
    attemptRef.current = null;
    setMintAmounts(null);
    setExpectedAccounts(null);
    setLegSignatures([]);
    setLegActualAmounts([]);
    setLegStates([]);
    setOpen(false);
    setQuote(null);
    try {
      const q = await fetchZapInQuote(
        { basket: detail.pubkey, amountUSDC: amountRaw, slippageBps: slippage },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        quoteRequestRef.current !== controller ||
        !isZapContextActive(requestContextKey)
      ) {
        return;
      }
      setQuote(q);
      setLegStates(q.legs.map(() => "idle"));
      setLegActualAmounts(q.legs.map(() => null));
      setPhase("quoted");
    } catch (err) {
      if (
        controller.signal.aborted ||
        quoteRequestRef.current !== controller ||
        !isZapContextActive(requestContextKey)
      ) {
        return;
      }
      setQuoteError(err instanceof Error ? err.message : "Quote failed.");
      setPhase("idle");
    } finally {
      if (quoteRequestRef.current === controller) quoteRequestRef.current = null;
    }
  }, [amountRaw, slippage, detail.pubkey, isZapContextActive, zapContextKey]);

  /**
   * Execute sequential Jupiter legs with a single immutable pre-balance
   * snapshot. A retry first reconciles post-pre deltas; it never blindly sends
   * a second swap for a signature whose confirmation is ambiguous.
   */
  const executeSwaps = useCallback(async () => {
    if (!publicKey || !quote || !signTransaction) return;
    const executionContextKey = zapContextKey;
    if (!isZapContextActive(executionContextKey)) return;
    if (!attemptRef.current && isZapQuoteStale(quote)) {
      setSwapWarning(
        "This Jupiter quote is older than 30 seconds. Get a fresh quote before preparing accounts or signing a swap.",
      );
      setPhase("quoted");
      return;
    }
    setPhase("swapping");
    setSwapWarning(null);

    // (1) prepare — create missing constituent ATAs so swaps have destinations.
    const missing: number[] = [];
    await Promise.all(
      detail.constituents.map(async (mint, i) => {
        try {
          await withRetryOnce(
            () => connection.getTokenAccountBalance(deriveAta(publicKey, new PublicKey(mint))),
            "token balance read",
          );
        } catch {
          missing.push(i);
        }
      }),
    );
    if (!isZapContextActive(executionContextKey)) return;
    if (missing.length > 0) {
      try {
        const blockhash = await withRetry(
          () => connection.getLatestBlockhash("confirmed"),
          { label: "blockhash read" },
        );
        if (!isZapContextActive(executionContextKey)) return;
        const tx = new Transaction({
          feePayer: publicKey,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        });
        tx.add(
          ...buildCreateAtaInstructions(
            publicKey,
            publicKey,
            missing.map((i) => new PublicKey(detail.constituents[i])),
          ),
        );
        const signed = await signTransaction(tx);
        if (!isZapContextActive(executionContextKey)) return;
        // Re-sending is safe: an identical signed transaction dedups on-cluster.
        const signature = await withRetry(
          () => connection.sendRawTransaction(signed.serialize()),
          { label: "ATA prepare send" },
        );
        if (!isZapContextActive(executionContextKey)) return;
        await withRetry(
          () =>
            connection.confirmTransaction(
              { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
              "confirmed",
            ),
          { label: "ATA prepare confirm" },
        );
        if (!isZapContextActive(executionContextKey)) return;
      } catch (err) {
        if (!isZapContextActive(executionContextKey)) return;
        const reason = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        setSwapWarning(
          `Prepare step failed: ${reason} Nothing was swapped, your funds are safe. Press "Execute ${quote.legs.length} swap legs" to retry.`,
        );
        setPhase("quoted");
        return;
      }
    }

    let attempt: ZapAttempt;
    try {
      // Snapshot only after all missing ATAs are confirmed and immediately
      // before the first leg. Existing attempts reuse this exact baseline.
      attempt = await ensureZapAttempt(quote);
      if (!isZapContextActive(executionContextKey, attempt)) return;
    } catch (err) {
      if (!isZapContextActive(executionContextKey)) return;
      setSwapWarning(err instanceof Error ? err.message : "Could not establish a zap balance snapshot.");
      setPhase("quoted");
      return;
    }

    // (2) sequential, non-atomic legs.
    for (let i = 0; i < quote.legs.length; i++) {
      if (!isZapContextActive(executionContextKey, attempt)) return;
      const leg = quote.legs[i];
      if (attempt.completed[i]) {
        // Confirmed legs are settled by a validated raw delta and are never
        // re-executed during a retry.
        continue;
      }
      if (!leg.jupiterQuote) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Leg ${i + 1} has no executable Jupiter route (the quote allocated zero raw units). ` +
            "Minting is blocked because every constituent requires a positive, verified delta. Get a larger or new quote.",
        );
        setPhase("quoted");
        return;
      }

      // Reconcile before every send. Empty means safe to execute only when no
      // prior signature exists; positive-but-under-minimum is an unsafe partial
      // fill and must never be topped up by blindly repeating the swap.
      let beforeSend: LegReconciliation;
      try {
        beforeSend = await reconcileLeg(attempt, quote, i);
        if (!isZapContextActive(executionContextKey, attempt)) return;
      } catch (err) {
        if (!isZapContextActive(executionContextKey, attempt)) return;
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Leg ${i + 1} balance reconciliation failed: ${describeWalletError(
            err as { name?: string; message?: string } | null,
          )} Do not resend until the wallet balance can be checked.`,
        );
        setPhase("quoted");
        return;
      }
      if (beforeSend.kind === "settled") {
        attempt.completed[i] = true;
        setLegActualAmounts((prev) =>
          prev.map((amount, j) => (j === i ? beforeSend.delta.toString() : amount)),
        );
        setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
        continue;
      }
      if (beforeSend.kind === "partial" || beforeSend.kind === "invalid") {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Leg ${i + 1} has an unsafe raw balance delta (${beforeSend.delta.toString()} received; ` +
            `${beforeSend.minimumOut?.toString() ?? "unknown"} minimum). The leg is blocked to prevent duplicate spending. ` +
            "Keep the partial tokens, inspect the signature, and start a new quote only after recovery.",
        );
        setPhase("quoted");
        return;
      }
      if (attempt.signatures[i] && !attempt.retryable[i] && !attempt.serializedTransactions[i]) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Leg ${i + 1} already has signature ${attempt.signatures[i]!.slice(0, 10)}… but its ` +
            "raw output is not visible yet. Wait for RPC balance propagation and retry reconciliation; it will not be resent automatically.",
        );
        setPhase("quoted");
        return;
      }

      if (attempt.retryable[i]) {
        // The previous signature was definitively rejected on-chain. A new
        // signed transaction is allowed for that case; ambiguous sends keep
        // their serialized bytes and never take this branch.
        attempt.serializedTransactions[i] = null;
        attempt.retryable[i] = false;
      }

      if (isZapQuoteStale(quote) && !attempt.serializedTransactions[i]) {
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        setSwapWarning(
          `Quote leg ${i + 1} is older than 30 seconds and has no retained signed transaction. ` +
            "Get a new quote before creating a fresh swap; already-signed legs may still be reconciled safely.",
        );
        setPhase("quoted");
        return;
      }

      setLegStates((prev) => prev.map((s, j) => (j === i ? "sending" : s)));
      let signature: string | null = null;
      let serialized = attempt.serializedTransactions[i];
      try {
        if (!serialized) {
          const res = await fetch(JUPITER_SWAP_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              quoteResponse: leg.jupiterQuote,
              userPublicKey: publicKey.toBase58(),
              wrapAndUnwrapSol: true,
            }),
          });
          if (!isZapContextActive(executionContextKey, attempt)) return;
          if (!res.ok) throw new Error(`Jupiter swap API responded ${res.status}`);
          const payload = (await res.json()) as { swapTransaction?: string };
          if (!isZapContextActive(executionContextKey, attempt)) return;
          if (!payload.swapTransaction) throw new Error("Jupiter returned no swap transaction");
          // Base64 → bytes without relying on a Buffer global in the client bundle.
          const swapTx = VersionedTransaction.deserialize(
            Uint8Array.from(atob(payload.swapTransaction), (c) => c.charCodeAt(0)),
          );
          const signed = await signTransaction(swapTx);
          if (!isZapContextActive(executionContextKey, attempt)) return;
          serialized = signed.serialize();
          // Persist before send: if sendRawTransaction accepts the tx but
          // loses the response, retrying sends these exact bytes and dedups.
          attempt.serializedTransactions[i] = serialized;
        }
        signature = await withRetry(
          () => connection.sendRawTransaction(serialized!),
          { label: `swap leg ${i + 1} send` },
        );
        attempt.signatures[i] = signature;
        attempt.signatureHistory[i].push(signature);
        if (!isZapContextActive(executionContextKey, attempt)) return;
        setLegSignatures(attempt.signatures.slice());
        if (!signature) throw new Error(`swap leg ${i + 1} returned no signature`);
        const sentSignature: string = signature;
        const confirmed = await withRetry(
          () => connection.confirmTransaction(sentSignature, "confirmed"),
          { label: `swap leg ${i + 1} confirm` },
        );
        if (!isZapContextActive(executionContextKey, attempt)) return;
        if (confirmed.value.err) {
          // A definitive on-chain failure is the only state in which the same
          // quote may be retried after a zero delta.
          attempt.retryable[i] = true;
          throw new Error(`leg ${i + 1} failed on-chain`);
        }
        const afterConfirmation = await reconcileLeg(attempt, quote, i);
        if (!isZapContextActive(executionContextKey, attempt)) return;
        if (afterConfirmation.kind !== "settled") {
          throw new Error(
            afterConfirmation.kind === "partial"
              ? `leg ${i + 1} produced only a partial raw output`
              : `leg ${i + 1} confirmed but its raw output is not visible yet`,
          );
        }
        attempt.completed[i] = true;
        setLegActualAmounts((prev) =>
          prev.map((amount, j) =>
            j === i ? afterConfirmation.delta.toString() : amount,
          ),
        );
        setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
      } catch (err) {
        if (!isZapContextActive(executionContextKey, attempt)) return;
        // If the confirmation request itself was ambiguous, reconcile once
        // before deciding. A settled delta marks the leg complete; otherwise a
        // recorded signature blocks resubmission until the user retries later.
        if (signature && !attempt.retryable[i]) {
          try {
            const reconciled = await reconcileLeg(attempt, quote, i);
            if (!isZapContextActive(executionContextKey, attempt)) return;
            if (reconciled.kind === "settled") {
              attempt.completed[i] = true;
              setLegActualAmounts((prev) =>
                prev.map((amount, j) => (j === i ? reconciled.delta.toString() : amount)),
              );
              setLegStates((prev) => prev.map((s, j) => (j === i ? "confirmed" : s)));
              continue;
            }
          } catch {
            // Preserve the original failure copy below; the next retry will
            // reconcile again before any possible send.
          }
        }
        setLegStates((prev) => prev.map((s, j) => (j === i ? "failed" : s)));
        const reason = describeWalletError(
          err as { name?: string; message?: string } | null,
        );
        setSwapWarning(
          signature && !attempt.retryable[i]
            ? `Leg ${i + 1} has signature ${signature.slice(0, 10)}… but no verified raw output yet: ${reason} ` +
                "The leg is paused to prevent a duplicate swap. Retry later to reconcile the balance; the retained signed bytes will be resent identically if still needed."
            : attempt.serializedTransactions[i]
              ? `Leg ${i + 1} send confirmation was ambiguous: ${reason} The signed transaction is retained and the next retry will resend identical bytes after balance reconciliation.`
            : `Leg ${i + 1} did not complete: ${reason} The zap is sequential and non-atomic — any confirmed earlier legs remain in your wallet. Retry only after reconciliation.`,
        );
        setPhase("quoted");
        return;
      }
    }

    try {
      const frozen = await freezeMintAmounts(attempt, quote);
      if (!isZapContextActive(executionContextKey, attempt)) return;
      setLegActualAmounts(frozen.map((amount) => amount.toString()));
    } catch (err) {
      if (!isZapContextActive(executionContextKey, attempt)) return;
      setSwapWarning(err instanceof Error ? err.message : "Closing mint amounts could not be frozen safely.");
      setPhase("quoted");
      return;
    }
    setPhase("ready-to-mint");
  }, [
    connection,
    detail.constituents,
    ensureZapAttempt,
    freezeMintAmounts,
    isZapContextActive,
    publicKey,
    quote,
    reconcileLeg,
    signTransaction,
    zapContextKey,
  ]);

  const openMintReview = useCallback(async () => {
    if (!publicKey || !coreKeys || !quote) return;
    const attempt = attemptRef.current;
    if (
      !attempt ||
      attempt.wallet !== publicKey.toBase58() ||
      attempt.contextKey !== zapContextKey ||
      attempt.quoteFingerprint !== quoteFingerprint(quote)
    ) {
      setSwapWarning("The wallet or quote changed. Get a new quote before opening the mint review.");
      return;
    }
    let received: bigint[];
    try {
      // Use only the immutable post-pre deltas. Never pass a wallet's full ATA
      // balance to mint_in_kind, because it may contain older holdings.
      received = (await freezeMintAmounts(attempt, quote)).slice();
      if (!isZapContextActive(zapContextKey, attempt)) return;
    } catch (err) {
      setSwapWarning(err instanceof Error ? err.message : "Closing mint amounts could not be verified safely.");
      return;
    }
    if (received.some((amount) => amount <= 0n)) {
      setSwapWarning(
        "A constituent leg delivered zero raw units — mint_in_kind requires every amount > 0. No mint was prepared.",
      );
      return;
    }
    setMintAmounts(received);
    const built = buildMintInKind({
      keys: coreKeys!,
      amounts: received,
      vaultBalances: vaultBalances.map((v) => v ?? 0n),
    });
    setExpectedAccounts(built.expectedAccounts);
    setOpen(true);
  }, [coreKeys, freezeMintAmounts, isZapContextActive, publicKey, quote, vaultBalances, zapContextKey]);

  const close = () => {
    setOpen(false);
    // Once a signature exists the tx is sent — closing only hides the UI; the
    // confirmation keeps running and the page-level banner reports the outcome.
    if (!flow.state.signature) flow.reset();
  };

  /**
   * Start (or Retry) the closing mint. Re-invocable after a failure: the
   * lookup table is cached and re-verified on-chain, so a retry never re-asks
   * approvals for an existing table. Shares the background pre-warm's
   * preparation — no duplicate approvals.
   */
  const startMint = () => {
    if (!publicKey || !coreKeys || !mintAmounts) return;
    const parsed = mintAmounts;
    void flow.run(
      async () => {
        if (!needsAlt) {
          return buildMintInKind({
            keys: coreKeys,
            amounts: parsed,
            vaultBalances: vaultBalances.map((v) => v ?? 0n),
          }).instructions;
        }
        const table = await prewarm.ensureAlt();
        return buildMintInKindTransaction({
          connection,
          keys: coreKeys,
          amounts: parsed,
          vaultBalances: vaultBalances.map((v) => v ?? 0n),
          lookupTableAddresses: [table],
        });
      },
      needsAlt ? () => prewarm.ensureAlt() : undefined,
      {
        onComplete: () => onSuccess?.(),
        describe: {
          kind: "buy",
          label: "buy",
          successLine:
            quote && /^\d+$/.test(quote.expectedShares?.trim() ?? "")
              ? `🎉 Done — +${grouped(formatRawShares6(BigInt(quote.expectedShares!.trim())))} shares`
              : "🎉 Done",
          actionHref: "/portfolio",
          actionLabel: "View Portfolio",
        },
      },
    );
  };

  const supply = detail.nav?.supply;
  const supplyValid = Boolean(supply && /^\d+$/.test(supply.trim()));

  if (!supplyValid || vaultBalances.some((v) => v === null)) {
    return (
      <EmptyState
        chip="NO SNAPSHOT"
        title="Zap preview unavailable"
        description="The zap ends in mint_in_kind, which is validated against indexed vault holdings and supply. This basket has no complete holdings snapshot yet."
      />
    );
  }

  const legsDone = quote ? quote.legs.every((_, i) => legStates[i] === "confirmed") : false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle>Zap USDC</CardTitle>
        <CardDescription className="text-xs">
          Split USDC across the target weights via Jupiter, then mint in-kind with what arrives.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="zap-usdc" className="text-xs font-medium text-muted-foreground">
              USDC amount
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id="zap-usdc"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 250.50"
                value={amountUsdc}
                onChange={(e) => setAmountUsdc(e.target.value)}
                disabled={phase === "swapping"}
                className="h-10 w-36 rounded-lg border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:w-40"
              />
              <HalfMaxButtons
                connected={connected}
                balance={usdcBalance}
                balanceLabel="USDC balance"
                loading={usdcBalanceLoading}
                onPick={(kind) => {
                  if (phase === "swapping") return;
                  if (usdcBalance === null || usdcBalance <= 0n) return;
                  const raw = kind === "max" ? usdcBalance : halfOfRaw(usdcBalance);
                  if (raw <= 0n) return;
                  // 6-dec display string via the shared raw→scaled formatter.
                  setAmountUsdc(scaledFromRaw(raw, 1, 6));
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="zap-slippage" className="text-xs font-medium text-muted-foreground">
              Slippage (bps)
            </label>
            <input
              id="zap-slippage"
              inputMode="numeric"
              value={slippageBps}
              onChange={(e) => setSlippageBps(e.target.value)}
              disabled={phase === "swapping"}
              className="h-10 w-24 rounded-lg border border-border bg-background px-3 font-mono text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
          </div>
          <Button
            onClick={() => void getQuote()}
            disabled={!amountRaw || slippage === null || phase === "quoting" || phase === "swapping"}
            className="mt-5"
          >
            {phase === "quoting" ? "Quoting…" : "Get quote"}
          </Button>
        </div>

        {/* Preset amount chips (Stax §5.10) — presentation-only quick fill:
            a press enters the value into the input and nothing else; quoting
            still goes through the existing button. The chip matching the
            current input lights up (yellow accent per brand rules). */}
        <div
          role="group"
          aria-label="Preset USDC amounts"
          className="flex flex-wrap items-center gap-1.5"
        >
          {PRESET_USDC_AMOUNTS.map((preset) => {
            const active = amountUsdc.trim() === preset;
            return (
              <button
                key={preset}
                type="button"
                aria-pressed={active}
                disabled={phase === "swapping"}
                onClick={() => setAmountUsdc(preset)}
                className={`max-md:min-h-10 rounded-full border px-3 py-1 font-mono text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none ${
                  active
                    ? "border-primary/60 bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                }`}
              >
                {preset}
              </button>
            );
          })}
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            USDC
          </span>
        </div>

        {/* Fee preview — share amounts exist only once a real quote is back
            (the USDC input alone cannot produce shares without prices, so the
            row stays hidden until then; no invented estimate). */}
        <TradeFeePreview
          rows={
            quote && quote.expectedShares && /^\d+$/.test(quote.expectedShares.trim())
              ? [
                  {
                    label: `Entry fee · ${formatBpsAsPercent(detail.entry_fee_bps)}`,
                    value: "deducted in shares at the closing mint",
                  },
                  {
                    label: "Net shares (quote estimate)",
                    value: grouped(formatRawShares6(BigInt(quote.expectedShares.trim()))),
                    emphasis: true,
                  },
                ]
              : null
          }
          footer={
            quote
              ? "Quote estimate from the backend's Jupiter legs — the closing mint validates on-chain."
              : undefined
          }
        />

        {/* Stax §5.10 honesty line — the cost of entering AND leaving, shown
            before any signature. Fees are the basket's own bps config; price
            impact comes only from the fetched Jupiter legs (blended by each
            leg's share of the input). With no impact data the line says so
            instead of inventing a figure. */}
        {Number.isFinite(detail.entry_fee_bps) && Number.isFinite(detail.exit_fee_bps) ? (
          <div>
            <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs tabular-nums">
              <span className="text-muted-foreground">Est. round-trip cost</span>
              <span className="font-medium">≈ {roundTripCost.pct.toFixed(2)}%</span>
              {!roundTripCost.impactKnown ? (
                <span className="text-muted-foreground">
                  · fees only — market impact at execution
                </span>
              ) : null}
            </p>
            <p className="pt-0.5 text-[11px] leading-4 text-muted-foreground">
              shown upfront — nothing to discover later
            </p>
          </div>
        ) : null}

        {quoteError ? (
          <ErrorState
            title="Quote unavailable"
            message={quoteError}
            onRetry={() => void getQuote()}
          />
        ) : null}

        {quote ? (
          <>
            {/* Eight data columns — scroll horizontally on phones instead of
                clipping (the parent border keeps its rounding while scrolled). */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[52rem] text-xs">
                <caption className="sr-only">Jupiter quote legs</caption>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="h-9 px-3 font-medium">Leg</th>
                    <th className="h-9 px-3 text-right font-medium">Allocation</th>
                    <th className="h-9 px-3 text-right font-medium">In (USDC raw)</th>
                    <th className="h-9 px-3 text-right font-medium">Quoted out</th>
                    <th className="h-9 px-3 text-right font-medium">Minimum out</th>
                    <th className="h-9 px-3 text-right font-medium">Actual out</th>
                    <th className="h-9 px-3 text-right font-medium">Impact</th>
                    <th className="h-9 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quote.legs.map((leg, i) => (
                    <tr key={leg.index} className="h-11 border-b border-border last:border-0">
                      <td className="px-3 font-mono tabular-nums">
                        {truncateAddress(leg.outputMint, 4, 4)}
                        {leg.routeLabels.length ? (
                          <span className="ml-2 text-muted-foreground">via {leg.routeLabels.join(" → ")}</span>
                        ) : null}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.allocationBps !== null ? `${leg.allocationBps} bps` : "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">{leg.inAmount}</td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.expectedOutAmount ?? leg.note ?? "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.minimumOutAmount ?? leg.jupiterQuote?.otherAmountThreshold ?? "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {legActualAmounts[i] ?? "—"}
                      </td>
                      <td className="px-3 text-right font-mono tabular-nums">
                        {leg.priceImpactPct ?? "—"}
                      </td>
                      <td className="px-3 font-mono tabular-nums text-muted-foreground">
                        {legStates[i]}
                        {legSignatures[i] ? " · tx recorded" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* provenance + backend warning — one quiet note, always inline for zap quotes */}
            <div
              role="note"
              className="space-y-2 rounded-xl border border-border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground"
            >
              <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
                <FreshnessBadge source={quote.provenance.source} asOf={quote.provenance.asOf} />
                <span>slippage {quote.provenance.slippageBps} bps</span>
                {quote.expectedShares ? (
                  <span>est. {formatRawShares6(BigInt(quote.expectedShares))} shares</span>
                ) : (
                  <span className="font-sans">no indexed supply — no share estimate</span>
                )}
              </div>
              <p>{quote.warning}</p>
              <p className="font-mono text-[11px]">{quote.mintAccountsNote}</p>
            </div>

            {swapWarning ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
              >
                {swapWarning}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void executeSwaps()}
                disabled={phase !== "quoted" || !connected || !signTransaction}
              >
                {phase === "swapping" ? "Swapping…" : `Execute ${quote.legs.length} swap legs`}
              </Button>
              <Button
                onClick={() => void openMintReview()}
                disabled={phase !== "ready-to-mint" || !legsDone}
                variant="outline"
              >
                Buy with received tokens
              </Button>
            </div>
            {connected && !signTransaction ? (
              <p role="alert" className="text-xs text-muted-foreground">
                This wallet cannot sign the Jupiter swap transactions.
              </p>
            ) : null}
          </>
        ) : null}

        <TxReviewModal
          open={open}
          onClose={close}
          title={`Buy ${basketName(detail) ?? "basket"} with USDC`}
          description="One press: we check the mint on-chain first, then your wallet opens for a single approval."
          accounts={expectedAccounts ?? []}
          summary={
            <TxSummaryCard>
              <SummaryRow
                label="You deposit"
                value={
                  mintAmounts
                    ? detail.constituents
                        .map((mint, i) => {
                          const holding = detail.holdings.find((h) => h.mint === mint);
                          const scaled = scaledFromRaw(
                            mintAmounts[i] ?? 0n,
                            Number(holding?.multiplier ?? 1),
                            holding?.decimals ?? 6,
                          );
                          return `${tickers?.get(mint) ?? truncateAddress(mint, 4, 4)} ${grouped(scaled)}`;
                        })
                        .join(" · ")
                    : "—"
                }
              />
              {quote?.expectedShares && /^\d+$/.test(quote.expectedShares.trim()) ? (
                <SummaryRow
                  label="You receive"
                  emphasis
                  value={`≈${grouped(formatRawShares6(BigInt(quote.expectedShares.trim())))} shares (after ${bpsToPct(detail.entry_fee_bps)} entry fee)`}
                />
              ) : null}
              <SummaryRow
                label="Fees"
                muted
                value={`${feesLine(detail.entry_fee_bps, detail.exit_fee_bps, detail.management_fee_bps)} (${PROTOCOL_FEE_SPLIT_LABEL})`}
              />
            </TxSummaryCard>
          }
          flowState={flow.state}
          onConfirm={startMint}
          onRetry={startMint}
          confirmLabel="Buy shares"
          endpoint={RPC_ENDPOINT}
          pendingTxId={flow.state.pendingTxId}
          successLine={
            quote && /^\d+$/.test(quote.expectedShares?.trim() ?? "") ? (
              <>
                🎉 Done —{" "}
                <span className="text-[hsl(var(--status-positive))]">
                  +{grouped(formatRawShares6(BigInt(quote.expectedShares!.trim())))} shares
                </span>
              </>
            ) : (
              "🎉 Done"
            )
          }
          successExtra={
            flow.state.status === "confirmed" ? (
              <ThesisShareCta basket={detail.pubkey} basketName={basketName(detail)} />
            ) : undefined
          }
          setupProgress={prewarm.setupProgress}
          errorSlot={
            flow.state.mintPaused ? (
              <div
                role="alert"
                className="mt-4 rounded-xl border border-border bg-muted/30 p-3 text-xs leading-relaxed"
              >
                <p className="font-medium">MintPaused — the on-chain whitelist gate stopped this mint</p>
                <p className="mt-1 text-muted-foreground">
                  A constituent is PausedNewMints; new mints are blocked before any token moves. Your
                  swapped tokens stay in your wallet. Redeem is never affected by this pause.
                </p>
              </div>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}

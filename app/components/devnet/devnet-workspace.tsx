"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { WalletButton } from "@/components/shell/wallet-button";
import { CreatePreviewDonut } from "@/components/create/create-preview-donut";
import { TxReviewModal } from "@/components/basket/tx-review-modal";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { SummaryRow, TxSummaryCard, feesLine, grouped } from "@/components/basket/summary-card";
import { checkGrossShares, computeRedeemPreview, entryFeeOf, formatRawShares6 } from "@/components/basket/basket-math";
import { deriveCreateBasketPdas, sha256Hex, type CreateBasketArgs } from "@/lib/create-basket";
import { buildCreateBasketTransaction, buildMintInKind, buildMintInKindTransaction, buildRedeemInKind, buildRedeemInKindTransaction, ensureCreateBasketAlt, ensureMintRedeemAlt, type BasketCoreKeys, type ExpectedAccount, type WalletSendTransaction } from "@/lib/transactions";
import { assertDevnetConnection, DEVNET_MOCKS, estimateDevnetAccruedSupply, invalidateDevnetBasketCache, listDevnetBaskets, readDevnetBasket, readDevnetWallet, saveDevnetBasketMetadata, scaledDevnetAmount, type RawDevnetSnapshot } from "@/lib/devnet-baskets";
import { assertDevnetFaucetReady, buildDevnetFaucetClaim, readDevnetFaucetClaimed } from "@/lib/devnet-faucet";
import { CLUSTER, RPC_ENDPOINT, describeRpcError } from "@/lib/wallet";
import { truncateAddress } from "@/lib/format";
import { budgetDeposits, formatTokenUnitsInput, maximumBudget, parseTokenUnits, percentBps, tokenUnits, U64_MAX, weightedSeed } from "./amounts";

type WalletSnapshot = Awaited<ReturnType<typeof readDevnetWallet>>;
type Review =
  | { kind: "claim"; owner: string; accounts: ExpectedAccount[] }
  | { kind: "create"; owner: string; args: CreateBasketArgs; metadata: string; accounts: ExpectedAccount[] }
  | { kind: "mint" | "redeem"; owner: string; snapshot: RawDevnetSnapshot; amount: bigint; tokenAmounts: bigint[]; accounts: ExpectedAccount[] };

const INPUT_CLASS = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";
const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))"];
const BUSY_STATUSES = new Set(["preparing-alt", "simulating", "awaiting-signature", "confirming"]);

function Field({ id, label, value, onChange, hint, decimal = false, decimalPlaces = 8, maxLength, disabled = false }: {
  id: string; label: string; value: string; onChange: (value: string) => void; hint?: ReactNode;
  decimal?: boolean; decimalPlaces?: number; maxLength?: number; disabled?: boolean;
}) {
  return <div className="space-y-1.5">
    <label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</label>
    <input id={id} className={`${INPUT_CLASS} ${decimal ? "font-mono tabular-nums" : ""}`} value={value}
      onChange={(event) => onChange(event.target.value)} inputMode={decimal ? "decimal" : "text"}
      onBlur={() => { if (decimal) onChange(formatTokenUnitsInput(value, decimalPlaces)); }}
      autoComplete="off" maxLength={maxLength} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} />
    {hint ? <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
  </div>;
}

function basketName(snapshot: RawDevnetSnapshot): string {
  const json = snapshot.detail.metadata_json;
  const name = json && typeof json === "object" ? (json as { name?: unknown }).name : null;
  return typeof name === "string" && name.trim() ? name : `Basket ${truncateAddress(snapshot.detail.pubkey)}`;
}

function coreKeys(snapshot: RawDevnetSnapshot, user: PublicKey): BasketCoreKeys {
  const detail = snapshot.detail;
  return { basket: new PublicKey(detail.pubkey), factory: new PublicKey(detail.factory), creator: new PublicKey(detail.creator),
    treasury: new PublicKey(detail.treasury), shareMint: new PublicKey(detail.share_mint), constituents: detail.constituents, user };
}

function vaultAmounts(snapshot: RawDevnetSnapshot): bigint[] {
  return snapshot.detail.constituents.map((mint) => {
    const holding = snapshot.detail.holdings.find((item) => item.mint === mint);
    if (!holding) throw new Error("A vault token account is unavailable. Refresh the basket.");
    return BigInt(holding.raw_amount);
  });
}

function walletAmounts(snapshot: RawDevnetSnapshot): bigint[] {
  return snapshot.detail.constituents.map((mint) => BigInt(snapshot.walletBalances.find((item) => item.mint === mint)?.rawAmount ?? "0"));
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g) ?? [], (part) => Number.parseInt(part, 16));
}

function friendlyError(error: unknown): string {
  return error instanceof Error ? error.message : describeRpcError(error);
}

/** A wallet-signed devnet workspace. No indexer, database, or server signer is required. */
export default function DevnetWorkspace() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const params = useSearchParams();
  const [name, setName] = useState(() => (params.get("name") ?? "My test basket").slice(0, 64));
  const [thesis, setThesis] = useState(() => (params.get("thesis") ?? "").slice(0, 400));
  const [management, setManagement] = useState(() => {
    const value = params.get("managementBps");
    return value !== null && /^\d+$/.test(value) && Number(value) <= 300 ? String(Number(value) / 100) : "2";
  });
  const [weights, setWeights] = useState(["25", "25", "25", "25"]);
  const [seedBudget, setSeedBudget] = useState("1,000");
  const [legal, setLegal] = useState(false);
  const [tradeMode, setTradeMode] = useState<"mint" | "redeem">("mint");
  const [mintBudget, setMintBudget] = useState("100");
  const [redeemShares, setRedeemShares] = useState("0.1");
  const [basketAddress, setBasketAddress] = useState(() => params.get("basket") ?? "");
  const [selected, setSelected] = useState<RawDevnetSnapshot | null>(null);
  const [baskets, setBaskets] = useState<RawDevnetSnapshot[]>([]);
  const [wallet, setWallet] = useState<WalletSnapshot | null>(null);
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBasket, setLoadingBasket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [setupProgress, setSetupProgress] = useState<{ step: number; total: number } | null>(null);
  const loadGeneration = useRef(0);
  const selectedAddressRef = useRef(basketAddress);
  const flow = useTransactionFlow();
  const busy = BUSY_STATUSES.has(flow.state.status);
  const networkCorrect = CLUSTER === "devnet";
  const walletKey = publicKey?.toBase58() ?? null;
  const currentWalletRef = useRef(walletKey);
  currentWalletRef.current = walletKey;
  const currentConnectionRef = useRef(connection);
  currentConnectionRef.current = connection;

  const refresh = useCallback(async () => {
    if (!networkCorrect || walletKey !== currentWalletRef.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      invalidateDevnetBasketCache(connection);
      const rows = await listDevnetBaskets(connection, { wallet: walletKey ?? undefined });
      const walletState = walletKey ? await readDevnetWallet(connection, walletKey) : null;
      const didClaim = walletKey ? await readDevnetFaucetClaimed(connection, new PublicKey(walletKey)) : null;
      if (generation !== loadGeneration.current) return;
      setBaskets(rows);
      setWallet(walletState);
      setClaimed(didClaim);
      const address = selectedAddressRef.current || rows[0]?.detail.pubkey;
      if (address) {
        const snapshot = rows.find((row) => row.detail.pubkey === address) ?? await readDevnetBasket(connection, address, walletKey ?? undefined);
        if (generation !== loadGeneration.current) return;
        setSelected(snapshot);
        setBasketAddress(address);
        selectedAddressRef.current = address;
      } else setSelected(null);
    } catch (err) {
      if (generation === loadGeneration.current) setError(friendlyError(err));
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [connection, networkCorrect, walletKey]);

  useEffect(() => {
    setReviewOpen(false);
    setWallet(null);
    setClaimed(null);
    setSelected(null);
    void refresh();
    return () => { loadGeneration.current += 1; };
  }, [refresh]);

  const chooseBasket = async (address: string) => {
    if (!address || busy) return;
    try { new PublicKey(address); }
    catch { setFormError("Enter a valid Solana basket address."); return; }
    selectedAddressRef.current = address;
    setBasketAddress(address);
    setLoadingBasket(true);
    setFormError(null);
    const ownerAtRead = currentWalletRef.current;
    try {
      invalidateDevnetBasketCache(connection);
      const snapshot = await readDevnetBasket(connection, address, walletKey ?? undefined);
      if (selectedAddressRef.current === address && currentWalletRef.current === ownerAtRead) setSelected(snapshot);
    } catch (err) {
      if (currentWalletRef.current === ownerAtRead && selectedAddressRef.current === address) {
        setSelected(null);
        setFormError(friendlyError(err));
      }
    } finally {
      if (currentWalletRef.current === ownerAtRead && selectedAddressRef.current === address) setLoadingBasket(false);
    }
  };

  const parsedWeights = weights.map(percentBps);
  const validWeights = parsedWeights.every((weight) => weight !== null && weight > 0) && parsedWeights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) === 10_000;
  const managementBps = percentBps(management);
  const seedRaw = parseTokenUnits(seedBudget, 8);
  const seedAmounts = validWeights && seedRaw !== null ? weightedSeed(seedRaw, parsedWeights as number[]) : null;
  const validCreate = !!name.trim() && validWeights && managementBps !== null && managementBps <= 300 && seedAmounts !== null && seedAmounts.every((amount) => amount > 0n) && legal;
  const createShortfall = !!wallet && !!seedAmounts && DEVNET_MOCKS.some((mock, i) => BigInt(wallet.walletBalances.find((item) => item.mint === mock.mint)?.rawAmount ?? "0") < seedAmounts[i]);
  const hasSol = wallet !== null && wallet.solBalance >= 5_000_000;
  const canTransact = connected && publicKey !== null && !!signTransaction && networkCorrect && wallet !== null && hasSol && !busy && !reviewLoading;
  const slices = DEVNET_MOCKS.map((mock, i) => ({ key: mock.mint, label: mock.symbol, value: parsedWeights[i] ?? 0, color: COLORS[i] }));

  const tradePreview = useMemo(() => {
    if (!selected) return null;
    const vaults = vaultAmounts(selected);
    const supply = estimateDevnetAccruedSupply(selected);
    if (tradeMode === "mint") {
      const amount = parseTokenUnits(mintBudget, 8);
      if (amount === null || amount <= 0n) return null;
      const deposits = budgetDeposits(amount, vaults);
      const checked = checkGrossShares(deposits, vaults, supply);
      if (!checked.ok || checked.gross > U64_MAX || checked.gross + supply > U64_MAX) return null;
      const fee = entryFeeOf(checked.gross, selected.detail.entry_fee_bps);
      const balances = walletAmounts(selected);
      return { kind: "mint" as const, amount, deposits, fee, shares: checked.gross - fee, insufficient: deposits.some((deposit, i) => deposit > balances[i]) };
    }
    const amount = parseTokenUnits(redeemShares, 6);
    if (amount === null || amount <= 0n) return null;
    const output = computeRedeemPreview(vaults, supply, amount, selected.detail.exit_fee_bps);
    return output ? { kind: "redeem" as const, amount, deposits: output.outs, fee: output.exitFee, shares: amount, insufficient: amount > BigInt(selected.shareBalance ?? "0") } : null;
  }, [selected, tradeMode, mintBudget, redeemShares]);

  const reviewClaim = async () => {
    if (!publicKey || !canTransact || claimed) return;
    setReviewLoading(true);
    setFormError(null);
    try {
      await assertDevnetFaucetReady(connection);
      if (currentWalletRef.current !== publicKey.toBase58()) throw new Error("Your wallet changed. Review the claim again with your connected wallet.");
      flow.reset();
      setReview({ kind: "claim", owner: publicKey.toBase58(), accounts: [] });
      setReviewOpen(true);
    } catch (err) { setFormError(friendlyError(err)); }
    finally { setReviewLoading(false); }
  };

  const reviewCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!publicKey || !canTransact || !validCreate || !seedAmounts || managementBps === null) return;
    setReviewLoading(true);
    setFormError(null);
    try {
      const metadata = JSON.stringify({ name: name.trim(), description: thesis.trim(), version: "basalt-devnet-v0", network: "devnet", constituents: DEVNET_MOCKS.map((mock, i) => ({ ticker: mock.symbol, mint: mock.mint, weightBps: parsedWeights[i] })), feesBps: { entry: 0, exit: 0, management: managementBps } });
      const args: CreateBasketArgs = { nonce: Date.now(), constituents: DEVNET_MOCKS.map((mock) => mock.mint), weightsBps: parsedWeights as number[], entryFeeBps: 0, exitFeeBps: 0, managementFeeBps: managementBps, metadataHash: hexBytes(await sha256Hex(metadata)), seedAmounts };
      if (currentWalletRef.current !== publicKey.toBase58()) throw new Error("Your wallet changed. Review the basket again with your connected wallet.");
      flow.reset();
      setReview({ kind: "create", owner: publicKey.toBase58(), args, metadata, accounts: [] });
      setReviewOpen(true);
    } catch (err) { setFormError(friendlyError(err)); }
    finally { setReviewLoading(false); }
  };

  const reviewTrade = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !publicKey || !canTransact || !tradePreview || tradePreview.insufficient) return;
    setReviewLoading(true);
    setFormError(null);
    try {
      invalidateDevnetBasketCache(connection);
      const fresh = await readDevnetBasket(connection, selected.detail.pubkey, publicKey);
      const vaults = vaultAmounts(fresh);
      const supply = estimateDevnetAccruedSupply(fresh);
      const amount = tradePreview.amount;
      const keys = coreKeys(fresh, publicKey);
      const deposits = budgetDeposits(amount, vaults);
      if (tradeMode === "mint") validateMint(fresh, deposits, supply);
      else if (amount > BigInt(fresh.shareBalance ?? "0")) throw new Error("You do not have enough basket shares. Refresh and choose a smaller amount.");
      const tokenAmounts = tradeMode === "mint" ? deposits : computeRedeemPreview(vaults, supply, amount, fresh.detail.exit_fee_bps)?.outs;
      if (!tokenAmounts) throw new Error("This amount cannot be redeemed from the current basket.");
      const built = tradeMode === "mint" ? buildMintInKind({ keys, amounts: deposits, vaultBalances: vaults }) : buildRedeemInKind({ keys, sharesToBurn: amount, vaultBalances: vaults });
      if (currentWalletRef.current !== publicKey.toBase58()) throw new Error("Your wallet changed. Review the transaction again with your connected wallet.");
      flow.reset();
      setSelected(fresh);
      setReview({ kind: tradeMode, owner: publicKey.toBase58(), snapshot: fresh, amount, tokenAmounts, accounts: built.expectedAccounts });
      setReviewOpen(true);
    } catch (err) { setFormError(friendlyError(err)); }
    finally { setReviewLoading(false); }
  };

  const confirmReview = async () => {
    if (!publicKey || !review || busy) return;
    const request = review;
    const owner = publicKey;
    const assertReviewedWallet = () => {
      if (request.owner !== owner.toBase58() || currentWalletRef.current !== request.owner) throw new Error("Your wallet changed. Close this review and review the transaction again.");
      if (currentConnectionRef.current !== connection) throw new Error("The app network changed. Close this review and reconnect to devnet.");
    };
    const sendOnDevnet: WalletSendTransaction = async <T extends VersionedTransaction,>(transaction: T, rpc: typeof connection) => {
      assertReviewedWallet();
      await assertDevnetConnection(rpc);
      if (!signTransaction) throw new Error("This wallet cannot sign a transaction directly.");
      const signed = await signTransaction(transaction);
      assertReviewedWallet();
      return rpc.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
    };
    let lookupTable: PublicKey | null = null;
    const progress = (step: number, total: number) => setSetupProgress({ step, total });
    setSetupProgress(null);
    setRefreshNotice(null);
    const checkWallet = async () => {
      assertReviewedWallet();
      invalidateDevnetBasketCache(connection);
      const current = await readDevnetWallet(connection, owner);
      if (current.solBalance < 5_000_000) throw new Error("Add devnet SOL to cover transaction fees and token-account rent, then retry.");
      if (request.kind === "create") {
        if (current.whitelistStatuses.some((status) => status !== "Active")) throw new Error("A test token is paused for new baskets.");
        DEVNET_MOCKS.forEach((mock, i) => {
          const balance = BigInt(current.walletBalances.find((item) => item.mint === mock.mint)?.rawAmount ?? "0");
          if (balance < BigInt(request.args.seedAmounts[i])) throw new Error(`Not enough ${mock.symbol} to seed this basket. Get test tokens or lower the starting amount.`);
        });
      } else if (request.kind === "mint" || request.kind === "redeem") {
        const snapshot = await readDevnetBasket(connection, request.snapshot.detail.pubkey, owner);
        if (request.kind === "mint") validateMint(snapshot, request.tokenAmounts, estimateDevnetAccruedSupply(snapshot));
        else if (request.amount > BigInt(snapshot.shareBalance ?? "0")) throw new Error("You do not have enough basket shares. Choose a smaller amount.");
      }
      return current;
    };
    const prepare = request.kind === "create" ? async () => {
      await checkWallet();
      const table = await ensureCreateBasketAlt({ connection, creator: owner.toBase58(), args: request.args, sendTransaction: sendOnDevnet, onProgress: progress });
      lookupTable = table.lookupTableAddress;
    } : request.kind === "mint" || request.kind === "redeem" ? async () => {
      await checkWallet();
      const table = await ensureMintRedeemAlt({ connection, keys: coreKeys(request.snapshot, owner), sendTransaction: sendOnDevnet, onProgress: progress });
      lookupTable = table.lookupTableAddress;
    } : undefined;
    let createdAddress: string | null = null;
    const ok = await flow.run(async () => {
      await checkWallet();
      if (request.kind === "claim") {
        await assertDevnetFaucetReady(connection);
        if (await readDevnetFaucetClaimed(connection, owner)) throw new Error("This wallet already claimed its test tokens.");
        return buildDevnetFaucetClaim(owner);
      }
      if (request.kind === "create") {
        const pda = deriveCreateBasketPdas(owner.toBase58(), request.args);
        createdAddress = pda.basket.toBase58();
        // Save only a hash-verified local presentation. The immutable account is read after confirmation.
        await saveDevnetBasketMetadata(createdAddress, request.metadata, Array.from(request.args.metadataHash, (byte) => byte.toString(16).padStart(2, "0")).join(""));
        return buildCreateBasketTransaction({ connection, creator: owner.toBase58(), args: request.args, lookupTableAddresses: lookupTable ? [lookupTable] : [] });
      }
      invalidateDevnetBasketCache(connection);
      const fresh = await readDevnetBasket(connection, request.snapshot.detail.pubkey, owner);
      const keys = coreKeys(fresh, owner);
      const vaults = vaultAmounts(fresh);
      if (request.kind === "mint") {
        // Preserve the exact per-token debits the user reviewed. A changed vault
        // ratio must pass the program's tolerance or require a new review.
        const amounts = request.tokenAmounts;
        validateMint(fresh, amounts, estimateDevnetAccruedSupply(fresh));
        return buildMintInKindTransaction({ connection, keys, amounts, vaultBalances: vaults, lookupTableAddresses: lookupTable ? [lookupTable] : [] });
      }
      if (request.amount > BigInt(fresh.shareBalance ?? "0")) throw new Error("You do not have enough basket shares. Choose a smaller amount.");
      return buildRedeemInKindTransaction({ connection, keys, sharesToBurn: request.amount, vaultBalances: vaults, lookupTableAddresses: lookupTable ? [lookupTable] : [] });
    }, prepare, {
      sendViaConnection: true,
      beforeSign: async () => {
        assertReviewedWallet();
        await checkWallet();
        assertReviewedWallet();
      },
      describe: { kind: request.kind === "create" ? "create" : request.kind === "redeem" ? "redeem" : "buy", label: request.kind === "claim" ? "test-token claim" : request.kind === "create" ? "basket creation" : request.kind, successLine: request.kind === "create" ? "Basket created on devnet" : request.kind === "claim" ? "Test tokens received" : request.kind === "mint" ? "Basket shares minted" : "Basket shares redeemed", actionHref: "/devnet", actionLabel: "View test baskets" },
    });
    if (ok && currentWalletRef.current === request.owner) {
      if (createdAddress) {
        selectedAddressRef.current = createdAddress;
        setBasketAddress(createdAddress);
      }
      try { await refresh(); }
      catch { setRefreshNotice("Transaction confirmed. Refresh to read the updated balances."); }
    }
  };

  const reviewSummary = review ? <TxSummaryCard>
    {review.kind === "claim" ? <>
      <SummaryRow label="You receive" value="1,000 of each test token (unscaled)" emphasis />
      <SummaryRow label="Cost" value="Devnet SOL for token-account rent and fees" />
      <SummaryRow label="Availability" value="Once per wallet" />
    </> : review.kind === "create" ? <>
      <SummaryRow label="Name" value={(JSON.parse(review.metadata) as { name: string }).name} />
      <SummaryRow label="You deposit (unscaled)" value={DEVNET_MOCKS.map((mock, i) => `${grouped(tokenUnits(BigInt(review.args.seedAmounts[i]), mock.decimals))} ${mock.symbol}`).join(" · ")} />
      <SummaryRow label="You receive" value="1 basket share" emphasis />
      <SummaryRow label="Fees" value={feesLine(0, 0, review.args.managementFeeBps)} />
      <SummaryRow label="Terms" value="Fixed weights, fees and thesis" />
    </> : <TradeSummary request={review} />}
    <SummaryRow label="Network" value="Solana devnet" muted />
    {review.kind !== "claim" ? <SummaryRow label="Setup" value="First use may need wallet approvals for account lookup setup" muted /> : null}
  </TxSummaryCard> : null;

  return <div className="mx-auto max-w-6xl space-y-6 pb-12" data-testid="devnet-workspace">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <Badge variant="outline">Devnet · Test tokens</Badge>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Try your basket onchain</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Connect a wallet. Get test tokens. Create a basket, mint shares and redeem them.</p>
      </div>
      <WalletButton />
    </div>

    {!networkCorrect ? <Alert>This app is connected to {CLUSTER}. Open a build configured for Solana devnet to use test baskets.</Alert> : null}
    {error ? <Alert>{error} <Button variant="outline" className="mt-2 min-h-10" onClick={() => void refresh()} disabled={loading}>Retry connection</Button></Alert> : null}
    {formError ? <Alert>{formError}</Alert> : null}

    <Card>
      <CardHeader><CardTitle>Your test tokens</CardTitle><CardDescription>BSTESTA, BSTESTB, BSTESTC and BSTESTD are project mocks with no monetary value.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {DEVNET_MOCKS.map((mock, i) => {
            const balance = wallet?.walletBalances.find((item) => item.mint === mock.mint);
            const multiplier = wallet?.mintFacts.find((item) => item.mint === mock.mint)?.multiplier ?? mock.multiplier;
            return <div key={mock.mint} className="rounded-lg bg-muted/30 p-3">
              <p className="font-mono text-xs text-muted-foreground">{mock.symbol}</p>
              <p className="mt-1 break-all font-mono text-lg tabular-nums">{balance ? grouped(scaledDevnetAmount(BigInt(balance.rawAmount), multiplier, mock.decimals)) : loading && connected ? "Loading…" : "--"}</p>
              {balance ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">{grouped(tokenUnits(balance.rawAmount, mock.decimals))} unscaled</p> : null}
            </div>;
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11" onClick={() => void reviewClaim()} disabled={!canTransact || claimed !== false} data-testid="devnet-claim">
            {reviewLoading ? <Spinner className="size-4" /> : null}{claimed ? "Test tokens already claimed" : "Get test tokens"}
          </Button>
          <Button variant="outline" className="min-h-11" onClick={() => void refresh()} disabled={loading || busy}>{loading ? "Refreshing…" : "Refresh balances"}</Button>
          <span className="text-xs text-muted-foreground">{wallet ? `${grouped(tokenUnits(BigInt(wallet.solBalance), 9))} devnet SOL` : "Connect your wallet to see balances."}</span>
        </div>
        {connected && wallet && !hasSol ? <p className="text-xs leading-5 text-muted-foreground">Add devnet SOL for fees and account rent. <a className="text-primary-text underline underline-offset-4" href="https://faucet.solana.com/" target="_blank" rel="noreferrer">Get devnet SOL</a></p> : null}
        {connected && !signTransaction ? <p className="text-xs text-destructive">This wallet cannot sign transactions. Connect Phantom or Solflare to continue.</p> : null}
      </CardContent>
    </Card>

    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader><CardTitle>Create a test basket</CardTitle><CardDescription>Set the mix of the four test tokens. Each basket gets its own share token.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={(event) => void reviewCreate(event)} className="space-y-5" aria-busy={busy}>
            <Field id="devnet-name" label="Basket name" value={name} onChange={setName} maxLength={64} disabled={busy} />
            <Field id="devnet-thesis" label="Your thesis" value={thesis} onChange={setThesis} maxLength={400} disabled={busy} />
            <fieldset className="space-y-3" disabled={busy}>
              <legend className="pb-2 text-xs font-medium text-muted-foreground">Target weights</legend>
              <div className="grid grid-cols-2 gap-3">
                {DEVNET_MOCKS.map((mock, i) => <Field key={mock.mint} id={`devnet-weight-${i}`} label={`${mock.symbol} (%)`} value={weights[i]} decimal decimalPlaces={2}
                  onChange={(value) => setWeights((old) => old.map((weight, index) => index === i ? value : weight))} />)}
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className={validWeights ? "text-muted-foreground" : "text-destructive"}>{parsedWeights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) / 100}% total · each weight must be positive</span>
                <Button type="button" variant="ghost" className="min-h-10" onClick={() => setWeights(["25", "25", "25", "25"])}>Equal weights</Button>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="devnet-seed" label="Starting test tokens" value={seedBudget} decimal onChange={setSeedBudget} disabled={busy} hint="Total across all four tokens, split by your weights before display multipliers." />
              <Field id="devnet-management" label="Annual management fee (%)" value={management} decimal decimalPlaces={2} onChange={setManagement} disabled={busy} hint="2% recommended · 3% maximum. Entry and exit fees are 0%." />
            </div>
            {managementBps === null || managementBps > 300 ? <p className="text-xs text-destructive">Choose a management fee from 0% to 3%, with at most two decimal places.</p> : null}
            {seedRaw === null || seedRaw <= 0n ? <p className="text-xs text-destructive">Enter a positive starting amount with at most eight decimal places.</p> : null}
            <div className="flex flex-wrap items-center gap-5 rounded-xl bg-muted/20 p-4">
              <CreatePreviewDonut slices={slices} size={112} />
              <div className="min-w-0 flex-1 space-y-2 text-xs">
                {DEVNET_MOCKS.map((mock, i) => <div key={mock.mint} className="flex justify-between gap-3"><span>{mock.symbol}</span><span className="font-mono tabular-nums">{seedAmounts ? `${grouped(tokenUnits(seedAmounts[i], mock.decimals))} unscaled tokens` : "--"}</span></div>)}
              </div>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5">
              <input type="checkbox" className="mt-1 size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring" checked={legal} onChange={(event) => setLegal(event.target.checked)} disabled={busy} />
              <span>I understand this is a test basket. Weights, fees and the thesis are fixed after creation. Management fees mint new shares and dilute holders. LEGAL_REVIEW_REQUIRED.</span>
            </label>
            {createShortfall ? <p className="text-xs text-destructive">Your wallet cannot cover the starting tokens. Claim test tokens or lower the amount.</p> : null}
            <Button type="submit" className="min-h-11 w-full" disabled={!canTransact || !validCreate || createShortfall} data-testid="devnet-create">{reviewLoading ? "Preparing review…" : "Review basket"}</Button>
            {!connected ? <p className="text-xs text-muted-foreground">Connect a wallet to create your basket.</p> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Mint or redeem shares</CardTitle><CardDescription>Try a public test basket or the basket you created.</CardDescription></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="devnet-basket-select" className="text-xs font-medium text-muted-foreground">Test basket</label>
            <select id="devnet-basket-select" className={INPUT_CLASS} value={selected?.detail.pubkey ?? ""} disabled={loading || busy || baskets.length === 0}
              onChange={(event) => void chooseBasket(event.target.value)}>
              {!selected ? <option value="">{loading ? "Loading test baskets…" : "Choose a test basket"}</option> : null}
              {selected && !baskets.some((row) => row.detail.pubkey === selected.detail.pubkey) ? <option value={selected.detail.pubkey}>{basketName(selected)}</option> : null}
              {baskets.map((row) => <option key={row.detail.pubkey} value={row.detail.pubkey}>{basketName(row)}{walletKey === row.detail.creator ? " · yours" : ""}</option>)}
            </select>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void chooseBasket(basketAddress.trim()); }} className="flex items-end gap-2">
            <div className="min-w-0 flex-1"><Field id="devnet-basket-address" label="Or open a basket address" value={basketAddress} onChange={setBasketAddress} disabled={busy} /></div>
            <Button type="submit" variant="outline" className="min-h-11" disabled={busy || loadingBasket || !basketAddress.trim()}>Open</Button>
          </form>
          {loadingBasket ? <p className="text-xs text-muted-foreground" role="status">Reading basket accounts…</p> : null}
          {!selected && !loading ? <div className="rounded-xl bg-muted/20 p-5 text-sm"><p className="font-medium">No test basket loaded</p><p className="mt-1 text-xs text-muted-foreground">Create one here, or open a shared devnet basket address.</p></div> : null}
          {selected ? <>
            <div className="space-y-2 border-b border-border pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">{basketName(selected)}</h2><a href={`https://explorer.solana.com/address/${selected.detail.pubkey}?cluster=devnet`} className="min-h-10 content-center text-xs text-primary-text underline underline-offset-4" target="_blank" rel="noreferrer">View on Explorer</a></div>
              <p className="font-mono text-xs text-muted-foreground">Your shares: {selected.shareBalance !== null ? grouped(formatRawShares6(BigInt(selected.shareBalance))) : "Connect wallet"} · Supply: {grouped(formatRawShares6(BigInt(selected.supply)))}</p>
              <p className="text-xs leading-5 text-muted-foreground">{feesLine(selected.detail.entry_fee_bps, selected.detail.exit_fee_bps, selected.detail.management_fee_bps)}</p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {selected.detail.holdings.map((holding, i) => <div key={holding.mint} className="text-xs"><span className="text-muted-foreground">{DEVNET_MOCKS.find((mock) => mock.mint === holding.mint)?.symbol ?? "Test token"} vault</span><p className="font-mono tabular-nums">{grouped(holding.scaled_amount)} <span className="text-muted-foreground">({selected.detail.weights_bps[i] / 100}%)</span></p></div>)}
              </div>
            </div>
            <fieldset className="flex gap-2" disabled={busy}>
              <legend className="sr-only">Transaction type</legend>
              <Button type="button" className="min-h-11 flex-1" variant={tradeMode === "mint" ? "default" : "outline"} aria-pressed={tradeMode === "mint"} onClick={() => setTradeMode("mint")}>Mint shares</Button>
              <Button type="button" className="min-h-11 flex-1" variant={tradeMode === "redeem" ? "default" : "outline"} aria-pressed={tradeMode === "redeem"} onClick={() => setTradeMode("redeem")}>Redeem shares</Button>
            </fieldset>
            <form onSubmit={(event) => void reviewTrade(event)} className="space-y-4">
              {tradeMode === "mint" ? <Field id="devnet-mint-amount" label="Test tokens to add" value={mintBudget} decimal onChange={setMintBudget} disabled={busy} hint="Split in the current vault ratio before display multipliers. You receive proportional basket shares." />
                : <Field id="devnet-redeem-amount" label="Basket shares to redeem" value={redeemShares} decimal decimalPlaces={6} onChange={setRedeemShares} disabled={busy} hint="Burn shares and receive your proportional test tokens." />}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" className="min-h-10" disabled={busy || !connected} onClick={() => tradeMode === "mint" ? setMintBudget(formatTokenUnitsInput(tokenUnits(maximumBudget(vaultAmounts(selected), walletAmounts(selected)) / 2n, 8))) : setRedeemShares(formatTokenUnitsInput(formatRawShares6(BigInt(selected.shareBalance ?? "0") / 2n), 6))}>Half</Button>
                <Button type="button" variant="ghost" className="min-h-10" disabled={busy || !connected} onClick={() => tradeMode === "mint" ? setMintBudget(formatTokenUnitsInput(tokenUnits(maximumBudget(vaultAmounts(selected), walletAmounts(selected)), 8))) : setRedeemShares(formatTokenUnitsInput(formatRawShares6(BigInt(selected.shareBalance ?? "0")), 6))}>Max</Button>
              </div>
              {tradePreview ? <div className="rounded-xl bg-muted/20 p-3"><TxSummaryCard>
                <SummaryRow label={tradeMode === "mint" ? "Estimated shares received" : "Shares redeemed"} value={grouped(formatRawShares6(tradePreview.shares))} emphasis />
                {selected.detail.constituents.map((mint, i) => <SummaryRow key={mint} label={DEVNET_MOCKS.find((mock) => mock.mint === mint)?.symbol ?? "Test token"} value={`${grouped(tokenUnits(tradePreview.deposits[i], 8))} unscaled tokens ${tradeMode === "mint" ? "in" : "out"}`} />)}
                <SummaryRow label={tradeMode === "mint" ? "Entry fee" : "Exit fee"} value={`${formatRawShares6(tradePreview.fee)} shares`} muted />
              </TxSummaryCard></div> : <p className="text-xs text-muted-foreground">Enter a positive amount large enough to receive shares.</p>}
              {connected && tradePreview?.insufficient ? <p className="text-xs text-destructive">{tradeMode === "mint" ? "Your wallet does not hold enough test tokens." : "This exceeds your basket share balance."}</p> : null}
              {tradeMode === "mint" && selected.whitelistStatuses.some((status) => status !== "Active") ? <p className="text-xs text-destructive">New mints are paused for a constituent. Redemption remains available.</p> : null}
              <Button type="submit" className="min-h-11 w-full" disabled={!canTransact || !tradePreview || tradePreview.insufficient || (tradeMode === "mint" && selected.whitelistStatuses.some((status) => status !== "Active"))} data-testid="devnet-trade-review">Review {tradeMode === "mint" ? "mint" : "redemption"}</Button>
              <p className="text-xs leading-5 text-muted-foreground">Estimates use current onchain balances and accrued fees. Final amounts are calculated by the program when your transaction runs.</p>
            </form>
          </> : null}
        </CardContent>
      </Card>
    </div>
    {refreshNotice ? <p role="status" className="text-sm text-muted-foreground">{refreshNotice}</p> : null}
    <p className="text-xs leading-5 text-muted-foreground">Test tokens are not issuer-backed xStocks. This devnet workspace is for testing; no investment advice. LEGAL_REVIEW_REQUIRED.</p>
    <TxReviewModal open={reviewOpen} onClose={() => setReviewOpen(false)} title={review?.kind === "claim" ? "Get test tokens" : review?.kind === "create" ? "Create your test basket" : review?.kind === "mint" ? "Mint basket shares" : "Redeem basket shares"}
      description="Review the amounts, then approve the transaction in your wallet." accounts={review?.accounts ?? []} summary={reviewSummary}
      flowState={flow.state} onConfirm={() => void confirmReview()} onRetry={() => void confirmReview()}
      confirmLabel={review?.kind === "claim" ? "Get test tokens" : review?.kind === "create" ? "Create basket" : review?.kind === "mint" ? "Mint shares" : "Redeem shares"}
      endpoint={RPC_ENDPOINT} pendingTxId={flow.state.pendingTxId} setupProgress={setupProgress} portfolioHref="/devnet"
      successLine={review?.kind === "claim" ? "Test tokens received" : review?.kind === "create" ? "Basket created on devnet" : review?.kind === "mint" ? "Basket shares minted" : "Basket shares redeemed"} />
  </div>;
}

function Alert({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6">{children}</div>;
}

function validateMint(snapshot: RawDevnetSnapshot, amounts: bigint[], supply: bigint) {
  if (snapshot.whitelistStatuses.some((status) => status !== "Active")) throw new Error("A constituent is paused for new mints. Redemption remains available.");
  if (amounts.some((amount) => amount > U64_MAX)) throw new Error("The token amount exceeds the transaction limit.");
  const balances = walletAmounts(snapshot);
  if (amounts.some((amount, i) => amount > balances[i])) throw new Error("Your wallet does not hold enough test tokens. Get test tokens or choose a smaller amount.");
  const checked = checkGrossShares(amounts, vaultAmounts(snapshot), supply);
  if (!checked.ok) throw new Error(checked.error.kind === "WeightMismatch" ? "The current vault ratio does not support these deposits. Refresh and review a new amount." : "This amount cannot mint shares against the current vault. Increase the amount or choose another basket.");
  if (checked.gross > U64_MAX || checked.gross + supply > U64_MAX) throw new Error("This mint would exceed the basket share supply limit. Choose a smaller amount.");
}

function TradeSummary({ request }: { request: Extract<Review, { kind: "mint" | "redeem" }> }) {
  const snapshot = request.snapshot;
  const vaults = vaultAmounts(snapshot);
  const supply = estimateDevnetAccruedSupply(snapshot);
  const amounts = request.tokenAmounts;
  const gross = request.kind === "mint" && amounts ? checkGrossShares(amounts, vaults, supply) : null;
  const net = gross?.ok ? gross.gross - entryFeeOf(gross.gross, snapshot.detail.entry_fee_bps) : null;
  return <>
    <SummaryRow label="Basket" value={basketName(snapshot)} />
    {amounts?.map((amount, i) => <SummaryRow key={snapshot.detail.constituents[i]} label={`${request.kind === "mint" ? "Deposit" : "Receive"} ${DEVNET_MOCKS.find((mock) => mock.mint === snapshot.detail.constituents[i])?.symbol ?? "test token"}`} value={`${grouped(tokenUnits(amount, 8))} unscaled tokens ${request.kind === "mint" ? "in" : "out"}`} />)}
    <SummaryRow label={request.kind === "mint" ? "Estimated shares received" : "Shares redeemed"} value={grouped(formatRawShares6(net ?? request.amount))} emphasis />
    <SummaryRow label="Fees" value={feesLine(snapshot.detail.entry_fee_bps, snapshot.detail.exit_fee_bps, snapshot.detail.management_fee_bps)} />
  </>;
}

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
import { CoverPicker } from "@/components/create/cover-picker";
import { isBasketCoverId, type BasketCoverId } from "@/lib/basket-covers";
import { devnetBasketCover, devnetBasketMetadata } from "@/lib/devnet-cover";
import { CreatePreviewDonut } from "@/components/create/create-preview-donut";
import { Check, ArrowDown, ArrowUp, ExternalLink } from "lucide-react";
import { createPipelineGuard, pipelinePresentation, type PipelineLease } from "./pipeline-state";
import { explorerTxUrl } from "@/lib/transactions";
import { getDraftNonce, clearDraftNonce } from "./create-draft";
import { checkCreateAvailability, withAvailableCreateFactory, CreateFactoryUnavailableError, CREATE_UNAVAILABLE_NOTICE, type CreateAvailability } from "./create-availability";
import { APP_NAMESPACE_ROUTING } from "@/lib/program-namespaces";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { SummaryRow, TxSummaryCard, feesLine, grouped } from "@/components/basket/summary-card";
import { checkGrossShares, computeRedeemPreview, entryFeeOf, formatRawShares6 } from "@/components/basket/basket-math";
import { deriveCreateBasketPdas, sha256Hex, type CreateBasketArgs } from "@/lib/create-basket";
import { buildCreateBasketTransaction, buildMintInKind, buildMintInKindTransaction, buildRedeemInKind, buildRedeemInKindTransaction, ensureCreateBasketAlt, ensureMintRedeemAlt, type BasketCoreKeys, type ExpectedAccount, type WalletSendTransaction } from "@/lib/transactions";
import { assertDevnetConnection, DEVNET_MOCKS, estimateDevnetAccruedSupply, invalidateDevnetBasketCache, listDevnetBaskets, readDevnetBasket, readDevnetWallet, saveDevnetBasketMetadata, scaledDevnetAmount, type RawDevnetSnapshot } from "@/lib/devnet-baskets";
import { assertDevnetFaucetReady, buildDevnetFaucetClaim, readDevnetFaucetClaimed } from "@/lib/devnet-faucet";
import { signAndSendLocal } from "@/lib/sign-and-send-local";
import { CLUSTER, RPC_ENDPOINT, describeRpcError } from "@/lib/wallet";
import { truncateAddress } from "@/lib/format";
import { onchainBasketDisplay } from "@/lib/onchain-basket-display";
import { budgetDeposits, formatTokenUnitsInput, maximumBudget, parseTokenUnits, percentBps, tokenUnits, U64_MAX, weightedSeed } from "./amounts";

type WalletSnapshot = Awaited<ReturnType<typeof readDevnetWallet>>;
type Review =
  | { kind: "claim"; owner: string; accounts: ExpectedAccount[] }
  | { kind: "create"; owner: string; args: CreateBasketArgs; metadata: string; draftFingerprint: string; accounts: ExpectedAccount[] }
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
  const detail = snapshot.detail;
  return onchainBasketDisplay(detail.metadata_json, detail.pubkey, {
    devnet: CLUSTER === "devnet" || CLUSTER === "localnet",
    assetCount: detail.constituents.length,
    weightsBps: detail.weights_bps,
  }).name;
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
  return (error instanceof Error ? error.message : describeRpcError(error)).replace(/\s*—\s*/g, ". ");
}

/** A wallet-signed devnet workspace. No indexer, database, or server signer is required. */
export default function DevnetWorkspace() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const params = useSearchParams();
  const [name, setName] = useState(() => (params.get("name") ?? "My test basket").slice(0, 64));
  const [thesis, setThesis] = useState(() => (params.get("thesis") ?? "").slice(0, 400));
  const [coverId, setCoverId] = useState<BasketCoverId | undefined>(() => { const value = params.get("coverId"); return isBasketCoverId(value) ? value : undefined; });
  const [management, setManagement] = useState(() => {
    const value = params.get("managementBps");
    return value !== null && /^\d+$/.test(value) && Number(value) <= 300 ? String(Number(value) / 100) : "2";
  });
  const [weights, setWeights] = useState(["25", "25", "25", "25"]);
  const [seedBudget, setSeedBudget] = useState("1,000");
  const [legal, setLegal] = useState(false);
  const [factoryCheck, setFactoryCheck] = useState<{ connection: typeof connection; status: CreateAvailability } | null>(null);
  const factoryCheckGeneration = useRef(0);
  const [workspaceMode, setWorkspaceMode] = useState<"create" | "trade">(() => params.get("name") ? "create" : "trade");
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
  const [reviewLoading, setReviewLoading] = useState(false);
  const [setupProgress, setSetupProgress] = useState<{ step: number; total: number } | null>(null);
  const pipelineGuard = useRef(createPipelineGuard());
  const activeLease = useRef<PipelineLease | null>(null);
  const [resolvedSubmission, setResolvedSubmission] = useState<"confirmed" | "failed" | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const loadGeneration = useRef(0);
  const selectedAddressRef = useRef(basketAddress);
  const flow = useTransactionFlow();
  const busy = reviewLoading || BUSY_STATUSES.has(flow.state.status) || (flow.state.status === "submitted" && resolvedSubmission === null);
  const progressState = resolvedSubmission ?? flow.state.status;
  const pipeline = pipelinePresentation(progressState, { preparing: reviewLoading, setupProgress });
  const networkCorrect = CLUSTER === "devnet";
  const walletKey = publicKey?.toBase58() ?? null;
  const currentWalletRef = useRef(walletKey);
  currentWalletRef.current = walletKey;
  const currentConnectionRef = useRef(connection);
  currentConnectionRef.current = connection;

  // A response from a previous connection cannot enable creation on a new one.
  const createAvailability = factoryCheck?.connection === connection ? factoryCheck.status : "checking";
  const refreshCreateAvailability = useCallback(async () => {
    const generation = ++factoryCheckGeneration.current;
    setFactoryCheck({ connection, status: "checking" });
    const status = networkCorrect ? await checkCreateAvailability(connection) : "unavailable";
    if (generation === factoryCheckGeneration.current && currentConnectionRef.current === connection) {
      setFactoryCheck({ connection, status });
    }
  }, [connection, networkCorrect]);

  useEffect(() => {
    void refreshCreateAvailability();
    return () => { factoryCheckGeneration.current += 1; };
  }, [refreshCreateAvailability]);

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
  const validCreate = !!name.trim() && isBasketCoverId(coverId) && validWeights && managementBps !== null && managementBps <= 300 && seedAmounts !== null && seedAmounts.every((amount) => amount > 0n) && legal;
  const createShortfall = !!wallet && !!seedAmounts && DEVNET_MOCKS.some((mock, i) => BigInt(wallet.walletBalances.find((item) => item.mint === mock.mint)?.rawAmount ?? "0") < seedAmounts[i]);
  const hasSol = wallet !== null && wallet.solBalance >= 5_000_000;
  const canTransact = connected && publicKey !== null && !!signTransaction && networkCorrect && wallet !== null && hasSol && !busy && !loading && !loadingBasket;
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

  // Lock before the first awaited read, so two rapid clicks cannot create two flows.
  const beginPipeline = (kind: Review["kind"]) => {
    if (!publicKey || !canTransact) return null;
    const lease = pipelineGuard.current.begin(publicKey.toBase58(), kind);
    if (!lease) return null;
    activeLease.current = lease;
    flow.reset();
    setResolvedSubmission(null);
    setReview(null);
    setReviewLoading(true);
    setFormError(null);
    setRefreshNotice(null);
    setSetupProgress(null);
    return lease;
  };

  const preparationFailed = (lease: PipelineLease, err: unknown) => {
    pipelineGuard.current.failPreparation(lease);
    setReviewLoading(false);
    setFormError(friendlyError(err));
  };

  useEffect(() => {
    const lease = activeLease.current;
    if (lease) pipelineGuard.current.observe(lease, flow.state);
  }, [flow.state]);

  const submitClaim = async () => {
    if (!publicKey || claimed !== false) return;
    const lease = beginPipeline("claim");
    if (!lease) return;
    try {
      await assertDevnetFaucetReady(connection);
      await executeRequest({ kind: "claim", owner: publicKey.toBase58(), accounts: [] }, lease);
    } catch (err) { preparationFailed(lease, err); }
  };

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!publicKey || !validCreate || !isBasketCoverId(coverId) || !seedAmounts || managementBps === null || createAvailability !== "ready") return;
    const lease = beginPipeline("create");
    if (!lease) return;
    try {
      await withAvailableCreateFactory(connection, async () => {
        if (currentWalletRef.current !== publicKey.toBase58() || currentConnectionRef.current !== connection) throw new Error("Your wallet or network changed. Choose your basket details again.");
        factoryCheckGeneration.current += 1;
        setFactoryCheck({ connection, status: "ready" });
        const metadata = devnetBasketMetadata({ name, thesis, coverId, constituents: DEVNET_MOCKS.map((mock, i) => ({ ticker: mock.symbol, mint: mock.mint, weightBps: parsedWeights[i] as number })), managementBps });
        await assertDevnetConnection(connection);
        const genesis = await connection.getGenesisHash();
        const draftFingerprint = await sha256Hex(JSON.stringify({ owner: publicKey.toBase58(), genesis, namespace: APP_NAMESPACE_ROUTING.creation().id, programs: APP_NAMESPACE_ROUTING.creation().programs, metadata, seedAmounts: seedAmounts.map(String) }));
        const args: CreateBasketArgs = { nonce: getDraftNonce(draftFingerprint), constituents: DEVNET_MOCKS.map((mock) => mock.mint), weightsBps: parsedWeights as number[], entryFeeBps: 0, exitFeeBps: 0, managementFeeBps: managementBps, metadataHash: hexBytes(await sha256Hex(metadata)), seedAmounts };
        if (currentWalletRef.current !== publicKey.toBase58() || currentConnectionRef.current !== connection) throw new Error("Your wallet or network changed. Choose your basket details again.");
        const address = deriveCreateBasketPdas(publicKey.toBase58(), args).basket.toBase58();
        if (await connection.getAccountInfo(new PublicKey(address), "confirmed")) {
          // A reload can lose the economic confirmation UI. Reuse the draft's
          // canonical PDA and verify its immutable state before opening it.
          const existing = await readDevnetBasket(connection, address, publicKey);
          const d = existing.detail;
          const hash = Array.from(args.metadataHash, (byte) => byte.toString(16).padStart(2, "0")).join("");
          if (d.creator !== publicKey.toBase58() || d.metadata_hash !== hash || d.constituents.join(",") !== args.constituents.join(",") || d.weights_bps.join(",") !== args.weightsBps.join(",") || d.entry_fee_bps !== 0 || d.exit_fee_bps !== 0 || d.management_fee_bps !== args.managementFeeBps) throw new Error("This draft address already exists with different basket details. Change the name to start a new basket.");
          if (currentWalletRef.current !== publicKey.toBase58() || currentConnectionRef.current !== connection) throw new Error("Your wallet or network changed. Reconnect to open your basket.");
          await saveDevnetBasketMetadata(address, metadata, hash);
          if (currentWalletRef.current !== publicKey.toBase58() || currentConnectionRef.current !== connection) throw new Error("Your wallet or network changed. Reconnect to open your basket.");
          clearDraftNonce(draftFingerprint);
          pipelineGuard.current.failPreparation(lease);
          setReviewLoading(false);
          selectedAddressRef.current = address;
          setBasketAddress(address);
          setSelected({ ...existing, detail: { ...existing.detail, metadata_json: JSON.parse(metadata) } });
          setWorkspaceMode("trade");
          setRefreshNotice("Your basket was already created. It is ready below.");
          return;
        }
        await executeRequest({ kind: "create", owner: publicKey.toBase58(), args, metadata, draftFingerprint, accounts: [] }, lease);
      });
    } catch (err) {
      if (err instanceof CreateFactoryUnavailableError && currentConnectionRef.current === connection) {
        factoryCheckGeneration.current += 1;
        setFactoryCheck({ connection, status: "unavailable" });
      }
      preparationFailed(lease, err);
    }
  };

  const submitTrade = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !publicKey || !tradePreview || tradePreview.insufficient) return;
    const lease = beginPipeline(tradeMode);
    if (!lease) return;
    // The click authorizes these displayed debits. Fresh reads may validate
    // them, but must never silently substitute a different token allocation.
    const approved = tradePreview;
    try {
      invalidateDevnetBasketCache(connection);
      const fresh = await readDevnetBasket(connection, selected.detail.pubkey, publicKey);
      const vaults = vaultAmounts(fresh);
      if (approved.kind === "mint") validateMint(fresh, approved.deposits, estimateDevnetAccruedSupply(fresh));
      else if (approved.amount > BigInt(fresh.shareBalance ?? "0")) throw new Error("You do not have enough basket shares. Choose a smaller amount.");
      const tokenAmounts = approved.kind === "mint" ? approved.deposits : computeRedeemPreview(vaults, estimateDevnetAccruedSupply(fresh), approved.amount, fresh.detail.exit_fee_bps)?.outs;
      if (!tokenAmounts) throw new Error("This amount cannot be withdrawn from the current basket.");
      const keys = coreKeys(fresh, publicKey);
      const built = approved.kind === "mint" ? buildMintInKind({ keys, amounts: tokenAmounts, vaultBalances: vaults }) : buildRedeemInKind({ keys, sharesToBurn: approved.amount, vaultBalances: vaults });
      if (currentWalletRef.current !== publicKey.toBase58() || currentConnectionRef.current !== connection) throw new Error("Your wallet or network changed. Choose the amount again.");
      setSelected(fresh);
      await executeRequest({ kind: approved.kind, owner: publicKey.toBase58(), snapshot: fresh, amount: approved.amount, tokenAmounts, accounts: built.expectedAccounts }, lease);
    } catch (err) { preparationFailed(lease, err); }
  };

  const executeRequest = async (request: Review, lease: PipelineLease) => {
    if (!publicKey) throw new Error("Connect your wallet to continue.");
    const owner = publicKey;
    const assertReviewedWallet = () => {
      if (request.owner !== owner.toBase58() || currentWalletRef.current !== request.owner) throw new Error("Your wallet changed. Choose the amount again with your connected wallet.");
      if (currentConnectionRef.current !== connection) throw new Error("The app network changed. Reconnect to devnet to continue.");
    };
    const setupSends = new WeakMap<VersionedTransaction, Promise<string>>();
    const sendOnDevnet: WalletSendTransaction = <T extends VersionedTransaction,>(transaction: T, rpc: typeof connection) => {
      // Setup retries share one wallet approval and resend identical signed
      // bytes. A lost RPC response must not open the wallet a second time.
      const existing = setupSends.get(transaction);
      if (existing) return existing;
      const sending = (async () => {
        assertReviewedWallet();
        await assertDevnetConnection(rpc);
        if (!signTransaction) throw new Error("This wallet cannot sign a transaction directly.");
        return signAndSendLocal(transaction, signTransaction, { sendRawTransaction: (bytes, options) => rpc.sendRawTransaction(bytes, { ...options, skipPreflight: false }) }, undefined, assertReviewedWallet, assertReviewedWallet);
      })();
      setupSends.set(transaction, sending);
      return sending;
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
        if (current.whitelistStatuses.some((status) => status !== "Active")) throw new Error("A test token is unavailable for new baskets.");
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
    assertReviewedWallet();
    setReview(request);
    if (!pipelineGuard.current.start(lease)) throw new Error("Another transaction is already being prepared.");
    setReviewLoading(false);
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
      assertCurrent: assertReviewedWallet,
      beforeSign: async () => {
        assertReviewedWallet();
        await checkWallet();
        assertReviewedWallet();
      },
      describe: { kind: request.kind === "create" ? "create" : request.kind === "redeem" ? "redeem" : "buy", label: request.kind === "claim" ? "test-token claim" : request.kind === "create" ? "basket creation" : request.kind, successLine: request.kind === "create" ? "Basket created on devnet" : request.kind === "claim" ? "Test tokens received" : request.kind === "mint" ? "Basket shares minted" : "Basket shares redeemed", actionHref: "/devnet", actionLabel: "View test baskets" },
    });
    if (ok && request.kind === "create") clearDraftNonce(request.draftFingerprint);
    if (ok && currentWalletRef.current === request.owner) {
      if (createdAddress) {
        selectedAddressRef.current = createdAddress;
        setBasketAddress(createdAddress);
      }
      if (request.kind === "create") setWorkspaceMode("trade");
      try { await refresh(); }
      catch { setRefreshNotice("Transaction confirmed. Refresh to read the updated balances."); }
    }
  };

  const checkSubmittedStatus = async () => {
    const lease = activeLease.current;
    const signature = flow.state.signature;
    if (!lease || !signature || flow.state.status !== "submitted" || checkingStatus) return;
    setCheckingStatus(true);
    try {
      const result = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (pipelineGuard.current.snapshot()?.lease !== lease) return;
      const status = result?.err ? "failed" : result && (result.confirmationStatus === "confirmed" || result.confirmationStatus === "finalized") ? "confirmed" : null;
      if (status && pipelineGuard.current.resolveSubmitted(lease, signature, status)) {
        setResolvedSubmission(status);
        if (status === "confirmed") {
          if (review?.kind === "create") clearDraftNonce(review.draftFingerprint);
          if (review?.kind === "create" && currentWalletRef.current === review.owner) {
            const created = deriveCreateBasketPdas(review.owner, review.args).basket.toBase58();
            selectedAddressRef.current = created;
            setBasketAddress(created);
            setWorkspaceMode("trade");
          }
          await refresh();
        }
        setRefreshNotice(null);
      } else setRefreshNotice("Still waiting for confirmation. Your transaction has already been sent.");
    } catch (err) { setRefreshNotice(`Could not check confirmation. ${friendlyError(err)}`); }
    finally { setCheckingStatus(false); }
  };

  const reviewSummary = review ? <TxSummaryCard>
    {review.kind === "claim" ? <>
      <SummaryRow label="You receive" value="1,000 of each test token (unscaled)" emphasis />
      <SummaryRow label="Cost" value="Devnet SOL for token-account rent and fees" />
      <SummaryRow label="Availability" value="Once per wallet" />
    </> : review.kind === "create" ? <>
      <SummaryRow label="Name" value={(JSON.parse(review.metadata) as { name: string }).name} />
      <SummaryRow label="Image" value={<span className="inline-flex items-center gap-2"><img src={devnetBasketCover(JSON.parse(review.metadata), "").src} alt="" width={40} height={40} className="size-10 rounded-md object-cover" />{devnetBasketCover(JSON.parse(review.metadata), "").label}</span>} />
      <SummaryRow label="You deposit (unscaled)" value={DEVNET_MOCKS.map((mock, i) => `${grouped(tokenUnits(BigInt(review.args.seedAmounts[i]), mock.decimals))} ${mock.symbol}`).join(" · ")} />
      <SummaryRow label="You receive" value="1 basket share" emphasis />
      <SummaryRow label="Fees" value={feesLine(0, 0, review.args.managementFeeBps)} />
      <SummaryRow label="Terms" value="Fixed mix, fees and basket details" />
    </> : <TradeSummary request={review} />}
    <SummaryRow label="Network" value="Solana devnet" muted />
    {review.kind !== "claim" ? <SummaryRow label="Setup" value="First use may need wallet approvals for account lookup setup" muted /> : null}
  </TxSummaryCard> : null;

  const displayedTrade = busy && review && (review.kind === "mint" || review.kind === "redeem") ? (() => {
    const result = review.kind === "mint" ? checkGrossShares(review.tokenAmounts, vaultAmounts(review.snapshot), estimateDevnetAccruedSupply(review.snapshot)) : null;
    const fee = result?.ok ? entryFeeOf(result.gross, review.snapshot.detail.entry_fee_bps) : tradePreview?.fee ?? 0n;
    return { deposits: review.tokenAmounts, shares: result?.ok ? result.gross - fee : review.amount, fee };
  })() : tradePreview;
  const activeAction = review?.kind ?? (reviewLoading ? activeLease.current?.action : null);
  const tradeActive = activeAction === "mint" || activeAction === "redeem";
  const successLine = review?.kind === "claim" ? "Your test tokens are ready" : review?.kind === "create" ? "Your basket is ready" : review?.kind === "mint" ? "Tokens added to your basket" : "Tokens returned to your wallet";
  const pipelineStatus = reviewLoading || (review && progressState !== "idle") ? <div className="rounded-xl border border-border bg-muted/20 p-4" data-testid="devnet-pipeline" aria-live="polite" aria-atomic="true">
    <div className="flex items-center gap-2 text-sm font-medium">
      {progressState === "confirmed" ? <Check className="size-4 text-primary-text" aria-hidden="true" /> : busy ? <Spinner label={null} /> : null}
      <span>{progressState === "confirmed" ? successLine : pipeline.label}</span>
    </div>
    {flow.state.progress && busy ? <p className="mt-2 text-xs text-muted-foreground">The network is busy. We’ll keep trying.</p> : null}
    {flow.state.status === "preparing-alt" ? <p className="mt-2 text-xs leading-5 text-muted-foreground">First use needs wallet approvals to prepare your accounts. We continue automatically after each approval.</p> : null}
    {progressState === "failed" || progressState === "rejected" ? <p className="mt-2 text-sm text-destructive">{flow.state.error?.replace(/\s*—\s*/g, ". ") ?? "The transaction failed onchain. Check the transaction before trying again."}</p> : null}
    {progressState === "submitted" ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Your transaction was sent. Check its status before starting another.</p> : null}
    <div className="mt-2 flex flex-wrap items-center gap-3">
      {flow.state.signature ? <a className="inline-flex min-h-10 items-center gap-1 text-xs text-primary-text underline underline-offset-4" href={explorerTxUrl(flow.state.signature, RPC_ENDPOINT)} target="_blank" rel="noreferrer">View transaction <ExternalLink className="size-3" aria-hidden="true" /></a> : null}
      {progressState === "submitted" ? <Button type="button" variant="outline" className="min-h-10" disabled={checkingStatus} onClick={() => void checkSubmittedStatus()}>{checkingStatus ? "Checking…" : "Check status"}</Button> : null}
    </div>
    {reviewSummary ? <details className="mt-2 text-xs"><summary className="min-h-10 cursor-pointer content-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Transaction details</summary><div className="pt-2">{reviewSummary}</div>{flow.state.logs.length ? <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px]">{flow.state.logs.join("\n")}</pre> : null}</details> : null}
  </div> : null;

  return <div className="mx-auto max-w-2xl space-y-6 pb-12" data-testid="devnet-workspace">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-2">
        <Badge variant="outline">Devnet · Test tokens</Badge>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Your basket, onchain.</h1>
        <p className="text-sm leading-6 text-muted-foreground">Choose a basket. Set an amount. Confirm in your wallet.</p>
      </div>
      <WalletButton />
    </div>

    {!networkCorrect ? <Alert>This app is connected to {CLUSTER}. Open a build configured for Solana devnet to use test baskets.</Alert> : null}
    {error ? <Alert>{error} <Button variant="outline" className="mt-2 min-h-10" onClick={() => void refresh()} disabled={loading || busy}>Retry connection</Button></Alert> : null}

    {connected || activeAction === "claim" ? <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-sm font-medium">{!connected ? "Connect your wallet to start" : loading ? "Checking your wallet…" : claimed ? "Your test tokens are ready" : "Get tokens to try a basket"}</p><p className="mt-1 text-xs text-muted-foreground">{wallet ? `${grouped(tokenUnits(BigInt(wallet.solBalance), 9))} devnet SOL` : "Project test tokens, with no monetary value."}</p></div>
        {claimed !== true ? <Button className="min-h-11" onClick={() => void submitClaim()} disabled={!canTransact || claimed !== false} data-testid="devnet-claim">{activeAction === "claim" && busy ? pipeline.label : "Get test tokens"}</Button> : <Button variant="ghost" className="min-h-11" onClick={() => void refresh()} disabled={loading || busy}>{loading ? "Updating…" : "Refresh"}</Button>}
      </div>
      <details className="mt-2 text-xs">
        <summary className="min-h-10 cursor-pointer content-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Token balances</summary>
        <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">{DEVNET_MOCKS.map((mock) => {
          const balance = wallet?.walletBalances.find((item) => item.mint === mock.mint);
          const multiplier = wallet?.mintFacts.find((item) => item.mint === mock.mint)?.multiplier ?? mock.multiplier;
          return <div key={mock.mint} className="rounded-lg bg-muted/30 p-3"><p className="font-mono text-xs text-muted-foreground">{mock.symbol}</p><p className="mt-1 break-all font-mono text-sm tabular-nums">{balance ? grouped(scaledDevnetAmount(BigInt(balance.rawAmount), multiplier, mock.decimals)) : "--"}</p>{balance ? <p className="mt-1 text-[11px] text-muted-foreground">{grouped(tokenUnits(balance.rawAmount, mock.decimals))} unscaled</p> : null}</div>;
        })}</div>
      </details>
      {connected && wallet && !hasSol ? <p className="mt-2 text-xs leading-5 text-muted-foreground">Add devnet SOL for network fees. <a className="text-primary-text underline underline-offset-4" href="https://faucet.solana.com/" target="_blank" rel="noreferrer">Get devnet SOL</a></p> : null}
      {connected && !signTransaction ? <p className="mt-2 text-xs text-destructive">This wallet cannot sign transactions. Connect Phantom or Solflare.</p> : null}
      {activeAction === "claim" ? <div className="mt-3">{pipelineStatus}</div> : null}
      {formError && activeLease.current?.action === "claim" ? <div className="mt-3"><Alert>{formError}</Alert></div> : null}
    </div> : null}

    <div className="flex gap-2 rounded-xl bg-muted/30 p-1" role="group" aria-label="Basket action">
      <Button type="button" className="min-h-11 flex-1" variant={workspaceMode === "trade" ? "secondary" : "ghost"} aria-pressed={workspaceMode === "trade"} disabled={busy} onClick={() => setWorkspaceMode("trade")}>Use a basket</Button>
      <Button type="button" className="min-h-11 flex-1" variant={workspaceMode === "create" ? "secondary" : "ghost"} aria-pressed={workspaceMode === "create"} disabled={busy} onClick={() => setWorkspaceMode("create")}>Create a basket</Button>
    </div>

    {workspaceMode === "create" ? <Card>
      <CardHeader><CardTitle>Create your basket</CardTitle><CardDescription>Set your mix. We prepare everything else.</CardDescription></CardHeader>
      <CardContent>
        {createAvailability !== "ready" ? <div className="mb-5 rounded-xl border border-border bg-muted/20 p-4 text-sm" role="status" data-testid="devnet-create-availability">
          <p>{createAvailability === "checking" ? "Checking whether new devnet baskets are available…" : CREATE_UNAVAILABLE_NOTICE}</p>
          {createAvailability === "unavailable" ? <Button type="button" variant="outline" className="mt-3 min-h-10" onClick={() => void refreshCreateAvailability()} disabled={busy}>Check availability</Button> : null}
        </div> : null}
        <form onSubmit={(event) => void submitCreate(event)} className="space-y-5" aria-busy={busy}>
          <Field id="devnet-name" label="Basket name" value={name} onChange={setName} maxLength={64} disabled={busy} />
          <Field id="devnet-thesis" label="Your thesis" value={thesis} onChange={setThesis} maxLength={400} disabled={busy} />
          <CoverPicker value={coverId} onChange={setCoverId} disabled={busy} />
          {!coverId && <p className="text-xs text-muted-foreground">Select a basket image to continue.</p>}
          <fieldset className="space-y-3" disabled={busy}><legend className="pb-2 text-xs font-medium text-muted-foreground">Mix (%)</legend><div className="grid grid-cols-2 gap-3">{DEVNET_MOCKS.map((mock, i) => <Field key={mock.mint} id={`devnet-weight-${i}`} label={mock.symbol} value={weights[i]} decimal decimalPlaces={2} onChange={(value) => setWeights((old) => old.map((weight, index) => index === i ? value : weight))} />)}</div><div className="flex items-center justify-between gap-3 text-xs"><span className={validWeights ? "text-muted-foreground" : "text-destructive"}>{parsedWeights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0) / 100}% total{!validWeights ? " · Use positive weights adding to 100%" : ""}</span><Button type="button" variant="ghost" className="min-h-10" onClick={() => setWeights(["25", "25", "25", "25"])}>Equal weights</Button></div></fieldset>
          <div className="grid gap-4 sm:grid-cols-2"><Field id="devnet-seed" label="Starting test tokens" value={seedBudget} decimal onChange={setSeedBudget} disabled={busy} hint="Total unscaled tokens, split across your mix." /><Field id="devnet-management" label="Annual management fee (%)" value={management} decimal decimalPlaces={2} onChange={setManagement} disabled={busy} hint="2% recommended · 3% maximum" /></div>
          {managementBps === null || managementBps > 300 ? <p className="text-xs text-destructive">Choose a fee from 0% to 3%.</p> : null}
          {seedRaw === null || seedRaw <= 0n ? <p className="text-xs text-destructive">Enter a positive starting amount.</p> : null}
          <div className="flex flex-wrap items-center gap-5 rounded-xl bg-muted/20 p-4"><CreatePreviewDonut slices={slices} size={112} /><div className="min-w-0 flex-1 space-y-2 text-xs">{DEVNET_MOCKS.map((mock, i) => <div key={mock.mint} className="flex justify-between gap-3"><span>{mock.symbol}</span><span className="font-mono tabular-nums">{seedAmounts ? `${grouped(tokenUnits(seedAmounts[i], mock.decimals))} unscaled` : "--"}</span></div>)}</div></div>
          <p className="text-xs text-muted-foreground">You receive 1 basket share. Entry and exit fees are 0%.</p>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-xs leading-5"><input type="checkbox" className="mt-1 size-4 accent-primary focus-visible:ring-2 focus-visible:ring-ring" checked={legal} onChange={(event) => setLegal(event.target.checked)} disabled={busy} /><span>I understand this is a test basket. Weights, fees, thesis and image are fixed. Management fees mint shares and dilute holders. LEGAL_REVIEW_REQUIRED.</span></label>
          {createShortfall ? <p className="text-xs text-destructive">Get test tokens or lower the starting amount.</p> : null}
          {formError ? <Alert>{formError}</Alert> : null}
          <Button type="submit" className="min-h-11 w-full" disabled={createAvailability !== "ready" || !canTransact || !validCreate || createShortfall} data-testid="devnet-create">{activeAction === "create" && busy ? pipeline.label : "Create basket"}</Button>
          {activeAction === "create" ? pipelineStatus : null}
        </form>
      </CardContent>
    </Card> : <Card>
      <CardHeader><CardTitle>{tradeMode === "mint" ? "Add to a basket." : "Withdraw your tokens."}</CardTitle><CardDescription>{tradeMode === "mint" ? "Add test tokens and receive basket shares." : "Exchange shares for the tokens in your basket."}</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5"><label htmlFor="devnet-basket-select" className="text-xs font-medium text-muted-foreground">Choose a basket</label><select id="devnet-basket-select" className={INPUT_CLASS} value={selected?.detail.pubkey ?? ""} disabled={loading || busy || baskets.length === 0} onChange={(event) => void chooseBasket(event.target.value)}>{!selected ? <option value="">{loading ? "Loading baskets…" : "Choose a basket"}</option> : null}{selected && !baskets.some((row) => row.detail.pubkey === selected.detail.pubkey) ? <option value={selected.detail.pubkey}>{basketName(selected)}</option> : null}{baskets.map((row) => <option key={row.detail.pubkey} value={row.detail.pubkey}>{basketName(row)}{walletKey === row.detail.creator ? " · yours" : ""}</option>)}</select></div>

        {loadingBasket ? <p className="text-xs text-muted-foreground" role="status">Loading basket…</p> : null}
        {loading && !selected ? <div className="h-64 rounded-xl bg-muted/30" role="status" aria-label="Loading basket"><span className="sr-only">Loading basket…</span></div> : null}
        {!selected && !loading ? <div className="rounded-xl bg-muted/20 p-5 text-sm"><p className="font-medium">Choose a test basket to start</p><Button variant="outline" className="mt-3 min-h-11" disabled={busy} onClick={() => setWorkspaceMode("create")}>Create your own</Button></div> : null}
        {selected ? <>
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border p-3">
            <img src={devnetBasketCover(selected.detail.metadata_json, selected.detail.pubkey).src} alt="" width={56} height={56} className="size-14 shrink-0 rounded-md object-cover" />
            <div className="min-w-0"><p className="break-words font-display font-medium">{basketName(selected)}</p>{connected ? <p className="mt-1 text-xs text-muted-foreground">Your shares <span className="font-mono text-foreground">{selected.shareBalance !== null ? grouped(formatRawShares6(BigInt(selected.shareBalance))) : "--"}</span></p> : null}</div>
          </div>
          <fieldset className="flex gap-2" disabled={busy}><legend className="sr-only">Transaction type</legend><Button type="button" className="min-h-11 flex-1" variant={tradeMode === "mint" ? "secondary" : "outline"} aria-pressed={tradeMode === "mint"} onClick={() => setTradeMode("mint")}><ArrowDown className="size-4" aria-hidden="true" /> Add tokens</Button><Button type="button" className="min-h-11 flex-1" variant={tradeMode === "redeem" ? "secondary" : "outline"} aria-pressed={tradeMode === "redeem"} onClick={() => setTradeMode("redeem")}><ArrowUp className="size-4" aria-hidden="true" /> Withdraw</Button></fieldset>
          <form onSubmit={(event) => void submitTrade(event)} className="space-y-4" aria-busy={busy}>
            {tradeMode === "mint" ? <Field id="devnet-mint-amount" label="Test token amount" value={mintBudget} decimal onChange={setMintBudget} disabled={busy} hint="Total unscaled tokens. We split them across the basket for you." /> : <Field id="devnet-redeem-amount" label="Shares to withdraw" value={redeemShares} decimal decimalPlaces={6} onChange={setRedeemShares} disabled={busy} />}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" className="min-h-10" disabled={busy || !connected} onClick={() => tradeMode === "mint" ? setMintBudget(formatTokenUnitsInput(tokenUnits(maximumBudget(vaultAmounts(selected), walletAmounts(selected)) / 2n, 8))) : setRedeemShares(formatTokenUnitsInput(formatRawShares6(BigInt(selected.shareBalance ?? "0") / 2n), 6))}>Half</Button><Button type="button" variant="ghost" className="min-h-10" disabled={busy || !connected} onClick={() => tradeMode === "mint" ? setMintBudget(formatTokenUnitsInput(tokenUnits(maximumBudget(vaultAmounts(selected), walletAmounts(selected)), 8))) : setRedeemShares(formatTokenUnitsInput(formatRawShares6(BigInt(selected.shareBalance ?? "0")), 6))}>Max</Button></div>
            {displayedTrade ? <div className="rounded-xl bg-muted/20 p-4"><p className="text-xs text-muted-foreground">{tradeMode === "mint" ? "You receive approximately" : "Shares exchanged for your tokens"}</p><p className="mt-1 font-display text-3xl font-semibold tabular-nums">{grouped(formatRawShares6(displayedTrade.shares))} <span className="font-sans text-sm font-normal text-muted-foreground">shares</span></p><p className="mt-2 text-xs text-muted-foreground">{feesLine(selected.detail.entry_fee_bps, selected.detail.exit_fee_bps, selected.detail.management_fee_bps)}</p><details className="mt-2 text-xs"><summary className="min-h-10 cursor-pointer content-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{tradeMode === "mint" ? "What you add" : "What you receive"}</summary><TxSummaryCard>{selected.detail.constituents.map((mint, i) => <SummaryRow key={mint} label={DEVNET_MOCKS.find((mock) => mock.mint === mint)?.symbol ?? "Test token"} value={`${grouped(tokenUnits(displayedTrade.deposits[i], 8))} unscaled tokens`} />)}<SummaryRow label={tradeMode === "mint" ? "Entry fee" : "Exit fee"} value={`${grouped(formatRawShares6(displayedTrade.fee))} shares`} muted /><SummaryRow label="Network cost" value="Devnet SOL for fees and account setup" muted /><SummaryRow label="Basket" value={<a href={`https://explorer.solana.com/address/${selected.detail.pubkey}?cluster=devnet`} target="_blank" rel="noreferrer" className="min-h-10 content-center text-primary-text underline underline-offset-4">{truncateAddress(selected.detail.pubkey)}</a>} muted /><SummaryRow label="Annual fee" value="New shares dilute holders" muted /></TxSummaryCard></details></div> : <p className="text-xs text-muted-foreground">Enter a positive amount.</p>}
            {connected && tradePreview?.insufficient ? <p className="text-xs text-destructive">{tradeMode === "mint" ? "Get test tokens or choose a smaller amount." : "Choose an amount within your share balance."}</p> : null}
            {tradeMode === "mint" && selected.whitelistStatuses.some((status) => status !== "Active") ? <p className="text-xs text-destructive">Deposits are unavailable for one or more tokens. You can still withdraw.</p> : null}
            {formError ? <Alert>{formError}</Alert> : null}
            <Button type="submit" className="min-h-12 w-full" disabled={!canTransact || !tradePreview || tradePreview.insufficient || (tradeMode === "mint" && selected.whitelistStatuses.some((status) => status !== "Active"))} data-testid="devnet-trade-submit">{tradeActive && busy ? pipeline.label : tradeMode === "mint" ? "Add to basket" : "Withdraw to wallet"}</Button>
            <p className="text-center text-xs text-muted-foreground">Approve in your wallet. We handle the rest.</p>
          </form>
        </> : null}
        {tradeActive || activeAction === "create" ? pipelineStatus : null}
        <details className="text-xs"><summary className="min-h-10 cursor-pointer content-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Have a basket address?</summary><form onSubmit={(event) => { event.preventDefault(); void chooseBasket(basketAddress.trim()); }} className="flex items-end gap-2 pt-2"><div className="min-w-0 flex-1"><Field id="devnet-basket-address" label="Basket address" value={basketAddress} onChange={setBasketAddress} disabled={busy} /></div><Button type="submit" variant="outline" className="min-h-11" disabled={busy || loadingBasket || !basketAddress.trim()}>Open</Button></form></details>
      </CardContent>
    </Card>}
    {refreshNotice ? <p role="status" className="text-sm text-muted-foreground">{refreshNotice}</p> : null}
    <details className="text-xs leading-5 text-muted-foreground"><summary className="min-h-10 cursor-pointer content-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">About this devnet test</summary><p>Project mock tokens, not issuer-backed xStocks. Test balances are token quantities, not USD values. Basket shares represent your share of the test tokens. This is not investment advice. LEGAL_REVIEW_REQUIRED.</p></details>
  </div>;
}

function Alert({ children }: { children: ReactNode }) {
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm leading-6">{children}</div>;
}

function validateMint(snapshot: RawDevnetSnapshot, amounts: bigint[], supply: bigint) {
  if (snapshot.whitelistStatuses.some((status) => status !== "Active")) throw new Error("A constituent is unavailable for new mints. Redemption remains available.");
  if (amounts.some((amount) => amount > U64_MAX)) throw new Error("The token amount exceeds the transaction limit.");
  const balances = walletAmounts(snapshot);
  if (amounts.some((amount, i) => amount > balances[i])) throw new Error("Your wallet does not hold enough test tokens. Get test tokens or choose a smaller amount.");
  const checked = checkGrossShares(amounts, vaultAmounts(snapshot), supply);
  if (!checked.ok) throw new Error(checked.error.kind === "WeightMismatch" ? "The current vault ratio does not support these deposits. Refresh and choose the amount again." : "This amount cannot mint shares against the current vault. Increase the amount or choose another basket.");
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

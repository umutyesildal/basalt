"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import Link from "next/link";
import { ArrowLeft, ArrowRight, RefreshCw } from "lucide-react";

import { WalletGateBanner } from "@/components/create/wallet-gate";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  MANAGED_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  buildApproveManagedMix, buildCancelManagedMix, buildCreateManagedBasket,
  buildExpireManagedMix, buildFillManagedMix, buildMintManagedShares, buildProposeManagedMix,
  buildRedeemManagedShares, decodeManagedBasket, decodeManagedProposal,
  formatTokenAmount, identityMintPda, isLocalManagedEndpoint, parseTokenAmount,
  proposalPda, shareMintPda, tokenAta, vaultAuthorityPda,
  type ManagedBasketAccount, type ManagedProposalAccount,
} from "@/lib/managed-chain";
import { CLUSTER, RPC_ENDPOINT, explorerClusterQuery } from "@/lib/wallet";

type LoadedBasket = {
  address: PublicKey;
  state: ManagedBasketAccount;
  proposal: ManagedProposalAccount | null;
  vaultRaw: [bigint, bigint];
  walletSharesRaw: bigint;
  supplyRaw: bigint;
  slot: number;
};

const inputClass = "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "grid gap-1.5 text-sm font-medium text-foreground";

function short(key: PublicKey | string): string {
  const value = typeof key === "string" ? key : key.toBase58();
  return `${value.slice(0, 5)}…${value.slice(-5)}`;
}

function parseKey(value: string, name: string): PublicKey {
  try { return new PublicKey(value.trim()); }
  catch { throw new Error(`Enter a valid ${name} address.`); }
}

function parsePercent(value: string): number {
  const raw = parseTokenAmount(value.trim(), 2);
  if (raw <= 0n || raw >= 10_000n) throw new Error("Choose a mix between 0% and 100% for each asset.");
  return Number(raw);
}

async function rawBalance(connection: ReturnType<typeof useConnection>["connection"], ata: PublicKey, optional = false): Promise<bigint> {
  try { return BigInt((await connection.getTokenAccountBalance(ata, "confirmed")).value.amount); }
  catch (error) {
    if (optional && !(await connection.getAccountInfo(ata, "confirmed"))) return 0n;
    throw error;
  }
}

async function localMintDecimals(connection: ReturnType<typeof useConnection>["connection"], mint: PublicKey): Promise<number> {
  const info = await connection.getAccountInfo(mint, "confirmed");
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID) || info.data.length !== 82 || info.data[45] !== 1 || info.data.readUInt32LE(46) !== 0) {
    throw new Error("Choose an initialized, extension-free local Token-2022 mint without freeze authority.");
  }
  if (info.data[44] > 12) throw new Error("This prototype supports at most 12 token decimals.");
  return info.data[44];
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex min-w-0 justify-between gap-4 border-b border-border/70 py-2.5 last:border-b-0"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="min-w-0 break-all text-right font-mono text-sm tabular-nums">{value}</dd></div>;
}

export function ManagedLab() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const tx = useTransactionFlow();
  const localOnly = isLocalManagedEndpoint(CLUSTER, RPC_ENDPOINT);
  const [mode, setMode] = useState<"open" | "create">("open");
  const [basketAddress, setBasketAddress] = useState("");
  const [loaded, setLoaded] = useState<LoadedBasket | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparingSample, setPreparingSample] = useState(false);
  const [sampleReady, setSampleReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programReady, setProgramReady] = useState<boolean | null>(null);

  const [mintA, setMintA] = useState("");
  const [mintB, setMintB] = useState("");
  const [guardian, setGuardian] = useState("");
  const [seedA, setSeedA] = useState("10");
  const [seedB, setSeedB] = useState("10");
  const [createWeight, setCreateWeight] = useState("50");
  const [depositA, setDepositA] = useState("1");
  const [redeemShares, setRedeemShares] = useState("0.1");
  const [proposedWeight, setProposedWeight] = useState("40");
  const [inputIndex, setInputIndex] = useState<0 | 1>(0);
  const [maxInput, setMaxInput] = useState("1");
  const [minOutput, setMinOutput] = useState("0.75");
  const [fillOutput, setFillOutput] = useState("0.8");

  const prepareSample = useCallback(async () => {
    if (!localOnly || !publicKey || !connected || programReady !== true) {
      setError("Connect a wallet to the local validator first.");
      return;
    }
    setPreparingSample(true);
    setError(null);
    try {
      const response = await fetch("/api/managed/lab/fixture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: publicKey.toBase58() }),
        cache: "no-store",
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
          ? payload.error : "Local sample setup failed.";
        throw new Error(message);
      }
      if (!payload || typeof payload !== "object" || !("wallet" in payload) || !("tokenA" in payload) || !("tokenB" in payload) ||
          payload.wallet !== publicKey.toBase58() || typeof payload.tokenA !== "string" || typeof payload.tokenB !== "string") {
        throw new Error("The sample response was incomplete.");
      }
      const a = parseKey(payload.tokenA, "Token A"), b = parseKey(payload.tokenB, "Token B");
      const [da, db, balanceA, balanceB] = await Promise.all([
        localMintDecimals(connection, a), localMintDecimals(connection, b),
        rawBalance(connection, tokenAta(publicKey, a)), rawBalance(connection, tokenAta(publicKey, b)),
      ]);
      if (da !== 6 || db !== 6 || balanceA < 10_000_000n || balanceB < 10_000_000n) {
        throw new Error("The two sample tokens did not reach your wallet. Try again.");
      }
      setMintA(a.toBase58());
      setMintB(b.toBase58());
      setSeedA("10");
      setSeedB("10");
      setCreateWeight("50");
      setSampleReady(true);
      setMode("create");
    } catch (cause) {
      setSampleReady(false);
      setError(cause instanceof Error ? cause.message : "Local sample setup failed.");
    } finally { setPreparingSample(false); }
  }, [connected, connection, localOnly, programReady, publicKey]);

  useEffect(() => {
    if (!localOnly) return;
    void connection.getAccountInfo(MANAGED_PROGRAM_ID, "confirmed")
      .then((info) => setProgramReady(Boolean(info?.executable)))
      .catch(() => setProgramReady(false));
  }, [connection, localOnly]);

  const loadBasket = useCallback(async (addressText: string) => {
    if (!localOnly) return;
    setLoading(true); setError(null);
    try {
      const address = parseKey(addressText, "basket");
      const info = await connection.getAccountInfo(address, "confirmed");
      if (!info || !info.owner.equals(MANAGED_PROGRAM_ID)) throw new Error("No Managed V2 basket found at this address.");
      const state = decodeManagedBasket(info.data);
      if (!state.shareMint.equals(shareMintPda(address)) || !state.identityMint.equals(identityMintPda(address))) {
        throw new Error("Basket identity does not match the Managed V2 program.");
      }
      const authority = vaultAuthorityPda(address);
      const [a, b, supply, shares, proposalInfo, slot] = await Promise.all([
        rawBalance(connection, tokenAta(authority, state.mints[0])),
        rawBalance(connection, tokenAta(authority, state.mints[1])),
        connection.getTokenSupply(state.shareMint, "confirmed").then((result) => BigInt(result.value.amount)),
        publicKey ? rawBalance(connection, tokenAta(publicKey, state.shareMint), true) : Promise.resolve(0n),
        state.pendingProposalNonce === null ? Promise.resolve(null) : connection.getAccountInfo(proposalPda(address, state.pendingProposalNonce), "confirmed"),
        connection.getSlot("confirmed"),
      ]);
      const proposal = proposalInfo ? decodeManagedProposal(proposalInfo.data) : null;
      if (proposalInfo && !proposalInfo.owner.equals(MANAGED_PROGRAM_ID)) throw new Error("Proposal is not owned by Managed V2.");
      if (state.pendingProposalNonce !== null && (!proposal || proposal.nonce !== state.pendingProposalNonce)) {
        throw new Error("The active proposal could not be verified.");
      }
      setLoaded({ address, state, proposal, vaultRaw: [a, b], supplyRaw: supply, walletSharesRaw: shares, slot });
      setBasketAddress(address.toBase58());
      window.history.replaceState(null, "", `/managed/lab?basket=${address.toBase58()}`);
    } catch (cause) {
      setLoaded(null);
      setError(cause instanceof Error ? cause.message : "Basket could not be loaded.");
    } finally { setLoading(false); }
  }, [connection, localOnly, publicKey]);

  useEffect(() => {
    if (!localOnly) return;
    const address = new URLSearchParams(window.location.search).get("basket");
    if (address) {
      setBasketAddress(address);
      void loadBasket(address);
    }
    // Re-read the connected holder's share balance when the wallet changes.
  }, [publicKey, localOnly, loadBasket]);

  const submit = useCallback(async (build: () => TransactionInstruction | Promise<TransactionInstruction>, after?: () => void) => {
    setError(null);
    if (!localOnly || !publicKey || !connected || programReady !== true) {
      setError("Connect a wallet to a running local validator first."); return;
    }
    try {
      const instruction = await build();
      await tx.run(async () => {
        const blockhash = await connection.getLatestBlockhash("confirmed");
        const message = new TransactionMessage({
          payerKey: publicKey,
          recentBlockhash: blockhash.blockhash,
          // Atomic creation uses more compute than the V0 UI's default 500k.
          instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }), instruction],
        }).compileToV0Message();
        return {
          transaction: new VersionedTransaction(message),
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        };
      }, undefined, { onComplete: after });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare this transaction.");
    }
  }, [connected, connection, localOnly, programReady, publicKey, tx]);

  const estimatedRedeem = useMemo(() => {
    if (!loaded || !redeemShares) return null;
    try {
      const shares = parseTokenAmount(redeemShares, 6);
      if (shares <= 0n || shares > loaded.walletSharesRaw || loaded.supplyRaw <= 0n) return null;
      return [0, 1].map((i) => `${formatTokenAmount(loaded.vaultRaw[i] * shares / loaded.supplyRaw, loaded.state.decimals[i])} Token ${i === 0 ? "A" : "B"}`).join(" + ");
    } catch { return null; }
  }, [loaded, redeemShares]);

  const depositB = useMemo(() => {
    if (!loaded || !depositA || loaded.vaultRaw[0] === 0n) return null;
    try {
      const a = parseTokenAmount(depositA, loaded.state.decimals[0]);
      return (loaded.vaultRaw[1] * a + loaded.vaultRaw[0] - 1n) / loaded.vaultRaw[0];
    } catch { return null; }
  }, [loaded, depositA]);

  const estimatedShares = useMemo(() => {
    if (!loaded || depositB === null || loaded.supplyRaw <= 0n || loaded.vaultRaw[0] <= 0n || loaded.vaultRaw[1] <= 0n) return null;
    try {
      const amountA = parseTokenAmount(depositA, loaded.state.decimals[0]);
      const fromA = amountA * loaded.supplyRaw / loaded.vaultRaw[0];
      const fromB = depositB * loaded.supplyRaw / loaded.vaultRaw[1];
      return formatTokenAmount(fromA < fromB ? fromA : fromB, 6);
    } catch { return null; }
  }, [loaded, depositA, depositB]);

  const explorer = tx.state.signature
    ? `https://explorer.solana.com/tx/${tx.state.signature}${explorerClusterQuery(CLUSTER, RPC_ENDPOINT)}`
    : null;

  return <div className="mx-auto max-w-5xl space-y-8 pb-16">
    <div className="space-y-3 border-b border-border pb-7">
      <Link href="/managed" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Managed baskets</Link>
      <p className="section-label">Local prototype</p>
      <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Try a managed basket</h1>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Connect your wallet, create a basket with two local mock tokens, or open one to hold shares and propose a new mix.</p>
    </div>

    {!localOnly ? <Card><CardContent className="py-6"><p className="font-medium">This lab runs on a local validator.</p><p className="mt-2 text-sm leading-6 text-muted-foreground">The Managed V2 program is not deployed to this site’s current network. Run the app with <code>NEXT_PUBLIC_CLUSTER=localnet</code> and a local validator to enable wallet transactions.</p></CardContent></Card> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div><p className="text-sm font-medium">Local validator</p><p className="text-xs text-muted-foreground">{programReady === null ? "Checking program…" : programReady ? "Managed V2 program detected" : "Program unavailable — start the local validator"}</p></div>
        {connected && publicKey ? <span className="font-mono text-xs text-muted-foreground">{short(publicKey)}</span> : <span className="text-xs text-muted-foreground">Wallet disconnected</span>}
      </div>
      {!connected && <WalletGateBanner />}
      <div className="flex gap-2" role="group" aria-label="Managed basket action">
        <Button variant={mode === "open" ? "default" : "outline"} onClick={() => setMode("open")}>Open basket</Button>
        <Button variant={mode === "create" ? "default" : "outline"} onClick={() => setMode("create")}>Create basket</Button>
      </div>

      {mode === "create" ? <Card><CardHeader><CardTitle>Create with two mock tokens</CardTitle></CardHeader><CardContent className="space-y-5">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-medium">Start with a sample</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Get two local test tokens and fill the token and amount fields automatically.</p></div>
          <Button type="button" variant="outline" disabled={!connected || programReady !== true || preparingSample} onClick={() => void prepareSample()}>{preparingSample ? "Preparing…" : sampleReady ? "Sample ready" : "Prepare sample"}</Button>
        </div>
        <p className="text-sm text-muted-foreground">Creation deposits the amounts below and gives you one basket share plus the identity token. Fees are 0%.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>Token A mint<input className={inputClass} value={mintA} onChange={(e) => setMintA(e.target.value)} placeholder="Local Token-2022 mint" /></label>
          <label className={labelClass}>Token B mint<input className={inputClass} value={mintB} onChange={(e) => setMintB(e.target.value)} placeholder="Local Token-2022 mint" /></label>
          <label className={labelClass}>Token A to deposit<input className={inputClass} inputMode="decimal" value={seedA} onChange={(e) => setSeedA(e.target.value)} placeholder="10" /></label>
          <label className={labelClass}>Token B to deposit<input className={inputClass} inputMode="decimal" value={seedB} onChange={(e) => setSeedB(e.target.value)} placeholder="10" /></label>
          <label className={labelClass}>Token A target %<input className={inputClass} inputMode="decimal" value={createWeight} onChange={(e) => setCreateWeight(e.target.value)} /></label>
          <label className={labelClass}>Guardian wallet<input className={inputClass} value={guardian} onChange={(e) => setGuardian(e.target.value)} placeholder="Another wallet you control" /><span className="text-xs font-normal leading-5 text-muted-foreground">Use a different wallet you control to approve mix changes later.</span></label>
        </div>
        <details className="text-sm text-muted-foreground"><summary className="min-h-11 cursor-pointer py-2 text-foreground">Management terms</summary><p>Only these two assets can be reweighted. The guardian must approve a trade limit, then a public notice of at least 216,000 slots passes before a fill. Share holders can redeem from the actual vault throughout. The identity token grants no management rights.</p></details>
        <Button disabled={!connected || programReady !== true || tx.state.status === "awaiting-signature" || tx.state.status === "confirming"} onClick={() => {
          void (async () => {
            if (!publicKey) return;
            try {
              const a = parseKey(mintA, "Token A mint"), b = parseKey(mintB, "Token B mint"), g = parseKey(guardian, "guardian");
              if (a.equals(b) || g.equals(publicKey)) throw new Error("Choose two distinct tokens and a different guardian wallet.");
              const [da, db] = await Promise.all([localMintDecimals(connection, a), localMintDecimals(connection, b)]);
              const amounts: [bigint, bigint] = [parseTokenAmount(seedA, da), parseTokenAmount(seedB, db)];
              if (amounts.some((n) => n <= 0n)) throw new Error("Deposit an amount above zero for each token.");
              const balances = await Promise.all([rawBalance(connection, tokenAta(publicKey, a), true), rawBalance(connection, tokenAta(publicKey, b), true)]);
              if (balances.some((n, i) => n < amounts[i])) throw new Error("Your wallet needs both local mock tokens before creating this basket.");
              const weight = parsePercent(createWeight);
              const nonce = BigInt(Date.now());
              const creation = buildCreateManagedBasket({ creator: publicKey, guardian: g, nonce, mints: [a, b], weightsBps: [weight, 10_000 - weight], seedsRaw: amounts, noticeSlots: 216_000n });
              await submit(() => creation.instruction, () => { setMode("open"); void loadBasket(creation.basket.toBase58()); });
            } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare basket creation."); }
          })();
        }}>Create managed basket <ArrowRight className="size-4" /></Button>
      </CardContent></Card> : <>
        <Card><CardHeader><CardTitle>Open a basket</CardTitle></CardHeader><CardContent className="flex flex-col gap-3 sm:flex-row">
          <label className={`${labelClass} min-w-0 flex-1`}>Basket address<input className={inputClass} value={basketAddress} onChange={(e) => setBasketAddress(e.target.value)} placeholder="Paste a local basket address" /></label>
          <Button className="self-end" variant="outline" disabled={loading || !basketAddress.trim()} onClick={() => void loadBasket(basketAddress)}>{loading ? "Loading…" : <><RefreshCw className="size-4" /> Load basket</>}</Button>
        </CardContent></Card>
        {loaded && <>
          <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Basket v{loaded.state.version.toString()}</CardTitle><span className="text-xs text-muted-foreground">Confirmed · refreshed near slot {loaded.slot}</span></div></CardHeader><CardContent>
            <dl><Row label="Token A target" value={`${loaded.state.weightsBps[0] / 100}%`} /><Row label="Token B target" value={`${loaded.state.weightsBps[1] / 100}%`} /><Row label="Token A in vault" value={formatTokenAmount(loaded.vaultRaw[0], loaded.state.decimals[0])} /><Row label="Token B in vault" value={formatTokenAmount(loaded.vaultRaw[1], loaded.state.decimals[1])} /><Row label="Your shares" value={connected ? formatTokenAmount(loaded.walletSharesRaw, 6) : "Connect to view"} /></dl>
            <details className="mt-4 text-sm"><summary className="min-h-11 cursor-pointer py-2">Addresses and roles</summary><dl className="mt-2"><Row label="Manager" value={loaded.state.manager.toBase58()} /><Row label="Guardian" value={loaded.state.guardian.toBase58()} /><Row label="Share mint" value={loaded.state.shareMint.toBase58()} /><Row label="Identity token" value={loaded.state.identityMint.toBase58()} /><Row label="Asset A" value={loaded.state.mints[0].toBase58()} /><Row label="Asset B" value={loaded.state.mints[1].toBase58()} /></dl></details>
          </CardContent></Card>
          <div className="grid gap-4 md:grid-cols-2">
            <Card><CardHeader><CardTitle>Get basket shares</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Deposit both tokens in the vault’s current ratio.</p><label className={labelClass}>Token A amount<input className={inputClass} inputMode="decimal" value={depositA} onChange={(e) => setDepositA(e.target.value)} placeholder="Amount" /></label><p className="text-sm text-muted-foreground">Token B needed: {depositB === null ? "—" : formatTokenAmount(depositB, loaded.state.decimals[1])}</p><p className="text-sm text-muted-foreground">Estimated shares: {estimatedShares ?? "—"}</p><Button disabled={!connected || !depositB || depositB <= 0n || programReady !== true} onClick={() => { if (!publicKey || depositB === null) return; void submit(async () => {
              const amountA = parseTokenAmount(depositA, loaded.state.decimals[0]);
              if (amountA <= 0n || depositB <= 0n) throw new Error("Choose an amount above zero.");
              const balances = await Promise.all([
                rawBalance(connection, tokenAta(publicKey, loaded.state.mints[0]), true),
                rawBalance(connection, tokenAta(publicKey, loaded.state.mints[1]), true),
              ]);
              if (balances[0] < amountA || balances[1] < depositB) throw new Error("Your wallet needs both mock tokens for this deposit.");
              return buildMintManagedShares(loaded.address, loaded.state, publicKey, [amountA, depositB]);
            }, () => void loadBasket(loaded.address.toBase58())); }}>Get shares</Button></CardContent></Card>
            <Card><CardHeader><CardTitle>Redeem shares</CardTitle></CardHeader><CardContent className="space-y-3"><p className="text-sm text-muted-foreground">Receive your share of the vault’s current tokens, even while a change is pending.</p><label className={labelClass}>Shares to redeem<input className={inputClass} inputMode="decimal" value={redeemShares} onChange={(e) => setRedeemShares(e.target.value)} placeholder="0.1" /></label><Button variant="outline" size="sm" disabled={loaded.walletSharesRaw === 0n} onClick={() => setRedeemShares(formatTokenAmount(loaded.walletSharesRaw, 6))}>Max</Button><p className="text-sm text-muted-foreground">Estimated tokens out: {estimatedRedeem ?? "—"}</p><Button disabled={!connected || !estimatedRedeem || programReady !== true} onClick={() => { if (!publicKey) return; void submit(() => {
              const shares = parseTokenAmount(redeemShares, 6);
              if (shares <= 0n || shares > loaded.walletSharesRaw) throw new Error("Choose shares held by your wallet.");
              return buildRedeemManagedShares(loaded.address, loaded.state, publicKey, shares);
            }, () => { setRedeemShares(""); void loadBasket(loaded.address.toBase58()); }); }}>Redeem shares</Button></CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle>{loaded.proposal ? "Proposed mix" : "Propose a new mix"}</CardTitle></CardHeader><CardContent className="space-y-4">
            {loaded.proposal ? <><p className="text-sm text-muted-foreground">Current holdings remain in effect until a fill is confirmed. Redemption stays open.</p><dl><Row label="Proposed target" value={`${loaded.proposal.weightsBps[0] / 100}% / ${loaded.proposal.weightsBps[1] / 100}%`} /><Row label="Basket sells" value={`${formatTokenAmount(loaded.proposal.maxInputRaw, loaded.state.decimals[loaded.proposal.inputMint.equals(loaded.state.mints[0]) ? 0 : 1])} Token ${loaded.proposal.inputMint.equals(loaded.state.mints[0]) ? "A" : "B"}`} /><Row label="Minimum received" value={loaded.proposal.status === 1 ? `${formatTokenAmount(loaded.proposal.minOutputRaw, loaded.state.decimals[loaded.proposal.outputMint.equals(loaded.state.mints[0]) ? 0 : 1])} Token ${loaded.proposal.outputMint.equals(loaded.state.mints[0]) ? "A" : "B"}` : "Awaiting guardian"} /><Row label="Status" value={loaded.proposal.status === 0 ? "Awaiting guardian" : loaded.slot < Number(loaded.proposal.notBeforeSlot) ? "Public notice" : loaded.slot <= Number(loaded.proposal.expiresAtSlot) ? "Ready to fill" : "Expired"} /></dl>
              {publicKey?.equals(loaded.state.guardian) && loaded.proposal.status === 0 && <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className={`${labelClass} flex-1`}>Minimum output amount<input className={inputClass} inputMode="decimal" value={minOutput} onChange={(e) => setMinOutput(e.target.value)} placeholder="Amount" /></label><Button onClick={() => void submit(() => {
                const i = loaded.proposal!.outputMint.equals(loaded.state.mints[0]) ? 0 : 1;
                const amount = parseTokenAmount(minOutput, loaded.state.decimals[i]);
                if (amount <= 0n) throw new Error("Set a minimum output above zero.");
                return buildApproveManagedMix(loaded.address, publicKey, loaded.proposal!.nonce, amount);
              }, () => void loadBasket(loaded.address.toBase58()))}>Approve limit</Button></div>}
              {loaded.proposal.status === 1 && loaded.slot >= Number(loaded.proposal.notBeforeSlot) && loaded.slot <= Number(loaded.proposal.expiresAtSlot) && publicKey && <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label className={`${labelClass} flex-1`}>Tokens you offer<input className={inputClass} inputMode="decimal" value={fillOutput} onChange={(e) => setFillOutput(e.target.value)} placeholder="At least the minimum" /></label><Button onClick={() => void submit(async () => {
                const i = loaded.proposal!.outputMint.equals(loaded.state.mints[0]) ? 0 : 1;
                const amount = parseTokenAmount(fillOutput, loaded.state.decimals[i]);
                if (amount < loaded.proposal!.minOutputRaw) throw new Error("Offer at least the approved minimum.");
                const balance = await rawBalance(connection, tokenAta(publicKey, loaded.state.mints[i]), true);
                if (balance < amount) throw new Error(`Your wallet needs more Token ${i === 0 ? "A" : "B"} to fill this trade.`);
                return buildFillManagedMix(loaded.address, loaded.state, publicKey, loaded.proposal!.nonce, loaded.proposal!.maxInputRaw, amount);
              }, () => void loadBasket(loaded.address.toBase58()))}>Fill trade</Button></div>}
              {publicKey && (publicKey.equals(loaded.state.manager) || publicKey.equals(loaded.state.guardian)) && <Button variant="outline" onClick={() => void submit(() => buildCancelManagedMix(loaded.address, publicKey, loaded.proposal!.nonce), () => void loadBasket(loaded.address.toBase58()))}>Cancel proposal</Button>}
              {publicKey && ((loaded.proposal.status === 0 && loaded.slot > Number(loaded.proposal.approvalDeadlineSlot)) || (loaded.proposal.status === 1 && loaded.slot > Number(loaded.proposal.expiresAtSlot))) && <Button variant="outline" onClick={() => void submit(() => buildExpireManagedMix(loaded.address, loaded.proposal!.nonce), () => void loadBasket(loaded.address.toBase58()))}>Clear expired proposal</Button>}
            </> : publicKey?.equals(loaded.state.manager) ? <><div className="grid gap-4 sm:grid-cols-3"><label className={labelClass}>Token A new target %<input className={inputClass} inputMode="decimal" value={proposedWeight} onChange={(e) => setProposedWeight(e.target.value)} /></label><label className={labelClass}>Token to trade out<select className={inputClass} value={inputIndex} onChange={(e) => setInputIndex(Number(e.target.value) as 0 | 1)}><option value={0}>Token A</option><option value={1}>Token B</option></select></label><label className={labelClass}>Maximum amount out<input className={inputClass} inputMode="decimal" value={maxInput} onChange={(e) => setMaxInput(e.target.value)} placeholder="Amount" /></label></div><p className="text-sm text-muted-foreground">The guardian reviews a minimum output. Your proposal does not move any tokens.</p><Button onClick={() => void submit(() => {
              const weight = parsePercent(proposedWeight);
              if (weight === loaded.state.weightsBps[0]) throw new Error("Choose a different target mix.");
              const amount = parseTokenAmount(maxInput, loaded.state.decimals[inputIndex]);
              if (amount <= 0n || amount >= loaded.vaultRaw[inputIndex]) throw new Error("Trade amount must be below the vault balance.");
              return buildProposeManagedMix(loaded.address, loaded.state, publicKey, [weight, 10_000 - weight], loaded.state.mints[inputIndex], amount);
            }, () => void loadBasket(loaded.address.toBase58()))}>Submit proposal</Button></> : <p className="text-sm text-muted-foreground">Only the basket manager can propose a new mix. Connect the manager wallet to continue.</p>}
          </CardContent></Card>
        </>}
      </>}
      {(error || tx.state.error) && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error || tx.state.error}</p>}
      {tx.state.status !== "idle" && !tx.state.error && <div role="status" className="rounded-lg border border-border bg-card p-3 text-sm"><span className="capitalize">{tx.state.status.replaceAll("-", " ")}</span>{explorer && <> · <a className="underline" href={explorer} target="_blank" rel="noreferrer">View transaction</a></>}</div>}
      <p className="text-xs leading-5 text-muted-foreground">Local mock assets only. This program has no public asset allowlist, so the lab does not submit transactions to devnet or mainnet.</p>
    </>}
  </div>;
}

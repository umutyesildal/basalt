"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { WalletButton } from "@/components/shell/wallet-button";
import { DEVNET_OWNER_SETUP_POLICY as policy, devnetOwnerSetup, describeDevnetOwnerSetupError, type OwnerSetupProgress, type OwnerHandoffPackage, type OwnerSetupState, type OwnerSetupReceipt } from "@/lib/devnet-owner-setup";

import { createOwnerSetupDiagnostic, readOwnerSetupDiagnostic, saveOwnerSetupDiagnostic, clearOwnerSetupDiagnostic, ownerSetupDiagnosticStorageKey, ownerSetupDiagnosticMessage, OWNER_SETUP_PENDING_MESSAGE, type OwnerSetupDiagnostic, type OwnerSetupAttemptKind, type OwnerSetupAttemptStatus } from "@/lib/devnet-owner-setup-diagnostics";

type Receipts = Partial<Record<"handoff" | "setup", OwnerSetupReceipt>>;
const storageKey = `basalt:devnet-owner-setup:v1:${policy.owner}`;
const diagnosticStorageKey = ownerSetupDiagnosticStorageKey(policy.owner);
const stateReviewKey = (state: OwnerSetupState | null) => state ? JSON.stringify([state.loaderAuthority, state.whitelist, state.factoryInitialized, state.admitted, state.steps]) : "pending";
const actionLabel = (step: string) => step === "init-whitelist" ? "Initialize the owner's test-token whitelist" : step === "claim-whitelist" ? "Accept the proposed whitelist ownership" : step === "init-factory" ? "Initialize the owner's basket factory" : `Admit ${step.replace("admit-", "")} to this whitelist`;
const sol = (lamports: number) => `${(lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 6 })} SOL`;

export default function DevnetOwnerSetup() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const [observation, setObservation] = useState<OwnerSetupState | null>(null);
  const [handoff, setHandoff] = useState<Readonly<OwnerHandoffPackage> | null>(null);
  const [receipts, setReceipts] = useState<Receipts>({});
  const [diagnostic, setDiagnostic] = useState<OwnerSetupDiagnostic | null>(null);
  const diagnosticRef = useRef<OwnerSetupDiagnostic | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof devnetOwnerSetup.prepare>> | null>(null);
  const [checking, setChecking] = useState(false), [busy, setBusy] = useState(false), [loadingPackage, setLoadingPackage] = useState(false);
  const [acceptedKey, setAcceptedKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false), reads = useRef(0), packageReads = useRef(0), inFlight = useRef(false), receiptRef = useRef<Receipts>({});
  const owned = observation?.loaderAuthority === "owner";
  const complete = owned && observation.whitelist === "owner" && observation.factoryInitialized && observation.admitted.length === 4 && observation.steps.length === 0;
  const reviewKey = owned ? `setup:${stateReviewKey(observation)}` : `handoff:${handoff?.transactionBase64 ?? "pending"}`;
  const accepted = acceptedKey === reviewKey;
  const pending = Object.values(receipts).some(receipt => receipt?.status === "prepared");
  const isOwner = connected && publicKey?.toBase58() === policy.owner;
  const current = useRef({ connection, wallet: connected ? publicKey?.toBase58() ?? null : null, accepted, reviewKey });
  current.current = { connection, wallet: connected ? publicKey?.toBase58() ?? null : null, accepted, reviewKey };
  const previewCurrent = preview && `setup:${stateReviewKey(preview.state)}` === reviewKey;

  const dismissDiagnostic = useCallback(() => {
    try { clearOwnerSetupDiagnostic(window.localStorage, diagnosticStorageKey); } catch { /* A blocked store must not affect receipts or signing. */ }
    diagnosticRef.current = null; setDiagnostic(null);
  }, []);
  const recordDiagnostic = useCallback((kind: OwnerSetupAttemptKind, stage: OwnerSetupProgress, status: OwnerSetupAttemptStatus, message?: string) => {
    const next = createOwnerSetupDiagnostic(kind, stage, status, message);
    try { saveOwnerSetupDiagnostic(window.localStorage, diagnosticStorageKey, next); } catch { /* Keep the safe note visible even when this store is unavailable. */ }
    diagnosticRef.current = next; setDiagnostic(next);
  }, []);
  const saveReceipt = useCallback((receipt: OwnerSetupReceipt) => {
    const next = { ...receiptRef.current, [receipt.kind]: receipt };
    // Public signature/status only. Storage failure aborts before any broadcast.
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    receiptRef.current = next; setReceipts(next);
    if (receipt.status === "finalized" && diagnosticRef.current?.kind === receipt.kind) dismissDiagnostic();
  }, [dismissDiagnostic]);
  const refresh = useCallback(async () => {
    const generation = ++reads.current;
    setChecking(true); setNotice(null);
    try {
      for (const receipt of Object.values(receiptRef.current)) {
        if (receipt?.status !== "prepared") continue;
        const next = await devnetOwnerSetup.reconcile(connection, receipt);
        if (generation !== reads.current || current.current.connection !== connection) return;
        saveReceipt(next);
      }
      const next = await devnetOwnerSetup.inspect(connection);
      if (generation === reads.current && current.current.connection === connection) setObservation(next);
    } catch {
      if (generation === reads.current && current.current.connection === connection) {
        setObservation(null); setNotice("Finalized setup could not be verified. Refresh once the reviewed programs are ready.");
      }
    } finally { if (generation === reads.current) setChecking(false); }
  }, [connection, saveReceipt]);
  useEffect(() => {
    mounted.current = true;
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
      const valid: Receipts = {};
      for (const kind of ["handoff", "setup"] as const) {
        const receipt = saved[kind];
        if (receipt?.version === 1 && receipt.owner === policy.owner && receipt.kind === kind && typeof receipt.signature === "string" && ["prepared", "finalized", "failed", "expired"].includes(receipt.status) && Array.isArray(receipt.steps)) valid[kind] = receipt;
      }
      receiptRef.current = valid; setReceipts(valid);
      const previous = readOwnerSetupDiagnostic(window.localStorage, diagnosticStorageKey);
      if (previous && valid[previous.kind]?.status !== "finalized") {
        diagnosticRef.current = previous; setDiagnostic(previous);
      } else if (previous) clearOwnerSetupDiagnostic(window.localStorage, diagnosticStorageKey);
    } catch { setNotice("Browser storage is unavailable. Enable local storage before signing setup transactions."); }
    return () => { mounted.current = false; reads.current++; };
  }, []);
  useEffect(() => {
    setObservation(null); setAcceptedKey(null); setPreview(null);
    void refresh(); return () => { reads.current++; };
  }, [connection, publicKey?.toBase58(), connected, refresh]);

  const loadPackage = async () => {
    if (inFlight.current || loadingPackage || pending) return;
    const generation = ++packageReads.current;
    setLoadingPackage(true); setHandoff(null); setAcceptedKey(null); setNotice(null);
    try {
      // Fixed same-origin public package only. No URL, query or signer endpoint override.
      const response = await fetch("/devnet/owner-handoff.json", { cache: "no-store", redirect: "error", credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) throw new Error("unavailable");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength; if (size > 8_192) throw new Error("oversized");
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const next = devnetOwnerSetup.parsePackage(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (mounted.current && generation === packageReads.current) { setHandoff(next); setNotice("Public handoff checked. Your wallet will supply the owner signature."); }
    } catch {
      if (mounted.current && generation === packageReads.current) setNotice("The reviewed public handoff is not available yet. Refresh later or import its JSON file below.");
    } finally { if (mounted.current && generation === packageReads.current) setLoadingPackage(false); }
  };
  const importPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const generation = ++packageReads.current;
    setHandoff(null); setAcceptedKey(null); setNotice(null);
    if (!file || inFlight.current || loadingPackage) return;
    try {
      if (file.size > 8_192) throw new Error("oversized");
      const next = devnetOwnerSetup.parsePackage(await file.text());
      if (!mounted.current || generation !== packageReads.current) return;
      setHandoff(next);
      setNotice("Public handoff checked. The programs and durable nonce are verified again before your wallet opens.");
    } catch { setNotice("Choose the reviewed public handoff JSON file. Its instructions and bootstrap signature must match this setup."); }
  };
  const reviewSetup = async () => {
    if (!publicKey || !isOwner || inFlight.current || pending) return;
    inFlight.current = true; setBusy(true); setNotice(null); setPreview(null); setAcceptedKey(null);
    const expected = { connection, wallet: publicKey.toBase58() };
    try {
      const next = await devnetOwnerSetup.prepare(connection, publicKey, observation?.contextSlot);
      if (!mounted.current || current.current.connection !== expected.connection || current.current.wallet !== expected.wallet) return;
      setObservation(next.state); setPreview(next);
    } catch { setNotice("Setup review did not complete. Refresh the owner, treasury and finalized state before trying again."); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const start = async () => {
    if (!publicKey || !signTransaction || !isOwner || !accepted || inFlight.current || pending || !observation) return;
    const kind = owned ? "setup" : "handoff";
    if (kind === "handoff" && !handoff || kind === "setup" && !previewCurrent) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    let stoppedAt: OwnerSetupProgress = "checking";
    const options = {
      wallet: publicKey, signTransaction: (transaction: import("@solana/web3.js").Transaction) => signTransaction(transaction),
      current: () => ({ ...current.current, active: mounted.current }), reviewKey, onPrepared: saveReceipt,
      onProgress: (status: "checking" | "simulating" | "signing" | "confirming") => {
        stoppedAt = status;
        // Record the wallet step before its promise, so a stalled request or reload stays diagnosable.
        if (mounted.current) recordDiagnostic(kind, status, "in-progress");
        const labels = { checking: "Checking finalized accounts…", simulating: "Simulating the reviewed transaction…", signing: "Confirm in your owner wallet.", confirming: "Waiting for finalized confirmation…" };
        if (mounted.current) setProgress(labels[status]);
      },
    };
    try {
      const receipt = kind === "handoff" ? await devnetOwnerSetup.submitHandoff(connection, handoff!, options) : await devnetOwnerSetup.submitSetup(connection, preview!, options);
      saveReceipt(receipt); setAcceptedKey(null); setPreview(null);
      if (receipt.status === "prepared") setNotice("The transaction is saved for reconciliation. Refresh its status before signing anything else.");
      else if (receipt.status === "failed") recordDiagnostic(kind, "confirming", "failed", "The transaction finalized with an error. Refresh and review the remaining actions.");
      await refresh();
    } catch (error) {
      setAcceptedKey(null);
      const message = receiptRef.current[kind]?.status === "prepared" ? OWNER_SETUP_PENDING_MESSAGE : describeDevnetOwnerSetupError(error, stoppedAt);
      if (mounted.current) recordDiagnostic(kind, stoppedAt, "failed", message);
    } finally { inFlight.current = false; if (mounted.current) { setBusy(false); setProgress(null); } }
  };

  const diagnosticMessage = diagnostic ? ownerSetupDiagnosticMessage(diagnostic, receipts[diagnostic.kind]) : null;

  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
    <Link href="/devnet" className="inline-flex min-h-10 items-center text-sm text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">Back to devnet baskets</Link>
    <Card><CardHeader><CardTitle>Devnet owner setup</CardTitle><CardDescription>Review the handoff and initialize the new test namespace with your own wallet.</CardDescription></CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3 text-sm">
          <div><p className="text-xs text-muted-foreground">Owner wallet</p><p className="break-all font-mono">{policy.owner}</p></div>
          <div><p className="text-xs text-muted-foreground">Fee recipient</p><p className="break-all font-mono">{policy.treasury ?? "Awaiting a reviewed recipient"}</p></div>
        </div>
        <WalletButton />
        <div role="status" aria-live="polite" className="rounded-md border border-border p-4 text-sm" data-testid="owner-claim-status">
          {progress ?? (checking ? "Checking finalized devnet state…" : complete ? "Owner setup verified on devnet." : owned ? observation.whitelist === "waiting-proposal" ? "Waiting for the bootstrap administrator to propose the existing whitelist handoff." : "Program ownership verified. Review initialization next." : observation ? "The reviewed programs are ready for owner acceptance." : "Waiting for finalized program verification.")}
        </div>
        {diagnostic && diagnosticMessage ? <div role="status" aria-live="polite" className="space-y-2 rounded-md border border-border p-4 text-sm" data-testid="owner-setup-last-attempt">
          <div className="flex items-center justify-between gap-3"><p className="font-medium">{diagnostic.status === "failed" ? "Last attempt stopped" : "Last recorded attempt"}</p><Button variant="ghost" size="sm" onClick={dismissDiagnostic} disabled={busy}>Dismiss note</Button></div>
          <p>{diagnosticMessage}</p>
          <p className="text-xs text-muted-foreground">{diagnostic.kind === "handoff" ? "Ownership" : "Initialization"} · {({ checking: "Account verification", simulating: "Simulation", signing: "Wallet signature", confirming: "Transaction status" })[diagnostic.stage]} · <time dateTime={diagnostic.at}>{new Date(diagnostic.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></p>
        </div> : null}
        {!isOwner ? <p className="text-sm text-muted-foreground">Connect the designated owner wallet to continue.</p> : null}
        {!owned && !complete ? <section className="space-y-4" aria-labelledby="handoff-heading">
          <h2 id="handoff-heading" className="font-medium">1. Accept program ownership</h2>
          <p className="text-sm text-muted-foreground">Your signature accepts upgrade authority for the whitelist, factory and basket programs. The bootstrap wallet pays this network fee.</p>
          <Button variant="outline" onClick={() => void loadPackage()} disabled={busy || pending || loadingPackage}>{loadingPackage ? "Loading public handoff…" : "Load owner handoff"}</Button>
          <details className="text-sm"><summary className="flex min-h-10 cursor-pointer items-center text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring">Import a public handoff file</summary><div className="space-y-2 pt-2"><label htmlFor="owner-handoff-file">Public handoff JSON</label><input id="owner-handoff-file" type="file" accept=".json,application/json" disabled={busy || pending || loadingPackage} onChange={event => void importPackage(event)} className="block min-h-10 w-full rounded-md border border-input bg-background p-2 text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2 file:text-foreground focus-visible:ring-2 focus-visible:ring-ring" /></div></details>
          {handoff ? <p className="text-xs text-muted-foreground">Bootstrap signature verified. Build reference: <span className="font-mono">{handoff.sourceCommit.slice(0, 12)}</span>. This reference alone does not verify deployed code.</p> : null}
        </section> : null}
        {owned && !complete && observation.whitelist !== "waiting-proposal" ? <section className="space-y-4" aria-labelledby="initialize-heading">
          <h2 id="initialize-heading" className="font-medium">2. Initialize owner setup</h2>
          <p className="text-sm text-muted-foreground">Your wallet initializes the remaining accounts with the recipient above and the fixed 90% manager, 10% treasury fee split.</p>
          <ul className="space-y-2 text-sm">{(previewCurrent ? preview.steps : observation.steps).map(step => <li key={step}>{actionLabel(step)}</li>)}</ul>
          {previewCurrent ? <div className="rounded-md border border-border p-3 text-sm"><p>Account rent: <span className="font-mono tabular-nums">{sol(preview.rentLamports)}</span></p><p>Network fee: <span className="font-mono tabular-nums">{sol(preview.feeLamports)}</span></p></div> : <Button variant="outline" onClick={() => void reviewSetup()} disabled={!isOwner || busy || checking || pending || !policy.treasury}>Review setup</Button>}
        </section> : null}
        {!complete && isOwner && (owned ? !!previewCurrent : !!handoff) ? <label className="flex min-h-10 items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4 focus-visible:ring-2 focus-visible:ring-ring" checked={accepted} disabled={busy || pending} onChange={event => setAcceptedKey(event.target.checked ? reviewKey : null)} /><span>{owned ? "I approve these devnet setup actions, the fee recipient and the displayed rent and network fee." : "I accept upgrade authority for these three devnet programs with this owner wallet."}</span></label> : null}
        <div className="flex flex-wrap gap-3">
          {!complete && (owned ? !!previewCurrent : !!handoff) ? <Button onClick={() => void start()} disabled={!isOwner || !signTransaction || !accepted || busy || checking || pending || !observation} data-testid="owner-claim-submit">{busy ? "Waiting for owner approval…" : owned ? "Initialize with owner wallet" : "Accept with owner wallet"}</Button> : null}
          <Button variant="outline" onClick={() => void refresh()} disabled={busy || checking}>Refresh status</Button>
        </div>
        {notice ? <p role="alert" className="text-sm text-muted-foreground">{notice}</p> : null}
        {Object.values(receipts).map(receipt => receipt ? <p className="text-sm" key={receipt.signature}><a className="inline-flex min-h-10 items-center underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${receipt.signature}?cluster=devnet`}>{receipt.kind === "handoff" ? "Ownership transaction" : "Setup transaction"}</a><span className="ml-2 text-muted-foreground">{receipt.status === "prepared" ? "Awaiting finalized reconciliation" : receipt.status === "finalized" ? "Finalized" : receipt.status === "expired" ? "Expired, review again" : "Failed"}</span></p> : null)}
        <p className="text-xs text-muted-foreground">Devnet only. Setup keeps basket creation disabled until the remaining checks pass. LEGAL_REVIEW_REQUIRED.</p>
      </CardContent>
    </Card>
  </main>;
}

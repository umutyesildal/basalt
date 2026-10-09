"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { WalletButton } from "@/components/shell/wallet-button";
import { useTransactionFlow } from "@/components/basket/use-transaction-flow";
import { DEVNET_OWNER_CLAIM_POLICY, inspectDevnetOwnerClaim, createDevnetOwnerClaimReview, OwnerClaimAlreadyCompleteError, type OwnerClaimState } from "@/lib/devnet-owner-claim";

export default function DevnetOwnerSetup() {
  const { connection } = useConnection();
  const { publicKey, connected, signTransaction } = useWallet();
  const flow = useTransactionFlow();
  const [observation, setObservation] = useState<OwnerClaimState | null>(null);
  const [checking, setChecking] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const reads = useRef(0), inFlight = useRef(false), mounted = useRef(false);
  const current = useRef({ connection, wallet: publicKey?.toBase58() ?? null, accepted });
  current.current = { connection, wallet: publicKey?.toBase58() ?? null, accepted };
  const isOwner = publicKey?.toBase58() === DEVNET_OWNER_CLAIM_POLICY.owner;
  const claimed = observation?.status === "claimed";
  const busy = starting || ["preparing-alt", "simulating", "awaiting-signature", "confirming"].includes(flow.state.status);

  const refresh = useCallback(async () => {
    const generation = ++reads.current;
    setChecking(true); setNotice(null);
    try {
      const next = await inspectDevnetOwnerClaim(connection);
      if (generation === reads.current && current.current.connection === connection) setObservation(next);
    } catch {
      if (generation === reads.current && current.current.connection === connection) {
        setObservation(null); setNotice("The devnet handoff could not be verified yet. Refresh once setup is ready.");
      }
    } finally { if (generation === reads.current) setChecking(false); }
  }, [connection]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setObservation(null); setAccepted(false); void refresh(); return () => { reads.current++; }; }, [connection, publicKey?.toBase58(), refresh]);

  const start = async () => {
    if (!publicKey || !isOwner || !accepted || inFlight.current || flow.state.signature) return;
    inFlight.current = true; setStarting(true); setNotice(null);
    const review = createDevnetOwnerClaimReview(connection, publicKey, () => ({ ...current.current, active: mounted.current }), undefined, observation?.contextSlot);
    const fresh = () => review.prepare();
    try {
      const first = await fresh();
      setObservation(first.state);
      if (first.state.status === "claimed") return;
      await flow.run(async () => {
        const next = await fresh();
        if (next.state.status === "claimed") throw new OwnerClaimAlreadyCompleteError();
        return next.instructions;
      }, undefined, {
        sendViaConnection: true, assertCurrent: review.assertCurrent,
        beforeSign: async () => {
          const next = await fresh();
          if (next.state.status === "claimed") throw new OwnerClaimAlreadyCompleteError();
        },
      });
      await refresh();
    } catch (error) {
      // Keep endpoint/provider details out of this public setup screen.
      if (error instanceof OwnerClaimAlreadyCompleteError) await refresh();
      else setNotice("The handoff was not sent. Refresh and review the designated owner and devnet setup.");
    } finally { inFlight.current = false; setStarting(false); }
  };

  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-10">
    <Link href="/devnet" className="text-sm text-muted-foreground underline underline-offset-4">Back to devnet baskets</Link>
    <Card><CardHeader><CardTitle>Accept devnet whitelist administration</CardTitle><CardDescription>This test setup uses one owner wallet. Multisig governance and mainnet approval are separate.</CardDescription></CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">The designated owner can accept permission to admit test tokens and pause new mints in this devnet namespace. Existing baskets and permissionless withdrawals remain unchanged. This step does not open new basket creation.</p>
        <div className="space-y-1"><p className="text-xs text-muted-foreground">Designated owner</p><p className="break-all font-mono text-sm">{DEVNET_OWNER_CLAIM_POLICY.owner}</p></div>
        <WalletButton />
        <div role="status" className="text-sm" data-testid="owner-claim-status">
          {claimed ? "Whitelist authority accepted by the designated owner." : checking ? "Checking the finalized devnet handoff…" : observation?.status === "ready" ? "The administrator proposed this owner. Ready for wallet review." : observation?.status === "waiting" ? "Waiting for the administrator to propose the owner handoff." : "Setup verification is pending."}
        </div>
        {!claimed && (!connected || !isOwner) ? <p className="text-sm text-muted-foreground">Connect the designated owner wallet above to accept. Other wallets can inspect this page but cannot claim this authority.</p> : null}
        {!claimed && isOwner ? <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} /><span>I accept whitelist administration for this devnet test namespace with my own wallet.</span></label> : null}
        <div className="flex flex-wrap gap-3">
          {!claimed ? <Button onClick={() => void start()} disabled={!isOwner || !signTransaction || !accepted || observation?.status !== "ready" || busy || checking || !!flow.state.signature} data-testid="owner-claim-submit">{busy ? "Reviewing owner acceptance…" : "Accept with owner wallet"}</Button> : null}
          <Button variant="outline" onClick={() => void refresh()} disabled={busy || checking}>Refresh status</Button>
        </div>
        {!claimed && notice ? <p role="alert" className="text-sm text-muted-foreground">{notice}</p> : null}
        {!claimed && flow.state.error ? <p role="alert" className="text-sm text-muted-foreground">The wallet acceptance did not complete. Refresh the finalized status before trying again.</p> : null}
        {flow.state.signature ? <p className="text-sm"><a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={`https://explorer.solana.com/tx/${flow.state.signature}?cluster=devnet`}>View acceptance transaction</a>{!claimed ? " — submitted; refresh for finalized owner confirmation." : ""}</p> : null}
        <p className="text-xs text-muted-foreground">Only the whitelist authority claim is requested. Your wallet pays the devnet network fee. No assets or private keys are requested. LEGAL_REVIEW_REQUIRED.</p>
      </CardContent>
    </Card>
  </main>;
}

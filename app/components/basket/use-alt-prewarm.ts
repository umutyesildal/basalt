"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { AltPreparationScope } from "@/lib/alt-preparation-scope";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  ensureMintRedeemAlt,
  mintRedeemNeedsAlt,
  type BasketCoreKeys,
} from "@/lib/transactions";

export type AltPrewarmStatus = "idle" | "preparing" | "ready" | "failed";

export interface SetupProgress {
  step: number;
  total: number;
}

/**
 * One-time basket-account preparation ("tek transaction" feel).
 *
 * Solana lookup tables activate a slot after creation, so a FIRST trade on a
 * basket needs the table created (and extended) before the main transaction —
 * that is why the owner saw three wallet approvals. This hook starts that
 * preparation in the background the moment the buy/redeem form opens (wallet
 * connected, basket known), so by the time the user fills amounts and presses
 * Confirm the ONLY approval left is the trade itself.
 *
 * Guarantees:
 *  - The preparation is shared with the trade-time `prepare` step: `ensureAlt`
 *    returns the SAME in-flight promise instead of starting a second, racing
 *    provisioning (two concurrent provisions could derive different slots and
 *    create two tables). If the user confirms before preparation finished, the
 *    trade simply waits for it — the old trade-time behaviour becomes the
 *    fallback, never a duplicate.
 *  - The table address is cached in the lib's module-level ALT_CACHE, so the
 *    redeem page reuses the buy page's table in the same tab; only genuinely
 *    missing addresses are ever extended.
 *  - A preparation failure never blocks trading: `ensureAlt` retries once at
 *    trade time, which is exactly the pre-existing flow.
 */
export function useAltPrewarm(keys: BasketCoreKeys | null) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [status, setStatus] = useState<AltPrewarmStatus>("idle");
  const [setupProgress, setSetupProgress] = useState<SetupProgress | null>(null);
  const [awaitingWallet, setAwaitingWallet] = useState(false);

  const scopeRef = useRef(new AltPreparationScope<PublicKey>());
  const identity = keys ? [publicKey, keys.factory, keys.basket, keys.shareMint, keys.creator, keys.treasury, ...keys.constituents].map(String).join(":") : "disconnected";
  scopeRef.current.select(identity, connection);
  const startedForRef = useRef<string | null>(null);

  const needsAlt = mintRedeemNeedsAlt(keys?.constituents.length ?? 0);

  const prepare = useCallback((): Promise<PublicKey> => {
    if (!publicKey || !keys) return Promise.reject(new Error("Connect a wallet first."));
    return scopeRef.current.run(identity, connection, async (isCurrent) => {
      if (isCurrent()) setStatus("preparing");
      try {
        const handle = await ensureMintRedeemAlt({
          connection, keys, sendTransaction: async (transaction, rpc) => {
            if (!isCurrent()) throw new Error("Your basket, wallet or network changed. Prepare the current basket again.");
            return sendTransaction(transaction, rpc);
          },
          onAwaitingWallet: value => { if (isCurrent()) setAwaitingWallet(value); },
          onProgress: (step, total) => { if (isCurrent()) setSetupProgress({step, total}); },
        });
        if (isCurrent()) setStatus("ready");
        return handle.lookupTableAddress;
      } catch (error) {
        if (isCurrent()) setStatus("failed");
        throw error;
      }
    });
  }, [connection, identity, keys, publicKey, sendTransaction]);

  useEffect(() => {
    startedForRef.current = null;
    setStatus("idle"); setSetupProgress(null); setAwaitingWallet(false);
  }, [connection, identity]);

  // Pre-warm: fire once per (wallet, basket) as soon as the form is live.
  useEffect(() => {
    if (!needsAlt || !publicKey || !keys) return;
    if (startedForRef.current === identity) return;
    startedForRef.current = identity;
    void prepare().catch(() => {
      // Quiet by design — the trade-time prepare step surfaces failures with
      // typed copy and a Retry action. The chip flips to the fallback line.
    });
  }, [needsAlt, publicKey, keys, prepare, identity]);

  /** Trade-time accessor: awaits the shared preparation (or retries it once). */
  const ensureAlt = useCallback((): Promise<PublicKey> => {
    return prepare();
  }, [prepare]);

  const assertCurrentContext = useCallback(() => { scopeRef.current.assertCurrent(identity, connection); }, [identity, connection]);
  return { needsAlt, status, setupProgress, awaitingWallet, ensureAlt, assertCurrentContext };
}

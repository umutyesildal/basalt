"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChevronDown, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  WalletPickerMenu,
  isWalletReady,
  useMenuDismiss,
  useWalletConnect,
} from "@/components/shell/wallet-picker";

/**
 * Wallet gate after the disconnected Review summary and legal terms. The
 * steps stay browsable; deploying signs a create_basket
 * transaction from the creator's wallet. The single "Connect wallet" button
 * opens the exact picker menu the header control uses (same flow, same
 * glyphs), so there is one connect affordance per surface.
 */
export function WalletGateBanner({ className }: { className?: string }) {
  const { wallets, connecting } = useWallet();
  const { requestConnect } = useWalletConnect();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useMenuDismiss({
    open,
    onClose: () => setOpen(false),
    containerRef,
  });

  // Wallet extension detection happens only in the browser. Keep the first
  // render identical to SSR so a detected wallet cannot cause hydration drift.
  useEffect(() => setMounted(true), []);
  const hasReadyWallet = mounted && wallets.some((entry) => isWalletReady(entry.readyState));

  return (
    <div
      role="note"
      aria-label="Wallet not connected"
      className={
        "flex flex-col items-stretch gap-3 rounded-xl border border-border bg-muted/50 p-4 sm:flex-row sm:items-center " +
        (className ?? "")
      }
    >
      <Wallet className="hidden size-4 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Ready to deploy?</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Connect to check token balances and sign the transaction.
        </p>
      </div>
      <div ref={containerRef} className="relative w-full shrink-0 sm:w-auto">
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={connecting || !hasReadyWallet}
          title={hasReadyWallet ? undefined : "No wallet detected"}
          onClick={() => setOpen((v) => !v)}
        >
          {connecting ? "Connecting…" : hasReadyWallet ? "Connect wallet" : "No wallet detected"}
          <ChevronDown className="size-3.5 opacity-70" aria-hidden="true" />
        </Button>
        {open && (
          <WalletPickerMenu
            id={menuId}
            wallets={wallets}
            onPick={(name, ready) => {
              setOpen(false);
              requestConnect(name, ready);
            }}
          />
        )}
      </div>
    </div>
  );
}

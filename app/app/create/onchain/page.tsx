import { Suspense } from "react";
import type { Metadata } from "next";
import DevnetWorkspace from "@/components/devnet/devnet-workspace";

export const metadata: Metadata = { title: "Create on devnet", description: "Create, mint and redeem a basket with four test tokens on Solana devnet." };

export default function OnchainCreatePage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading devnet workspace…</p>}><DevnetWorkspace initialMode="create" /></Suspense>;
}

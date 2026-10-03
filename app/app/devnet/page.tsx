import { Suspense } from "react";
import type { Metadata } from "next";
import DevnetWorkspace from "@/components/devnet/devnet-workspace";

export const metadata: Metadata = {
  title: "Devnet test baskets",
  description: "Create, mint and redeem onchain test baskets with a connected Solana devnet wallet.",
};

export default function DevnetPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading devnet workspace…</p>}><DevnetWorkspace /></Suspense>;
}

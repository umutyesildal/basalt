import type { Metadata } from "next";
import { Suspense } from "react";

import CreateClient from "../create-client";

export const metadata: Metadata = {
  title: "Onchain Create — Basalt",
  description:
    "Deploy an immutable onchain strategy basket from eligible tokens. Devnet sample mints are mock assets, not issuer-backed xStocks.",
};

/**
 * The existing transaction wizard stays intact on its own route. It reads
 * search params for clone links, so keep the Next static-render boundary.
 */
export default function OnchainCreatePage() {
  return (
    <Suspense fallback={<CreateSuspenseFallback />}>
      <CreateClient />
    </Suspense>
  );
}

function CreateSuspenseFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl pb-16" role="status" aria-busy="true">
      <span className="sr-only">Loading the onchain create flow</span>
      <div className="h-9 w-72 animate-pulse motion-reduce:animate-none rounded-sm bg-muted" />
      <div className="mt-3 h-4 w-64 animate-pulse motion-reduce:animate-none rounded-sm bg-muted" />
      <div className="mt-6 h-[420px] animate-pulse motion-reduce:animate-none rounded-lg border border-border bg-card" />
    </div>
  );
}

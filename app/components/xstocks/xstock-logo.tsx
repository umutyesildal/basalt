"use client";

import { useState } from "react";
import type { XStockAsset } from "@/lib/xstock-types";

export function XStockLogo({ asset, size = 40 }: { asset: XStockAsset; size?: number }) {
  const [failed, setFailed] = useState(false);
  return <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-mono text-xs" style={{ width: size, height: size }} aria-hidden="true">{asset.logoUrl && !failed ? <img src={asset.logoUrl} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} className="h-full w-full object-contain" /> : asset.underlyingSymbol.slice(0, 2)}</span>;
}

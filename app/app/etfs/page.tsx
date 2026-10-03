import type { Metadata } from "next";
import { XStockCatalogGrid } from "@/components/xstocks/xstock-catalog-grid";

export const metadata: Metadata = { title: { absolute: "Basalt | Tokenized ETFs" }, description: "Explore issuer-verified ETFs available as xStocks on Solana." };

export default function EtfsPage() {
  return <div className="space-y-6"><header className="space-y-2"><h1 className="font-display text-3xl font-semibold">ETFs</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">Indexes, sectors and themes, tokenized on Solana.</p></header><XStockCatalogGrid assetClass="etf" /></div>;
}

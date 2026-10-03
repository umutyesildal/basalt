import type { Metadata } from "next";
import { StocksGrid } from "@/components/stocks/stocks-grid";

export const metadata: Metadata = { title: { absolute: "Basalt | Stocks" }, description: "Explore the official xStocks catalog on Solana, with token prices from Jupiter." };

export default function StocksPage() {
  return <div className="space-y-6"><header className="space-y-2"><h1 className="font-display text-3xl font-semibold">Stocks</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">The xStocks universe on Solana. Find the companies and ETFs behind your next idea.</p></header><StocksGrid /></div>;
}

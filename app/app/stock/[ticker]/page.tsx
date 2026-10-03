import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { IconCopyButton } from "@/components/ui/copy-button";
import { XStockLogo } from "@/components/xstocks/xstock-logo";
import { XStockMarketChart } from "@/components/xstocks/xstock-market-chart";
import { fetchXStockCatalog, fetchXStockPricePage, findXStock } from "@/lib/xstock-catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `${ticker} · Basalt`, description: "Explore this xStock and its price history." };
}

export default async function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const catalog = await fetchXStockCatalog();
  const asset = findXStock(catalog.data, ticker);
  if (!asset) return <Card className="mx-auto max-w-xl gap-4 p-6"><h1 className="font-display text-2xl">Asset not found</h1><p className="text-sm text-muted-foreground">This asset is not in the available issuer catalog.</p><Link href="/stocks" className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">Explore stocks<ArrowUpRight size={16} aria-hidden="true" /></Link></Card>;
  const { data: [quote] } = await fetchXStockPricePage([asset.mint]);
  const name = asset.name.replace(/ xStock$/i, "");
  const kind = asset.assetClass === "etf" ? "Tokenized ETF" : asset.assetClass === "stock" ? "Tokenized stock" : "xStock";
  return <div className="mx-auto max-w-4xl space-y-7">
    <Link href={asset.assetClass === "etf" ? "/etfs" : "/stocks"} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text"><ArrowLeft size={16} aria-hidden="true" />Back to {asset.assetClass === "etf" ? "ETFs" : "stocks"}</Link>
    <header className="flex items-center gap-4"><XStockLogo asset={asset} size={56} /><div className="min-w-0"><h1 className="break-words font-display text-3xl font-semibold">{name}</h1><p className="mt-2 font-mono text-sm text-muted-foreground">{asset.symbol}<span className="ml-3 font-sans">{kind}</span></p></div></header>
    <XStockMarketChart mint={asset.mint} symbol={asset.symbol} quote={quote} />
    <Card className="gap-0 px-5 sm:px-7"><details><summary className="flex min-h-16 cursor-pointer items-center justify-between gap-4 rounded-sm font-display text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">About {asset.symbol}<span className="text-muted-foreground" aria-hidden="true">+</span></summary>
      <div className="pb-6"><dl className="divide-y divide-border text-sm"><div className="flex flex-wrap items-center justify-between gap-3 py-4"><dt className="text-muted-foreground">Underlying ticker</dt><dd className="font-mono">{asset.underlyingSymbol}</dd></div><div className="flex flex-wrap items-center justify-between gap-3 py-4"><dt className="text-muted-foreground">Issuer</dt><dd>Backed</dd></div><div className="flex flex-wrap items-center justify-between gap-3 py-4"><dt className="text-muted-foreground">Network</dt><dd>Solana</dd></div><div className="space-y-3 py-4"><dt className="text-muted-foreground">Token mint</dt><dd className="flex items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-xs leading-6">{asset.mint}</span><IconCopyButton value={asset.mint} iconOnly /></dd></div>{asset.status === "halted" && <div className="flex justify-between gap-3 py-4"><dt className="text-muted-foreground">Issuer status</dt><dd>Trading halted</dd></div>}</dl>
        <div className="flex flex-wrap gap-5 border-t border-border pt-3"><a href={`https://solscan.io/token/${asset.mint}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">View token<ArrowUpRight size={15} aria-hidden="true" /></a><a href={asset.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">Issuer data<ArrowUpRight size={15} aria-hidden="true" /></a></div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">xStocks are issued instruments, not direct company shares. <Link href="/legal" className="underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-text">Disclosures</Link></p>
      </div></details></Card>
  </div>;
}

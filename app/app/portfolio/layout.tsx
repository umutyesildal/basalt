import type { Metadata } from "next";

/**
 * Portfolio layout — exists only to carry page metadata: the page itself is a
 * client component (wallet-gated) and cannot export metadata. absolute title:
 * the root layout's title template would otherwise append a second "· Basalt".
 */
export const metadata: Metadata = {
  title: { absolute: "Basalt | Portfolio" },
  description:
    "Basket share positions held by the connected wallet — shares, cost basis and reference value read from the indexer.",
};

export default function PortfolioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

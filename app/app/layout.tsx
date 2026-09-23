import type { Metadata } from "next";
import "./globals.css";
import { Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import { cn } from "@/lib/utils";

import { SiteHeader } from "@/components/shell/site-header";
import { MobileNav } from "@/components/shell/mobile-nav";
import { PendingTxBanner } from "@/components/feedback/pending-tx-banner";
import { AppProviders } from "./providers";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});
const geistMono = Geist_Mono({subsets:['latin'],variable:'--font-mono'});
// NEON FOUNDRY (cyberpunk-yellow): squared techno display face, used ONLY for
// the wordmark, headings, and hero stat numerals (see the globals.css
// utilities — never body/mono text). Everything else stays Geist.
const chakraPetch = Chakra_Petch({subsets:['latin'],weight:['500','600','700'],variable:'--font-display'});

export const metadata: Metadata = {
  // TODO(roman-empire): swap for the production domain before launch.
  metadataBase: new URL("http://localhost:3000"),
  title: {
    default: "Basalt — Stock Baskets",
    template: "%s · Basalt",
  },
  description:
    "Build and share a concept basket of stocks and ETFs in minutes.",
  openGraph: {
    title: "Basalt — Stock Baskets",
    description:
      "Build and share a concept basket of stocks and ETFs in minutes.",
    type: "website",
    siteName: "Basalt",
  },
  twitter: {
    card: "summary",
    title: "Basalt — Stock Baskets",
    description:
      "Build and share a concept basket of stocks and ETFs in minutes.",
  },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable, geistMono.variable, chakraPetch.variable)}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>
          <div className="flex min-h-screen flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
            >
              Skip to content
            </a>
            <SiteHeader />
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
              {children}
            </main>
            {/* Sent-while-hidden safety net: confirmation outcomes surface on
                any page (components/feedback/pending-tx.ts registry). */}
            <PendingTxBanner />
            {/* Floating mobile pill nav (wave-3): below lg only; the pb above
                reserves its space so the fixed bar never covers page content. */}
            <MobileNav />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}

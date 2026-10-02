import type { Metadata } from "next";
import Link from "next/link";

import ConceptCreate from "@/components/create/concept-create";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { decodeConceptBasket } from "@/lib/concept-share";

export const metadata: Metadata = {
  title: "Create a basket",
  description: "Pick your stocks, set the mix, and share your basket.",
};

export default async function CreatePage({ searchParams }: { searchParams: Promise<{ copy?: string | string[] }> }) {
  const params = await searchParams;
  const encoded = typeof params.copy === "string" ? params.copy : null;
  const basket = decodeConceptBasket(encoded);
  if (params.copy !== undefined && !basket) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <Card>
          <CardHeader className="space-y-3">
            <CardTitle className="font-display text-2xl">This basket link doesn’t work</CardTitle>
            <CardDescription>Start a new basket or choose another mix.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 sm:flex-row">
            <Link href="/create" className={buttonVariants({ className: "min-h-11" })}>Start a new basket</Link>
            <Link href="/explore" className={buttonVariants({ variant: "outline", className: "min-h-11" })}>Explore baskets</Link>
          </CardContent>
        </Card>
      </div>
    );
  }
  return <ConceptCreate key={encoded ?? "new"} initialBasket={basket} />;
}

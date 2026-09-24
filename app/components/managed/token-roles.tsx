import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function BasketColumns({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="miter"
      className={className}
    >
      <path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
      <path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
      <path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
    </svg>
  );
}

export function TokenRoles() {
  return (
    <section aria-labelledby="token-roles-heading">
      <div className="mb-5 max-w-2xl">
        <p className="section-label">Basket tokens</p>
        <h2 id="token-roles-heading" className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
          Identity and ownership stay separate
        </h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="h-full">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs text-muted-foreground">ONE · IDENTITY NFT</p>
              <CardTitle className="mt-2 text-lg">Basket identity</CardTitle>
            </div>
            <div className="grid size-11 shrink-0 place-items-center border border-primary/30 bg-primary/5 text-primary-text">
              <BasketColumns className="size-6" />
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-5">
            <p className="max-w-prose text-sm leading-6 text-muted-foreground">
              One per basket, minted to its creator. It identifies the basket; it is not the economic share.
            </p>
            <details className="border-t border-border pt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                Identity NFT details
              </summary>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The NFT grants no share or manager rights. Transferring it does not transfer the manager role.
              </p>
            </details>
          </CardContent>
        </Card>

        <Card className="h-full">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <p className="font-mono text-xs text-muted-foreground">FUNGIBLE · TOKEN-2022</p>
              <CardTitle className="mt-2 text-lg">Basket share</CardTitle>
            </div>
            <div className="grid size-11 shrink-0 grid-cols-2 gap-1 border border-border bg-muted/40 p-2" aria-hidden="true">
              <span className="bg-primary/80" />
              <span className="bg-muted-foreground/70" />
              <span className="bg-primary/55" />
              <span className="bg-muted-foreground/40" />
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between gap-5">
            <p className="max-w-prose text-sm leading-6 text-muted-foreground">
              Each share is a pro-rata claim on the basket’s actual vault assets.
            </p>
            <details className="border-t border-border pt-3">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                Share details
              </summary>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Share tokens are divisible and transferable. They are the tokens holders use to redeem their proportional assets.
              </p>
            </details>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

"use client";

import { ArrowUpRight, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ConceptBasket } from "@/lib/concept-basket";
import type { BasketPerformanceResponse } from "@/lib/basket-performance";
import { findBasketPerformanceSample, getBasketSharePerformance } from "@/lib/basket-share-performance";
import { useBasketPerformance } from "@/lib/use-basket-performance";
import { basketXIntent, ensureBasketPublicLink } from "@/lib/basket-social-share";
import { cn } from "@/lib/utils";

type ShareVariant = "default" | "outline" | "secondary" | "ghost" | "link";

type BasketXShareProps = { basket: ConceptBasket; className?: string; variant?: ShareVariant };

/** Custom mixes never borrow a published basket's weekly return. */
export function BasketXShareButton(props: BasketXShareProps) {
  return findBasketPerformanceSample(props.basket)
    ? <SampleBasketXShareButton {...props} />
    : <BasketXShareControl {...props} performanceData={null} waitingForPerformance={false} />;
}

function SampleBasketXShareButton(props: BasketXShareProps) {
  const { data, status } = useBasketPerformance();
  return <BasketXShareControl {...props} performanceData={data} waitingForPerformance={status === "loading"} />;
}

/** Prepare an editable X draft only after a click; this never publishes a post. */
function BasketXShareControl({ basket, className, variant = "outline", performanceData, waitingForPerformance }: BasketXShareProps & {
  performanceData: BasketPerformanceResponse | null;
  waitingForPerformance: boolean;
}) {
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState<{ href: string; key: string } | null>(null);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const pending = useRef(false);
  const popup = useRef<Window | null>(null);
  const statusId = useId();
  const performanceKey = JSON.stringify(getBasketSharePerformance(basket, performanceData));
  const contextKey = JSON.stringify([basket, origin, performanceKey, waitingForPerformance]);
  const latestContext = useRef(contextKey);
  latestContext.current = contextKey;
  const readyIntent = intent?.key === contextKey ? intent.href : "";

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    request.current += 1;
    pending.current = false;
    setBusy(false); setIntent(null); setMessage("");
    return () => {
      request.current += 1;
      pending.current = false;
      popup.current?.close();
      popup.current = null;
    };
  }, [basket, origin, performanceKey, waitingForPerformance]);

  async function prepare() {
    if (!origin || pending.current || waitingForPerformance) return;
    pending.current = true;
    const current = ++request.current;
    let draftWindow: Window | null = null;
    // Keep the browser's user activation. The async request cannot open a new
    // window later, and the draft never receives an opener reference.
    try {
      draftWindow = window.open("about:blank", "_blank");
      if (draftWindow) draftWindow.opener = null;
    } catch {
      draftWindow?.close();
      draftWindow = null;
    }
    popup.current = draftWindow;
    setBusy(true); setMessage("");
    try {
      const link = await ensureBasketPublicLink(basket, origin);
      const href = basketXIntent(basket, origin, link, performanceData);
      if (current !== request.current || contextKey !== latestContext.current) { draftWindow?.close(); return; }
      setIntent({ href, key: contextKey });
      if (draftWindow && !draftWindow.closed) {
        draftWindow.location.href = href;
        popup.current = null;
      } else {
        setMessage("Link ready. Tap Share on X.");
      }
    } catch {
      draftWindow?.close();
      if (current === request.current && contextKey === latestContext.current) setMessage("Couldn't prepare the link. Try again.");
    } finally {
      if (current === request.current) {
        popup.current = null;
        pending.current = false;
        setBusy(false);
      }
    }
  }

  const controlClass = cn("min-h-11 w-full gap-1.5", className);
  return <div className="min-w-0">
    {readyIntent ? <a href={readyIntent} target="_blank" rel="noopener noreferrer" aria-describedby={statusId} className={cn(buttonVariants({ variant }), controlClass)}>
      Share on X<ArrowUpRight aria-hidden="true" className="size-3.5" />
    </a> : <Button type="button" variant={variant} onClick={prepare} disabled={!origin || busy || waitingForPerformance} aria-busy={busy || waitingForPerformance} aria-describedby={statusId} className={controlClass}>
      {busy || waitingForPerformance ? <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> : null}
      {waitingForPerformance ? "Loading…" : busy ? "Preparing…" : "Share on X"}{!busy && !waitingForPerformance && <ArrowUpRight aria-hidden="true" className="size-3.5" />}
    </Button>}
    <p id={statusId} role="status" className={cn("mt-1 text-xs leading-5 text-muted-foreground", !message && "sr-only")}>{message}</p>
  </div>;
}

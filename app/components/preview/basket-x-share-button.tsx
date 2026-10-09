"use client";

import { ArrowUpRight, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ConceptBasket } from "@/lib/concept-basket";
import { basketXIntent, ensureBasketPublicLink } from "@/lib/basket-social-share";
import { cn } from "@/lib/utils";

type ShareVariant = "default" | "outline" | "secondary" | "ghost" | "link";

/** Prepare an editable X draft only after a click; this never publishes a post. */
export function BasketXShareButton({ basket, className, variant = "outline" }: {
  basket: ConceptBasket;
  className?: string;
  variant?: ShareVariant;
}) {
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [intent, setIntent] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const pending = useRef(false);
  const popup = useRef<Window | null>(null);
  const statusId = useId();

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    request.current += 1;
    pending.current = false;
    setBusy(false); setIntent(""); setMessage("");
    return () => {
      request.current += 1;
      pending.current = false;
      popup.current?.close();
      popup.current = null;
    };
  }, [basket, origin]);

  async function prepare() {
    if (!origin || pending.current) return;
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
      const href = basketXIntent(basket, origin, link);
      if (current !== request.current) { draftWindow?.close(); return; }
      setIntent(href);
      if (draftWindow && !draftWindow.closed) {
        draftWindow.location.href = href;
        popup.current = null;
      } else {
        setMessage("Link ready. Tap Share on X.");
      }
    } catch {
      draftWindow?.close();
      if (current === request.current) setMessage("Couldn't prepare the link. Try again.");
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
    {intent ? <a href={intent} target="_blank" rel="noopener noreferrer" aria-describedby={statusId} className={cn(buttonVariants({ variant }), controlClass)}>
      Share on X<ArrowUpRight aria-hidden="true" className="size-3.5" />
    </a> : <Button type="button" variant={variant} onClick={prepare} disabled={!origin || busy} aria-busy={busy} aria-describedby={statusId} className={controlClass}>
      {busy ? <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> : null}
      {busy ? "Preparing…" : "Share on X"}{!busy && <ArrowUpRight aria-hidden="true" className="size-3.5" />}
    </Button>}
    <p id={statusId} role="status" className={cn("mt-1 text-xs leading-5 text-muted-foreground", !message && "sr-only")}>{message}</p>
  </div>;
}

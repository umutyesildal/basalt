"use client";

import { ArrowUpRight, Download, ImagePlus, Loader2, Share2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createBasketImage } from "@/lib/basket-image";
import { basketImageFilename } from "@/lib/basket-image-layout";
import { basketPublicLink, basketSocialText, basketXIntent } from "@/lib/basket-social-share";
import type { ConceptBasket } from "@/lib/concept-basket";
import { cn } from "@/lib/utils";
import styles from "./basket-image.module.css";

export function BasketImageButton({ basket }: { basket: ConceptBasket }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef(0);
  const previousBasket = useRef(basket);
  const titleId = useId();
  const descriptionId = useId();
  const shareUrl = origin ? basketPublicLink(basket, origin) : "";

  useEffect(() => { setOrigin(window.location.origin); }, []);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (previousBasket.current === basket) return;
    previousBasket.current = basket;
    request.current += 1;
    setOpen(false); setImage(null); setFile(null); setBusy(false); setError(""); setShareError("");
  }, [basket]);
  useEffect(() => () => { request.current += 1; }, []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  useEffect(() => {
    try { setCanShare(Boolean(file && shareUrl && typeof navigator.share === "function" && navigator.canShare?.({ files: [file], title: basket.name, text: basketSocialText(basket), url: shareUrl }))); }
    catch { setCanShare(false); }
  }, [file, shareUrl, basket]);

  async function generate() {
    if (busy) return;
    setOpen(true);
    if (image) return;
    const current = ++request.current;
    setBusy(true); setError("");
    try {
      const blob = await createBasketImage(basket);
      if (current === request.current) {
        setImage(URL.createObjectURL(blob));
        setFile(new File([blob], basketImageFilename(basket.name), { type: "image/png" }));
      }
    } catch {
      if (current === request.current) setError("Couldn't create your image. Try again.");
    } finally { if (current === request.current) setBusy(false); }
  }

  async function shareImage() {
    if (!file || !canShare || sharing) return;
    setSharing(true); setShareError("");
    try {
      await navigator.share({ files: [file], title: basket.name, text: basketSocialText(basket), url: shareUrl });
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setShareError("Couldn't share. Download the PNG instead.");
    } finally { setSharing(false); }
  }

  return (
    <div>
      <Button type="button" variant="outline" onClick={generate} disabled={busy} className="min-h-11 w-full gap-2">
        <ImagePlus aria-hidden="true" className="size-4" />Create image
      </Button>
      <dialog ref={dialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-labelledby={titleId} aria-describedby={descriptionId} className={cn(styles.dialog, "border-0 bg-card p-0 text-card-foreground")}>
        <Card className="border-0">
          <CardHeader className="flex flex-row items-center justify-between gap-4 border-b border-border">
            <div>
              <CardTitle id={titleId} className="font-display text-xl">Your basket, ready to share.</CardTitle>
              <p id={descriptionId} className="sr-only">An image of {basket.name}, its cover, thesis and all {basket.assets.length} holdings with allocation weights.</p>
            </div>
            <Button type="button" variant="ghost" aria-label="Close image" onClick={() => setOpen(false)} className="size-11 shrink-0 p-0"><X aria-hidden="true" className="size-5" /></Button>
          </CardHeader>
          <CardContent className="space-y-4 pt-5">
            <div className="flex min-h-64 items-center justify-center overflow-hidden rounded-lg border border-border bg-background" aria-busy={busy}>
              {image ? <img src={image} alt={`${basket.name}. ${basket.thesis} ${basket.assets.map((asset) => `${asset.symbol} ${asset.weightBps / 100}%`).join(", ")}.`} className={styles.image} /> : error ? <div className="space-y-3 p-6 text-center"><p role="alert" className="text-sm text-muted-foreground">{error}</p><Button variant="outline" onClick={generate} className="min-h-11">Try again</Button></div> : <p role="status" className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="size-5 motion-safe:animate-spin" />Creating your image…</p>}
            </div>
            {image && <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <a href={image} download={basketImageFilename(basket.name)} className={cn(buttonVariants(), "min-h-11 gap-2")}><Download aria-hidden="true" className="size-4" />Download PNG</a>
                {canShare && <Button variant="outline" onClick={shareImage} disabled={sharing} className="min-h-11 gap-2"><Share2 aria-hidden="true" className="size-4" />Share image</Button>}
                {origin && <a href={basketXIntent(basket, origin)} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline" }), "min-h-11 gap-2")}>Share on X<ArrowUpRight aria-hidden="true" className="size-4" /></a>}
              </div>
              <p className="text-xs text-muted-foreground">Posting on X? Add the downloaded PNG to your post.</p>
              {shareError && <p role="status" className="text-xs text-muted-foreground">{shareError}</p>}
            </div>}
          </CardContent>
        </Card>
      </dialog>
    </div>
  );
}

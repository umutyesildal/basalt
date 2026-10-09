"use client";

import { useId } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import { BASKET_COVERS, getBasketCover, type BasketCoverId } from "@/lib/basket-covers";
import styles from "./concept-create.module.css";

export function CoverPicker({ value, onChange, disabled = false }: { value?: BasketCoverId; onChange: (coverId: BasketCoverId) => void; disabled?: boolean }) {
  const helpId = useId();
  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={helpId} disabled={disabled}>
      <legend className="text-sm font-medium">Basket image <span className="text-destructive">*</span></legend>
      <div className="flex items-baseline justify-between gap-3">
        <p id={helpId} className="text-xs text-muted-foreground">{value ? getBasketCover(value).label : "Choose an image for your basket."}</p>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{BASKET_COVERS.length} images</span>
      </div>
      <div role="region" aria-label="Basket image gallery" tabIndex={0} className={`${styles.catalogScroll} max-h-80 overflow-y-auto overscroll-contain rounded-lg border border-border p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {BASKET_COVERS.map((cover) => {
            const selected = value === cover.id;
            return (
              <button
                key={cover.id}
                type="button"
                aria-label={`Select ${cover.label} cover`}
                aria-pressed={selected}
                onClick={() => onChange(cover.id)}
                className={`group relative min-w-0 overflow-hidden rounded-md border-2 text-left transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${selected ? "border-primary" : "border-transparent hover:border-muted-foreground/60"}`}
              >
                <Image src={cover.src} alt="" width={160} height={160} sizes="(max-width: 639px) 28vw, 120px" quality={75} className="aspect-square w-full object-cover" />
                <span className="block truncate bg-card px-1.5 py-1.5 text-[10px] text-foreground">{cover.label}</span>
                {selected && <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-3.5" aria-hidden="true" /></span>}
              </button>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}

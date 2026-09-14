"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";

import { MicroLabel } from "@/components/ui/micro-label";
import { cn } from "@/lib/utils";
import { CREATE_TEMPLATES, resolveTemplate, type CreateTemplate } from "./create-templates";
import type { ConstituentDraft, WhitelistRow } from "./types";

const BLANK_ID = "blank";
/** Kart anatomisi: avatar-chipler + `+N` taşma (ui-plan §1). */
const MAX_CHIPS = 3;

/** "2500 bps" → "25%", "3333" → "33.33%" — trailing zeros trimmed. */
function weightPercentLabel(bps: number): string {
  const pct = bps / 100;
  const trimmed = Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(2)));
  return `${trimmed}%`;
}

/**
 * "Start from template" strip (Dalga 3) — horizontally scrollable preset
 * cards at the top of the wizard's first step. A template only pre-fills
 * composition + fees through the wizard's own state setters; it is not a
 * recommendation and nothing is locked. The active mark is derived (never
 * stored): a card shows pressed only while the current constituents match
 * that template exactly, so any manual edit honestly clears it.
 */
export function TemplateStrip({
  rows,
  constituents,
  onApply,
  onBlank,
}: {
  rows: WhitelistRow[];
  constituents: ConstituentDraft[];
  onApply: (template: CreateTemplate, drafts: ConstituentDraft[]) => void;
  onBlank: () => void;
}) {
  const resolutions = useMemo(
    () => CREATE_TEMPLATES.map((template) => ({ template, resolved: resolveTemplate(template, rows) })),
    [rows],
  );

  // Derived selection — exact (mint, weight) equality against each template.
  const activeId = useMemo(() => {
    if (constituents.length === 0) return BLANK_ID;
    const signature = (list: readonly { mint: string; weightBps: number }[]) =>
      list.map((c) => `${c.mint}:${c.weightBps}`).sort().join("|");
    const current = signature(constituents);
    for (const { template, resolved } of resolutions) {
      if (resolved.unavailable.length > 0) continue;
      if (signature(resolved.drafts) === current) return template.id;
    }
    return null;
  }, [constituents, resolutions]);

  return (
    <section aria-label="Start from template" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <MicroLabel>Start from template</MicroLabel>
        <p className="text-xs text-muted-foreground">
          Pre-fills composition and fees — everything stays editable.
        </p>
      </div>

      <div role="group" aria-label="Templates" className="flex items-stretch gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          aria-pressed={activeId === BLANK_ID}
          aria-label="Start from a blank composition"
          onClick={onBlank}
          className={cn(
            "flex w-[170px] shrink-0 flex-col rounded-lg border border-dashed p-3 text-left transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            activeId === BLANK_ID
              ? "border-primary/60 bg-primary/5"
              : "border-border hover:bg-muted/50",
          )}
        >
          <BlankCard />
        </button>

        {resolutions.map(({ template, resolved }) => {
          const unavailable = resolved.unavailable.length > 0;
          const active = activeId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              aria-pressed={active}
              aria-label={`Use template ${template.name}`}
              disabled={unavailable}
              title={
                unavailable
                  ? `Not Active in the whitelist: ${resolved.unavailable.join(", ")}`
                  : undefined
              }
              onClick={() => onApply(template, resolved.drafts)}
              className={cn(
                "flex w-[220px] shrink-0 flex-col rounded-lg border p-3 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                active ? "border-primary/60 bg-primary/5" : "border-border hover:bg-muted/50",
                unavailable && "cursor-not-allowed opacity-50",
              )}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{template.name}</span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground"
                  >
                    <Check className="size-3" />
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {template.tagline}
              </span>
              <span className="mt-auto flex flex-wrap gap-1 pt-2">
                {resolved.parts.slice(0, MAX_CHIPS).map((part) => (
                  <span
                    key={part.ticker}
                    className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] tracking-wide"
                  >
                    {part.displayTicker}{" "}
                    <span className="text-muted-foreground">{weightPercentLabel(part.weightBps)}</span>
                  </span>
                ))}
                {resolved.parts.length > MAX_CHIPS && (
                  <span className="rounded-md border border-border/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    +{resolved.parts.length - MAX_CHIPS}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function BlankCard() {
  return (
    <>
      <span className="text-sm font-medium">Blank</span>
      <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
        No template — pick every xStock yourself.
      </span>
    </>
  );
}

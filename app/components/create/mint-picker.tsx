"use client";

import { useState } from "react";
import { Check, Minus } from "lucide-react";

import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TextField } from "./field";
import { tickerFromRow, type WhitelistRow } from "./types";

/**
 * Step 1 — select 2-20 xStocks from GET /api/v1/whitelist. Only Active mints
 * are selectable; paused mints stay visible but inert with an explicit reason
 * (the factory rejects them: `MintNotActive`).
 */
export function MintPicker({
  status,
  rows,
  error,
  selectedMints,
  maxSelected,
  basketName,
  description,
  onToggle,
  onNameChange,
  onDescriptionChange,
  onRetry,
}: {
  status: "loading" | "ready" | "error" | "empty";
  rows: WhitelistRow[];
  error?: string;
  selectedMints: string[];
  maxSelected: number;
  basketName: string;
  description: string;
  onToggle: (mint: string) => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <div role="status" aria-label="Loading whitelist" className="flex flex-col gap-2">
          <span className="sr-only">Loading whitelist</span>
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Loading the assets available for new baskets.
        </p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <ErrorState
        title="Whitelist unavailable"
        message={
          error ??
          "The available assets could not be loaded. Try again."
        }
        onRetry={onRetry}
      />
    );
  }

  if (status === "empty") {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          chip="NOT INDEXED"
          title="No basket assets available yet"
          description="No eligible assets have been added for new baskets yet."
        />
        {/* B11 — skeleton mint-card tiles keep the wizard stage from collapsing
            to a void while the whitelist is empty. */}
        <div aria-hidden="true" className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground/80">
          Layout preview — selectable asset tiles
        </p>
      </div>
    );
  }

  const activeRows = rows.filter((row) => row.status === "Active");
  const pausedRows = rows.filter((row) => row.status !== "Active");
  const allSelected = selectedMints.length >= maxSelected;
  const normalizedSearch = search.trim().toLowerCase();
  const matchingRows = activeRows
    .filter((row) =>
      tickerFromRow(row).toLowerCase().includes(normalizedSearch),
    )
    .sort((a, b) => {
      const selectedOrder = Number(selectedMints.includes(b.mint)) - Number(selectedMints.includes(a.mint));
      return selectedOrder || tickerFromRow(a).localeCompare(tickerFromRow(b));
    });
  const visibleRows = normalizedSearch || showAll ? matchingRows : matchingRows.slice(0, 8);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Name"
          value={basketName}
          maxLength={64}
          onChange={onNameChange}
          placeholder="e.g. US mega-cap tech"
        />
        <TextField
          label="One-line thesis"
          value={description}
          maxLength={200}
          onChange={onDescriptionChange}
          placeholder="e.g. Long-term large-cap technology exposure"
        />
      </div>

      {activeRows.length === 0 ? (
        <EmptyState
          title="No Active mints"
          description="Assets are listed, but none are currently available for new baskets."
        />
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Choose at least two tokens</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Selected tokens stay at the top. You can change them later.</p>
            </div>
            <label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-56">
              Search tokens
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by ticker"
                className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
            </label>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="Eligible basket tokens">
          {visibleRows.map((row) => {
            const selected = selectedMints.includes(row.mint);
            const disabled = !selected && allSelected;
            return (
              <li key={row.mint}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  aria-label={`${tickerFromRow(row)}${selected ? ", selected" : ""}`}
                  disabled={disabled}
                  title={row.mint}
                  onClick={() => onToggle(row.mint)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    selected
                      ? "border-primary/60 bg-primary/5"
                      : "border-border hover:bg-muted/50",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className="min-w-0 font-mono text-sm font-medium">
                    {tickerFromRow(row)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}
                  >
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                </button>
              </li>
            );
          })}
          </ul>
          {matchingRows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No matching tokens. Try another ticker.</p>
          ) : !normalizedSearch && !showAll && matchingRows.length > visibleRows.length ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-3 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Show all {activeRows.length} tokens
            </button>
          ) : !normalizedSearch && showAll && activeRows.length > 8 ? (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="mt-3 text-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Show fewer tokens
            </button>
          ) : null}
        </div>
      )}

      {pausedRows.length > 0 && (
        <div>
          <p className="text-xs text-muted-foreground">
            Unavailable for new baskets (existing holders can still redeem):
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {pausedRows.map((row) => (
              <li key={row.mint}>
                <Badge
                  variant="outline"
                  className="gap-1 font-mono text-[11px] text-muted-foreground"
                  title={`${row.mint} · status ${row.status}`}
                >
                  <Minus className="size-3" aria-hidden="true" />
                  {tickerFromRow(row)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Choose 2–{maxSelected} assets · {" "}
          <span className="font-mono tabular-nums text-foreground">
            {selectedMints.length} selected
          </span>
        </span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="h-[74px] w-full animate-pulse rounded-lg border border-border/60 bg-muted/40 motion-reduce:animate-none" />
  );
}

import { Fragment } from "react";

/**
 * MintFlow — the narrow blueprint strip between the hero and the live-proof
 * section (wave UI-1, 2026-09-15; patterned on the Stax mint_flow diagram,
 * docs/stax-analiz/05-stax-vs-basalt-gorsel-farklar.md §5.9): four mono
 * micro-label nodes — USDC → VAULT → XSTOCKS → BASKET TOKEN — joined by
 * faint 1px hairlines with a `→` head, plus a single honest caption line.
 *
 * HONESTY RULE: the caption credits ONLY the in-kind path. Per
 * docs/basalt-v0-spec.md §5, `mint_in_kind` settles raw constituents and
 * mints shares in ONE transaction; the zap-USDC path is sequential in V0
 * (Jupiter legs, then mint_in_kind — spec line "V0 sequential"). Never
 * generalize to a blanket "1 TX" claim.
 *
 * Constraints honored: SSR-safe (pure static markup, no client runtime, no
 * dependencies), nodes wrap on <sm via flex-wrap so nothing overflows, and
 * `.bg-grid` is deliberately NOT used — the grid is the hero's alone (one
 * grid per page). Node labels reuse the `.section-label` micro scale; the
 * caption matches the `font-mono text-[11px]` footnote scale already used
 * by TradeFeePreview. Yellow stays on the hairlines only, at low opacity.
 */

const NODES = ["USDC", "VAULT", "XSTOCKS", "BASKET TOKEN"] as const;

function FlowConnector() {
  return (
    <span aria-hidden="true" className="inline-flex items-center">
      <span className="h-px w-5 bg-primary/25 sm:w-8" />
      <span className="font-mono text-[10px] leading-none text-muted-foreground/60">
        →
      </span>
    </span>
  );
}

export function MintFlow() {
  return (
    <section aria-label="Mint flow" className="relative w-full">
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          {NODES.map((node, index) => (
            <Fragment key={node}>
              {index > 0 ? <FlowConnector /> : null}
              <span className="section-label">{node}</span>
            </Fragment>
          ))}
        </div>
        <p className="mt-2.5 font-mono text-[11px] leading-4 text-muted-foreground">
          in-kind mint settles in one transaction
        </p>
      </div>
    </section>
  );
}

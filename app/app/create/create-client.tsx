"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import type { Connection, TransactionSignature, VersionedTransaction } from "@solana/web3.js";

import { Button } from "@/components/ui/button";
import { useWalletFeedback } from "@/app/providers";
import {
  CreatePreviewCard,
  CreatePreviewCollapsible,
  DeployPanel,
  FeesEditor,
  LegalCheckboxes,
  MintPicker,
  SeedPreview,
  Stepper,
  TemplateStrip,
  WalletGateBanner,
  WeightsEditor,
  type CreateTemplate,
} from "@/components/create";
import { ENTRY_FEE_CAP_BPS, EXIT_FEE_CAP_BPS, MANAGEMENT_FEE_CAP_BPS } from "@/lib/create-basket";
import { formatBpsAsPercent, truncateAddress } from "@/lib/format";
import {
  equalWeights,
  tickerFromRow,
  type ConstituentDraft,
  type LegalAcknowledgments,
  type WhitelistRow,
} from "@/components/create/types";
import { sha256Hex } from "@/lib/create-basket";
import { apiFetch, apiQuery } from "@/lib/api-client";
import { fetchBasketDetail, type BasketDetail } from "@/components/basket/basket-api";

const STEPS = ["Choose", "Set up", "Start", "Review"] as const;
const STEP_HEADINGS = ["Choose assets", "Set your mix", "Add starting tokens", "Review basket"] as const;

type WhitelistStatus = "loading" | "ready" | "error" | "empty";
type PriceStatus = "idle" | "loading" | "ready" | "unavailable";
type CloneStatus = "idle" | "loading" | "ready" | "unavailable";

interface CloneBanner {
  name: string | null;
  /** True when some source constituents were skipped (paused / not whitelisted). */
  partial: boolean;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

/** metadata_json may arrive as object or JSON text — parse defensively. */
function cloneSourceName(detail: BasketDetail): string | null {
  let obj: unknown = detail.metadata_json;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return null;
    }
  }
  const n = obj && typeof obj === "object" ? (obj as Record<string, unknown>).name : null;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

/**
 * Create wizard — four decisions, with legal acknowledgments in final review.
 * Mirrors basket_factory::create_basket validations
 * client-side; the program re-validates everything on-chain.
 *
 * `?clone=<pubkey>` (from the basket page's "Clone this basket") pre-fills
 * constituents/weights/fees from the indexed basket under a dismissible
 * banner — seed amounts and the legal acknowledgments are never cloned.
 */
export default function CreateClient() {
  const { connection } = useConnection();
  const { publicKey, connected, sendTransaction } = useWallet();
  const { reportError } = useWalletFeedback();

  const searchParams = useSearchParams();
  const cloneParam = searchParams.get("clone");

  const [step, setStep] = useState(0);
  const [whitelistStatus, setWhitelistStatus] = useState<WhitelistStatus>("loading");
  const [whitelistRows, setWhitelistRows] = useState<WhitelistRow[]>([]);
  const [whitelistError, setWhitelistError] = useState<string | null>(null);
  const [whitelistSource, setWhitelistSource] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [constituents, setConstituents] = useState<ConstituentDraft[]>([]);
  const [entryFeeBps, setEntryFeeBps] = useState(0);
  const [exitFeeBps, setExitFeeBps] = useState(0);
  const [managementFeeBps, setManagementFeeBps] = useState(0);
  const [feesExpanded, setFeesExpanded] = useState(false);
  const [legal, setLegal] = useState<LegalAcknowledgments>({
    notAdvice: false,
    jurisdiction: false,
    structuredInstrument: false,
    creatorNotAdviser: false,
  });

  const [budgetUsd, setBudgetUsd] = useState("");
  const [priceStatus, setPriceStatus] = useState<PriceStatus>("idle");
  const [priceSource, setPriceSource] = useState<string | null>(null);
  const [priceAsOf, setPriceAsOf] = useState<string | null>(null);

  const [nonce, setNonce] = useState(() => Date.now());
  const [metadataHashState, setMetadataHashState] = useState<{ source: string; hex: string } | null>(null);

  // ---- clone state ----
  const [cloneStatus, setCloneStatus] = useState<CloneStatus>("idle");
  const [cloneDetail, setCloneDetail] = useState<BasketDetail | null>(null);
  const [cloneBanner, setCloneBanner] = useState<CloneBanner | null>(null);
  const cloneAppliedRef = useRef(false);

  const loadWhitelist = useCallback(async () => {
    setWhitelistStatus("loading");
    setWhitelistError(null);
    try {
      const res = await apiFetch("/api/v1/whitelist", { cache: "no-store" });
      if (!res.ok) {
        setWhitelistRows([]);
        setWhitelistStatus("error");
        setWhitelistError(`GET /api/v1/whitelist responded ${res.status}.`);
        return;
      }
      const payload = (await res.json()) as { data?: WhitelistRow[]; source?: string | null };
      const rows = Array.isArray(payload.data) ? payload.data : [];
      setWhitelistRows(rows);
      setWhitelistSource(payload.source ?? "whitelist-api");
      setWhitelistStatus(rows.length === 0 ? "empty" : "ready");
    } catch (error) {
      setWhitelistRows([]);
      setWhitelistStatus("error");
      setWhitelistError(
        error instanceof Error ? error.message : "The whitelist API did not respond.",
      );
    }
  }, []);

  useEffect(() => {
    void loadWhitelist();
  }, [loadWhitelist]);

  // Fetch the clone source once. An invalid pubkey is ignored silently —
  // the wizard simply behaves as a fresh create.
  useEffect(() => {
    if (!cloneParam) return;
    let valid = false;
    try {
      new PublicKey(cloneParam);
      valid = true;
    } catch {
      valid = false;
    }
    if (!valid) return;
    const controller = new AbortController();
    setCloneStatus("loading");
    fetchBasketDetail(cloneParam, controller.signal)
      .then((detail) => {
        setCloneDetail(detail);
        setCloneStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setCloneStatus("unavailable");
      });
    return () => controller.abort();
  }, [cloneParam]);

  // Prefill once the source detail AND the whitelist (decimals/tickers/status)
  // are both available. Seed amounts are deliberately left at zero — the seed
  // step still requires the user to choose amounts.
  useEffect(() => {
    if (cloneAppliedRef.current) return;
    if (!cloneDetail || whitelistStatus !== "ready") return;
    cloneAppliedRef.current = true;

    const sourceName = cloneSourceName(cloneDetail);
    const drafts: ConstituentDraft[] = [];
    cloneDetail.constituents.forEach((mint, i) => {
      const row = whitelistRows.find((r) => r.mint === mint);
      if (!row || row.status !== "Active") return;
      drafts.push({
        mint,
        ticker: tickerFromRow(row),
        decimals: row.decimals,
        weightBps: cloneDetail.weights_bps[i] ?? 0,
        seedRaw: 0n,
        priceRef: null,
      });
    });

    if (drafts.length >= 2) {
      setConstituents(drafts);
      setName(sourceName ? `${sourceName} (clone)` : "");
      setEntryFeeBps(Math.min(cloneDetail.entry_fee_bps, ENTRY_FEE_CAP_BPS));
      setExitFeeBps(Math.min(cloneDetail.exit_fee_bps, EXIT_FEE_CAP_BPS));
      setManagementFeeBps(Math.min(cloneDetail.management_fee_bps, MANAGEMENT_FEE_CAP_BPS));
      setFeesExpanded(
        cloneDetail.entry_fee_bps > 0 ||
        cloneDetail.exit_fee_bps > 0 ||
        cloneDetail.management_fee_bps > 0,
      );
      setStep(0);
    }
    setCloneBanner({
      name: sourceName,
      partial: drafts.length >= 2 && drafts.length < cloneDetail.constituents.length,
    });
  }, [cloneDetail, whitelistRows, whitelistStatus]);

  // Reference prices for the seed USD example. Best effort — the raw seed
  // inputs work without them, and the estimate is always labeled.
  const selectedMintsKey = constituents.map((c) => c.mint).join(",");
  useEffect(() => {
    if (!selectedMintsKey) {
      setPriceStatus("idle");
      return;
    }
    const mints = selectedMintsKey.split(",");
    const tickers = mints
      .map((mint) => {
        const row = whitelistRows.find((r) => r.mint === mint);
        if (!row) return null;
        const ticker = tickerFromRow(row);
        return ticker.includes("…") ? null : ticker;
      })
      .filter((t): t is string => t !== null);
    if (tickers.length === 0) {
      setPriceStatus("unavailable");
      return;
    }
    let cancelled = false;
    setPriceStatus("loading");
    setPriceSource(null);
    setPriceAsOf(null);
    setConstituents((prev) => prev.map((c) => ({ ...c, priceRef: null })));
    void (async () => {
      try {
        const res = await apiQuery(
          "/api/v1/prices/compare",
          { tickers: tickers.join(",") },
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`prices/compare responded ${res.status}`);
        const payload = (await res.json()) as {
          data?: { ticker: string; mint: string; jupiter: number | null; source?: string }[];
          ts?: string;
        };
        if (cancelled) return;
        const byMint = new Map((payload.data ?? []).map((row) => [row.mint, row]));
        setConstituents((prev) =>
          prev.map((c) =>
            byMint.has(c.mint) ? { ...c, priceRef: byMint.get(c.mint)?.jupiter ?? null } : c,
          ),
        );
        const sources = Array.from(new Set((payload.data ?? []).map((row) => row.source ?? "unavailable")));
        setPriceSource(`Reference price · ${sources.join(" / ")}`);
        setPriceAsOf(payload.ts ?? null);
        setPriceStatus("ready");
      } catch {
        if (!cancelled) {
          setPriceStatus("unavailable");
          setPriceSource(null);
          setPriceAsOf(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMintsKey, whitelistRows]);

  const toggleMint = useCallback(
    (mint: string) => {
      setConstituents((prev) => {
        if (prev.some((c) => c.mint === mint)) {
          const next = prev.filter((c) => c.mint !== mint);
          const weights = equalWeights(next.length);
          return next.map((c, i) => ({ ...c, weightBps: weights[i] }));
        }
        if (prev.length >= 20) return prev;
        const row = whitelistRows.find((r) => r.mint === mint);
        if (!row || row.status !== "Active") return prev;
        const next: ConstituentDraft[] = [
          ...prev,
          {
            mint,
            ticker: tickerFromRow(row),
            decimals: row.decimals,
            weightBps: 0,
            seedRaw: 0n,
            priceRef: null,
          },
        ];
        const weights = equalWeights(next.length);
        return next.map((c, i) => ({ ...c, weightBps: weights[i] }));
      });
    },
    [whitelistRows],
  );

  // Template prefill (Dalga 3 — "Start from template"): fills composition +
  // fees only, through the same state setters the manual flow uses. Seed
  // amounts stay at zero (the seed step still requires amounts) and the
  // name/thesis and legal acknowledgments are never touched. The strip passes
  // fully-resolved drafts; cards with unavailable tickers are disabled there,
  // so this length guard is just a belt-and-braces check.
  const applyTemplate = useCallback(
    (template: CreateTemplate, drafts: ConstituentDraft[]) => {
      if (drafts.length < 2) return;
      setConstituents(drafts);
      setEntryFeeBps(template.fees.entryFeeBps);
      setExitFeeBps(template.fees.exitFeeBps);
      setManagementFeeBps(template.fees.managementFeeBps);
      setFeesExpanded(
        template.fees.entryFeeBps > 0 ||
        template.fees.exitFeeBps > 0 ||
        template.fees.managementFeeBps > 0,
      );
    },
    [],
  );

  const recomputeProportional = useCallback(() => {
    const budget = Number(budgetUsd);
    if (!Number.isFinite(budget) || budget <= 0) return;
    setConstituents((prev) =>
      prev.map((c) => {
        if (!c.priceRef || !Number.isFinite(c.priceRef) || c.priceRef <= 0) return c;
        const usd = (budget * c.weightBps) / 10_000;
        const raw = Math.floor((usd / c.priceRef) * 10 ** c.decimals);
        return Number.isSafeInteger(raw) && raw > 0
          ? { ...c, seedRaw: BigInt(raw) }
          : c;
      }),
    );
  }, [budgetUsd]);

  // Metadata JSON — hashed with sha256 (IPFS upload is out of scope for V0).
  const metadataJson = useMemo(() => {
    const blob = {
      name: name.trim() || "Untitled Basalt basket",
      description: description.trim(),
      version: "basalt-v0",
      genesisShares: 1_000_000,
      constituents: constituents.map((c) => ({
        ticker: c.ticker,
        mint: c.mint,
        weightBps: c.weightBps,
      })),
      feesBps: {
        entry: entryFeeBps,
        exit: exitFeeBps,
        management: managementFeeBps,
      },
    };
    return JSON.stringify(blob, null, 2);
  }, [name, description, constituents, entryFeeBps, exitFeeBps, managementFeeBps]);
  const metadataHashHex = metadataHashState?.source === metadataJson ? metadataHashState.hex : null;

  useEffect(() => {
    let cancelled = false;
    void sha256Hex(metadataJson).then((hex) => {
      if (!cancelled) setMetadataHashState({ source: metadataJson, hex });
    });
    return () => {
      cancelled = true;
    };
  }, [metadataJson]);

  // ---- per-step validation (mirrors the program's checks) ----
  const count = constituents.length;
  const weightSum = constituents.reduce((acc, c) => acc + c.weightBps, 0);
  const validity = {
    selection: count >= 2 && count <= 20,
    weights: count >= 2 && count <= 20 && weightSum === 10_000,
    fees:
      entryFeeBps <= ENTRY_FEE_CAP_BPS &&
      exitFeeBps <= EXIT_FEE_CAP_BPS &&
      managementFeeBps <= MANAGEMENT_FEE_CAP_BPS,
    seed: count > 0 && constituents.every((c) => c.seedRaw > 0n),
    legal:
      legal.notAdvice && legal.jurisdiction && legal.structuredInstrument && legal.creatorNotAdviser,
  };
  const stepValid = [validity.selection, validity.weights && validity.fees, validity.seed, true];

  let validThrough = 0;
  for (let i = 0; i < stepValid.length; i += 1) {
    if (stepValid[i]) validThrough = i;
    else break;
  }

  const feesSummary =
    entryFeeBps === 0 && exitFeeBps === 0 && managementFeeBps === 0
      ? "No fees"
      : `${formatBpsAsPercent(entryFeeBps)} entry · ${formatBpsAsPercent(exitFeeBps)} exit · ${formatBpsAsPercent(managementFeeBps)}/year`;

  const handleSendTransaction = useCallback(
    (transaction: VersionedTransaction, conn: Connection): Promise<TransactionSignature> =>
      sendTransaction(transaction, conn),
    [sendTransaction],
  );

  // Live preview panel — fed straight from wizard state (no separate source of
  // truth): composition from `constituents`, the total from the same
  // `weightSum` the weights validation checks, fees from the fee sliders, the
  // estimate from seedRaw × priceRef. Desktop renders it in the sticky right
  // column; mobile collapses it into the step flow.
  const previewProps = {
    name,
    constituents,
    entryFeeBps,
    exitFeeBps,
    managementFeeBps,
    weightSum,
    weightsValid: validity.weights,
    priceSource,
  };

  return (
    <div className="mx-auto w-full max-w-6xl pb-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Create a strategy basket</h1>
        </div>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
            <p>Devnet demo · Project mock tokens and prices · Not live xStocks. LEGAL_REVIEW_REQUIRED.</p>
            <details className="mt-1">
              <summary className="cursor-pointer underline underline-offset-2">About demo data</summary>
              <p className="mt-1">
                These are not issuer-backed xStocks or live investment data.
                {whitelistSource ? ` Asset source: ${whitelistSource}.` : ""}
              </p>
            </details>
          </div>

          {cloneStatus === "loading" ? (
            <div role="status" className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <span className="sr-only">Loading basket to clone</span>
              <p className="text-sm text-muted-foreground">Loading the basket to clone…</p>
            </div>
          ) : cloneStatus === "unavailable" ? (
            <div role="status" className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                The basket to clone ({truncateAddress(cloneParam ?? "", 6, 6)}) could not be loaded —
                starting from a blank wizard.
              </p>
            </div>
          ) : cloneBanner ? (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Cloning {cloneBanner.name ?? "basket"} — everything below is editable
                </p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  Constituents, weights and fees are pre-filled. Seed amounts and the legal
                  acknowledgments are yours to set.
                  {cloneBanner.partial
                    ? " Some source constituents are not Active in the whitelist — reselect them manually."
                    : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Dismiss clone notice"
                onClick={() => setCloneBanner(null)}
              >
                ×
              </Button>
            </div>
          ) : null}

          <Stepper
            steps={STEPS.map((label, i) => ({ key: `${i}-${label}`, label }))}
            current={step}
            validThrough={validThrough}
            onSelect={setStep}
          />

          {/* Mobile: the live preview rides along inside the step flow as a
              collapsed summary (desktop equivalent lives in the right rail). */}
          {count >= 2 && <CreatePreviewCollapsible {...previewProps} className="mt-3" />}

          <section className="mt-5 rounded-lg border border-border bg-card p-5" aria-label={`Step ${step + 1}: ${STEPS[step]}`}>
            <h2 className="font-display mb-4 text-lg font-medium">
              {STEP_HEADINGS[step]}
            </h2>

            {step === 0 && (
              <div className="flex flex-col gap-4">
                {/* Template strip sits at the top of the first step; it is
                    meaningful only once the whitelist is loaded (tickers map
                    to live Active mints) and hides otherwise — the picker
                    below owns the loading/error/empty states. */}
                {whitelistStatus === "ready" && (
                  <TemplateStrip
                    rows={whitelistRows}
                    constituents={constituents}
                    onApply={applyTemplate}
                    onBlank={() => setConstituents([])}
                  />
                )}
                <MintPicker
                  status={whitelistStatus}
                  rows={whitelistRows}
                  error={whitelistError ?? undefined}
                  selectedMints={constituents.map((c) => c.mint)}
                  maxSelected={20}
                  basketName={name}
                  description={description}
                  onToggle={toggleMint}
                  onNameChange={setName}
                  onDescriptionChange={setDescription}
                  onRetry={() => void loadWhitelist()}
                />
              </div>
            )}

            {step === 1 && (
              <div className="space-y-8">
                <WeightsEditor constituents={constituents} onChange={setConstituents} />
                <section className="border-t border-border pt-6" aria-label="Basket fees">
                  <button
                    type="button"
                    aria-expanded={feesExpanded}
                    aria-controls="create-fees"
                    onClick={() => setFeesExpanded((value) => !value)}
                    className="flex w-full items-center justify-between gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <span className="text-base font-medium">Fees <span className="text-sm font-normal text-muted-foreground">(optional)</span></span>
                    <span className="text-right font-mono text-xs text-muted-foreground">{feesSummary} <span aria-hidden="true">{feesExpanded ? "−" : "+"}</span></span>
                  </button>
                  <div id="create-fees" className={feesExpanded ? "mt-5" : "hidden"}>
                    <FeesEditor
                      entryFeeBps={entryFeeBps}
                      exitFeeBps={exitFeeBps}
                      managementFeeBps={managementFeeBps}
                      onChange={(key, value) => {
                        if (key === "entry") setEntryFeeBps(value);
                        else if (key === "exit") setExitFeeBps(value);
                        else setManagementFeeBps(value);
                      }}
                    />
                  </div>
                </section>
              </div>
            )}

            {step === 2 && (
              <SeedPreview
                constituents={constituents}
                budgetUsd={budgetUsd}
                priceStatus={priceStatus}
                priceSource={priceSource}
                priceAsOf={priceAsOf}
                onBudgetChange={setBudgetUsd}
                onRawChange={(mint, raw) =>
                  setConstituents((prev) =>
                    prev.map((c) => (c.mint === mint ? { ...c, seedRaw: raw } : c)),
                  )
                }
                onRecomputeProportional={recomputeProportional}
              />
            )}

            {step === 3 && (
              <DeployPanel
                basketName={name}
                basketThesis={description}
                constituents={constituents}
                entryFeeBps={entryFeeBps}
                exitFeeBps={exitFeeBps}
                managementFeeBps={managementFeeBps}
                nonce={nonce}
                metadataJson={metadataJson}
                metadataHash={metadataHashHex ? hexToBytes(metadataHashHex) : new Uint8Array(32)}
                connected={connected}
                publicKey={publicKey}
                connection={connection}
                sendTransaction={handleSendTransaction}
                onNonceRegenerate={() => setNonce(Date.now())}
                legalAccepted={validity.legal}
              >
                <section className="border-t border-border pt-5" aria-label="Required acknowledgments">
                  <h3 className="mb-3 text-base font-medium">Before you deploy</h3>
                  <LegalCheckboxes
                    legal={legal}
                    onChange={(key, value) => setLegal((prev) => ({ ...prev, [key]: value }))}
                  />
                </section>
              </DeployPanel>
            )}
          </section>

          {!connected && step === 3 && <WalletGateBanner className="mt-4" />}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
            >
              Back
            </Button>
            {step < STEPS.length - 1 && (
              <div>
                <Button
                  type="button"
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  disabled={!stepValid[step]}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* One live preview on desktop; mobile can open the compact preview above the form. */}
        <div className="self-start lg:sticky lg:top-20">
          <div className="hidden lg:block">
            <CreatePreviewCard {...previewProps} />
          </div>
        </div>
      </div>
    </div>
  );
}

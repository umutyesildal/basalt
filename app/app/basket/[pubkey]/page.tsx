import type { Metadata } from "next";

import BasketDetailClient from "./basket-detail-client";
import { API_BASE } from "@/lib/api-client";
import { formatBpsAsPercent, prettyTicker, truncateAddress } from "@/lib/format";
import type { BasketDetail } from "@/components/basket/basket-api";

const MAX_COMPOSITION_PARTS = 4;
const META_FETCH_TIMEOUT_MS = 5000;

/** metadata_json may arrive as object or JSON text — parse defensively. */
function metaName(mj: unknown): string | null {
  if (!mj) return null;
  let obj: unknown = mj;
  if (typeof mj === "string") {
    try {
      obj = JSON.parse(mj);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const n = (obj as Record<string, unknown>).name;
  return typeof n === "string" && n.trim() ? n.trim() : null;
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Best-effort server-side fetches for metadata only. The page body always
 * renders (the client component owns its own loading/error states); when the
 * API is unreachable the metadata falls back to the generic pattern — never a
 * fabricated name, composition or fee.
 */
async function fetchBasketForMeta(pubkey: string): Promise<BasketDetail | null> {
  if (!BASE58_RE.test(pubkey)) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/baskets/${encodeURIComponent(pubkey)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: BasketDetail } | null;
    return payload?.data ?? null;
  } catch {
    return null;
  }
}

async function fetchTickerMapForMeta(): Promise<Map<string, string>> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/whitelist`, {
      cache: "no-store",
      signal: AbortSignal.timeout(META_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return new Map();
    const payload = (await res.json()) as {
      data?: { mint?: string; ticker?: string; price_source?: string }[];
    } | null;
    const map = new Map<string, string>();
    for (const row of payload?.data ?? []) {
      if (typeof row.mint !== "string" || !row.mint) continue;
      const fromField = typeof row.ticker === "string" ? row.ticker.trim() : "";
      const fromSource =
        typeof row.price_source === "string" ? row.price_source.split(":").pop() ?? "" : "";
      const ticker = prettyTicker(fromField || fromSource);
      if (ticker) map.set(row.mint, ticker);
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * SEO pattern — `Basalt | <Basket Name> | Strategy basket on Solana`.
 * Description: composition + fee + one method sentence. Deliberately no
 * return/percentage claims (brand.md prudence rule) and no ETF/fund
 * vocabulary anywhere — baskets are strategy baskets, always.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}): Promise<Metadata> {
  const { pubkey: rawPubkey } = await params;
  const pubkey = decodeURIComponent(rawPubkey);

  const detail = await fetchBasketForMeta(pubkey);
  const name = detail ? metaName(detail.metadata_json) : null;

  let composition: string | null = null;
  if (detail && detail.constituents.length > 0) {
    const tickers = await fetchTickerMapForMeta();
    const parts = detail.constituents.map((mint, i) => {
      const ticker = tickers.get(mint) ?? truncateAddress(mint, 4, 4);
      const bps = detail.weights_bps[i];
      return bps !== undefined ? `${ticker} ${Math.round(bps / 100)}%` : ticker;
    });
    const shown = parts.slice(0, MAX_COMPOSITION_PARTS).join(" · ");
    composition =
      parts.length > MAX_COMPOSITION_PARTS ? `${shown} · +${parts.length - MAX_COMPOSITION_PARTS}` : shown;
  }

  const title = name
    ? `Basalt | ${name} | Strategy basket on Solana`
    : "Basalt | Strategy basket on Solana";

  const sentences: string[] = [];
  if (name && composition) {
    sentences.push(
      `${name} holds ${detail?.constituents.length ?? ""} xStocks (${composition}) in one Token-2022 strategy basket.`,
    );
  } else if (name) {
    sentences.push(`${name} is a Token-2022 strategy basket of whitelisted xStocks on Solana.`);
  }
  if (detail) {
    sentences.push(
      `Management fee ${formatBpsAsPercent(detail.management_fee_bps)}/yr, accrued on-chain; weights and fees are immutable.`,
    );
  }
  sentences.push(
    "Mint or redeem shares against the on-chain vault in a single atomic transaction — method and risks are protocol-level and identical for every basket.",
  );

  const description = sentences.join(" ");

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    alternates: { canonical: `/basket/${pubkey}` },
  };
}

export default async function BasketPage({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey: rawPubkey } = await params;
  const pubkey = decodeURIComponent(rawPubkey);
  return <BasketDetailClient pubkey={pubkey} />;
}

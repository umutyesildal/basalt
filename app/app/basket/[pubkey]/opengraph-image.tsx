import { ImageResponse } from "next/og";

import { API_BASE } from "@/lib/api-client";
import { prettyTicker, truncateAddress } from "@/lib/format";
import type { BasketDetail } from "@/components/basket/basket-api";

export const alt = "Basalt — Strategy Basket on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MAX_COMPOSITION_ROWS = 4;
const META_FETCH_TIMEOUT_MS = 5000;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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

/**
 * Best-effort server-side fetches for the OG payload — the exact metadata
 * pattern of the page route: 5s timeout, no-store, and any failure yields
 * null so the image falls back to the generic Basalt artwork. Nothing is
 * ever fabricated to fill a slot.
 */
async function fetchBasketForOg(pubkey: string): Promise<BasketDetail | null> {
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

async function fetchTickerMapForOg(): Promise<Map<string, string>> {
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
 * Per-basket social preview (design-basalt-v1 §3 system): near-black canvas,
 * grayscale everything, the single electric-yellow accent on chrome. The
 * layout is a left-aligned terminal card — eyebrow badge, basket name,
 * composition ledger rows (ticker left, target weight right) behind faint
 * hairlines — with the BASALT MARK filled in the accent on the right. This
 * file loads no fonts, so the OG renderer's default sans carries the mono
 * flavor via uppercase + wide tracking (same approach as the root
 * opengraph-image). When the basket API is unreachable the image degrades to
 * the generic Basalt card — never a fabricated name or composition.
 */
export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ pubkey: string }>;
}) {
  const { pubkey: rawPubkey } = await params;
  const pubkey = decodeURIComponent(rawPubkey);

  const detail = await fetchBasketForOg(pubkey);
  const name = detail ? metaName(detail.metadata_json) : null;

  let rows: { ticker: string; weight: string }[] = [];
  if (detail && detail.constituents.length > 0) {
    const tickers = await fetchTickerMapForOg();
    rows = detail.constituents.slice(0, MAX_COMPOSITION_ROWS).map((mint, i) => ({
      ticker: tickers.get(mint) ?? truncateAddress(mint, 4, 4),
      weight:
        detail.weights_bps[i] !== undefined
          ? `${Math.round(detail.weights_bps[i] / 100)}%`
          : "—",
    }));
  }
  const extraCount =
    detail && detail.constituents.length > MAX_COMPOSITION_ROWS
      ? detail.constituents.length - MAX_COMPOSITION_ROWS
      : 0;

  return new ImageResponse(
    name ? (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: "#0A0A0B",
          color: "#F6F6F4",
          position: "relative",
        }}
      >
        {/* faint engineering grid — two horizontal hairlines */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 128,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
          />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 572,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />

        {/* yellow corner ticks */}
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />

        {/* left column — eyebrow, name, composition ledger */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 56px 56px 64px",
            width: 780,
          }}
        >
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              backgroundColor: "#FCEE0A",
              color: "#111110",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: 5,
              textIndent: 5,
              padding: "8px 18px",
            }}
          >
            BASALT · STRATEGY BASKET
          </div>

          <div style={{ display: "flex", fontSize: name.length > 28 ? 56 : 72, fontWeight: 700, letterSpacing: 1 }}>
            {name}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {rows.map((row, i) => (
              <div
                key={`${row.ticker}-${i}`}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 26,
                  letterSpacing: 3,
                  padding: "13px 0",
                  borderTop: "1px solid rgba(255,255,255,0.14)",
                }}
              >
                <div style={{ display: "flex" }}>{row.ticker.toUpperCase()}</div>
                <div style={{ display: "flex", color: "#9A9A96" }}>{row.weight}</div>
              </div>
            ))}
            {extraCount > 0 ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  letterSpacing: 3,
                  padding: "10px 0",
                  borderTop: "1px solid rgba(255,255,255,0.14)",
                  color: "#9A9A96",
                }}
              >
                +{extraCount} MORE CONSTITUENTS
              </div>
            ) : null}
          </div>
        </div>

        {/* right column — BASALT MARK, accent fill with cap-facet seams */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="300" height="300" viewBox="0 0 24 24">
            <g fill="#FCEE0A">
              <path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
              <path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
              <path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
            </g>
            <g stroke="#0A0A0B" strokeWidth="0.55">
              <line x1="4.3" y1="3.7" x2="8.7" y2="3.7" />
              <line x1="9.8" y1="10.7" x2="14.2" y2="10.7" />
              <line x1="15.3" y1="15.7" x2="19.7" y2="15.7" />
            </g>
          </svg>
        </div>
      </div>
    ) : (
      // Generic fallback — same card system, mark-forward, no basket claims.
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          backgroundColor: "#0A0A0B",
          color: "#F6F6F4",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 132,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 498,
            width: "100%",
            height: 1,
            backgroundColor: "#FFFFFF",
            opacity: 0.06,
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 32,
            width: 40,
            height: 40,
            borderTop: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 32,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderLeft: "2px solid #FCEE0A",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 1128,
            top: 558,
            width: 40,
            height: 40,
            borderBottom: "2px solid #FCEE0A",
            borderRight: "2px solid #FCEE0A",
          }}
        />
        <svg width="180" height="180" viewBox="0 0 24 24" style={{ marginBottom: 32 }}>
          <g fill="#FCEE0A">
            <path d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
            <path d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
            <path d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
          </g>
          <g stroke="#0A0A0B" strokeWidth="0.55">
            <line x1="4.3" y1="3.7" x2="8.7" y2="3.7" />
            <line x1="9.8" y1="10.7" x2="14.2" y2="10.7" />
            <line x1="15.3" y1="15.7" x2="19.7" y2="15.7" />
          </g>
        </svg>
        <div
          style={{
            display: "flex",
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: 22,
            textIndent: 22,
          }}
        >
          BASALT
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 36,
            backgroundColor: "#FCEE0A",
            color: "#111110",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 6,
            textIndent: 6,
            padding: "10px 22px",
          }}
        >
          XSTOCKS STRATEGY BASKETS · SOLANA
        </div>
      </div>
    ),
    { ...size },
  );
}

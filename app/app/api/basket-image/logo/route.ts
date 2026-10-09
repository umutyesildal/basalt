import { getConceptAsset } from "@/lib/concept-assets";
import { isSolanaMint } from "@/lib/xstock-types";

export const runtime = "nodejs";
const MAX_BYTES = 2_000_000;
const HOSTS = new Set(["xstocks-metadata.backed.fi", "assets.parqet.com"]);
const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });

/** Catalog identities only: callers cannot choose an upstream URL. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol")?.toUpperCase();
  const mint = params.get("mint") ?? undefined;
  if ([...params.keys()].some((key) => key !== "symbol" && key !== "mint") || params.getAll("symbol").length !== 1 || params.getAll("mint").length > 1 ||
    !symbol || !/^[A-Z0-9][A-Z0-9.:-]{0,24}$/.test(symbol) || (mint !== undefined && !isSolanaMint(mint))) return missing();
  const asset = getConceptAsset(symbol, mint);
  if (!asset?.logoUrl || asset.symbol.toUpperCase() !== symbol) return missing();
  try {
    const url = new URL(asset.logoUrl);
    if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) return missing();
    const response = await fetch(url, {
      credentials: "omit", redirect: "error", signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    });
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const advertised = Number(response.headers.get("content-length"));
    if (!response.ok || !response.body || !type || !TYPES.has(type) || advertised > MAX_BYTES) {
      await response.body?.cancel();
      return missing();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return missing(); }
      chunks.push(value);
    }
    if (!size) return missing();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    } });
  } catch { return missing(); }
}

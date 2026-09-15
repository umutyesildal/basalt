/**
 * ticker-color.ts — deterministic per-ticker data color (owner feedback
 * 2026-09-15: "same ticker always gets the same color, calmer tones").
 *
 * The hue is derived from an FNV-1a hash of the uppercased symbol, so a
 * ticker carries ONE color everywhere it appears — any basket, any chart,
 * any session — instead of the list-order chart slots it had before.
 * Saturation/lightness are pinned to a muted band (calm on the near-black
 * flagship, no neon), per the brand rule that loud color is yellow-only.
 *
 * Why not sample the logo image: the Parqet CDN sends no CORS header, so
 * reading pixels into a canvas taints it and throws. The hash keeps the
 * "logo-like stability" without a proxy round-trip. Explicit colors (e.g.
 * curated brand colors) still win wherever a caller passes one.
 */

/** FNV-1a, 32-bit — tiny, stable, well-distributed for short ASCII strings. */
function hashSymbol(symbol: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < symbol.length; i += 1) {
    hash ^= symbol.charCodeAt(i) | 0x20; // fold to lowercase, case-stable
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Muted, deterministic data color for a ticker. Same symbol → same HSL
 * triple forever. S 30% / L 52% sits in the calm mid band on both themes.
 */
export function tickerColor(symbol: string): string {
  const hue = hashSymbol(symbol) % 360;
  return `hsl(${hue} 30% 52%)`;
}

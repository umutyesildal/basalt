import { getConceptAsset } from "@/lib/concept-assets";
import logoColors from "@/lib/data/asset-logo-colors.json";

/** Missing or newly changed logos stay neutral until the palette is refreshed. */
export const NEUTRAL_ALLOCATION_COLOR = "#A6A6AB";
const colorsByLogo: Readonly<Record<string, string>> = logoColors;

/**
 * Basket colors come from the actual displayed logo, precomputed from its
 * dominant pixel cluster. Mint-bearing holdings resolve exact issuer metadata;
 * a caller-supplied ticker never borrows another token's branding. The cached
 * lookup keeps Create, previews and exports stable without image-loading shifts.
 */
export function allocationColor(symbol: string, mint?: string): string {
  const asset = getConceptAsset(symbol.trim().toUpperCase(), mint);
  return (asset?.logoUrl && colorsByLogo[asset.logoUrl]) || NEUTRAL_ALLOCATION_COLOR;
}

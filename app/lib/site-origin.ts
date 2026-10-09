export const CANONICAL_SITE_URL = "https://basalt.markets";

/** Public Vercel aliases share the custom domain; local review URLs stay local. */
export function publicSiteOrigin(value: string): string {
  const trimmed = value.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Invalid site origin");
  }
  return url.hostname.endsWith(".vercel.app") ? CANONICAL_SITE_URL : url.origin;
}

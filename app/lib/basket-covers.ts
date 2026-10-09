/** Original Basalt artwork. Cover IDs are portable; image URLs never come from shared links. */
export const BASKET_COVERS = [
  { id: "terminally-online", label: "Terminally Online", src: "/images/baskets/terminally-online.png" },
  { id: "touch-grass", label: "Touch Grass", src: "/images/baskets/touch-grass.png" },
  { id: "no-hands", label: "No Hands", src: "/images/baskets/no-hands.png" },
  { id: "daily-ritual", label: "Daily Ritual", src: "/images/baskets/daily-ritual.png" },
  { id: "chip-happens", label: "Chip Happens", src: "/images/baskets/chip-happens.png" },
  { id: "after-hours", label: "After Hours", src: "/images/baskets/after-hours.png" },
  { id: "payday", label: "Payday", src: "/images/baskets/payday.png" },
  { id: "offline-mode", label: "Offline Mode", src: "/images/baskets/offline-mode.png" },
  { id: "power-hungry", label: "Power Hungry", src: "/images/baskets/power-hungry.png" },
  { id: "main-character", label: "Main Character", src: "/images/baskets/main-character.png" },
  { id: "moon-shot", label: "Moon Shot", src: "/images/baskets/moon-shot.webp" },
  { id: "deep-value", label: "Deep Value", src: "/images/baskets/deep-value.webp" },
  { id: "long-game", label: "Long Game", src: "/images/baskets/long-game.webp" },
  { id: "gold-standard", label: "Gold Standard", src: "/images/baskets/gold-standard.webp" },
  { id: "cloud-nine", label: "Cloud Nine", src: "/images/baskets/cloud-nine.webp" },
  { id: "robot-shift", label: "Robot Shift", src: "/images/baskets/robot-shift.webp" },
  { id: "green-light", label: "Green Light", src: "/images/baskets/green-light.webp" },
  { id: "supply-chain", label: "Supply Chain", src: "/images/baskets/supply-chain.webp" },
  { id: "world-tour", label: "World Tour", src: "/images/baskets/world-tour.webp" },
  { id: "bull-case", label: "Bull Case", src: "/images/baskets/bull-case.webp" },
  { id: "bear-with-me", label: "Bear With Me", src: "/images/baskets/bear-with-me.webp" },
  { id: "slow-burn", label: "Slow Burn", src: "/images/baskets/slow-burn.webp" },
  { id: "paper-hands", label: "Paper Hands", src: "/images/baskets/paper-hands.webp" },
  { id: "diamond-hands", label: "Diamond Hands", src: "/images/baskets/diamond-hands.webp" },
  { id: "open-tab", label: "Open Tab", src: "/images/baskets/open-tab.webp" },
  { id: "full-charge", label: "Full Charge", src: "/images/baskets/full-charge.webp" },
  { id: "hard-assets", label: "Hard Assets", src: "/images/baskets/hard-assets.webp" },
  { id: "orbit", label: "Orbit", src: "/images/baskets/orbit.webp" },
  { id: "home-team", label: "Home Team", src: "/images/baskets/home-team.webp" },
  { id: "cold-storage", label: "Cold Storage", src: "/images/baskets/cold-storage.webp" },
  { id: "side-quest", label: "Side Quest", src: "/images/baskets/side-quest.webp" },
  { id: "deep-focus", label: "Deep Focus", src: "/images/baskets/deep-focus.webp" },
  { id: "signal-noise", label: "Signal / Noise", src: "/images/baskets/signal-noise.webp" },
  { id: "fresh-start", label: "Fresh Start", src: "/images/baskets/fresh-start.webp" },
] as const;

export type BasketCover = (typeof BASKET_COVERS)[number];
export type BasketCoverId = BasketCover["id"];

export function isBasketCoverId(value: unknown): value is BasketCoverId {
  return typeof value === "string" && BASKET_COVERS.some((cover) => cover.id === value);
}

export function getBasketCover(coverId?: string): BasketCover {
  return BASKET_COVERS.find((cover) => cover.id === coverId) ?? BASKET_COVERS[0];
}

/** Old shared links still have an image, including the original ten sample covers. */
export function resolveLegacyBasketCover(name: string, assets: readonly { symbol: string }[] = []): BasketCoverId {
  const normalizedName = name.trim().toLowerCase();
  const sample = BASKET_COVERS.slice(0, 10).find((cover) => cover.label.toLowerCase() === normalizedName);
  if (sample) return sample.id;
  const identity = `${normalizedName}|${assets.map((asset) => asset.symbol).sort().join(",")}`;
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return BASKET_COVERS[(hash >>> 0) % BASKET_COVERS.length].id;
}

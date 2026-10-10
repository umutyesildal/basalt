import { logoUrl } from "./logos";

/** Decorative aliases for these exact project mock mints, never issuer-backed assets. */
const FIXTURES: Record<string, { label: string; icon: string; letter: string; color: string }> = {
  CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ: { label: "Core", icon: "core", letter: "A", color: "#D5D8AE" },
  EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab: { label: "Pulse", icon: "pulse", letter: "B", color: "#D7A894" },
  "5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA": { label: "Orbit", icon: "orbit", letter: "C", color: "#AFC7D0" },
  "8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq": { label: "Wave", icon: "wave", letter: "D", color: "#B7ADC9" },
};
const MOCK_SYMBOL_ART: Record<string, { icon: string; color: string }> = {
  NVDA: { icon: "chip", color: "#ADC4A1" }, AAPL: { icon: "spark", color: "#D6C5A3" },
  MSFT: { icon: "window", color: "#AEC4D9" }, TSLA: { icon: "route", color: "#CFABA6" },
  META: { icon: "loop", color: "#B4C7BE" }, AMZN: { icon: "parcel", color: "#D8B493" },
  GOOGL: { icon: "signal", color: "#C2C6AD" },
};

export function onchainTokenDisplay(ticker: string, mint?: string, devnet = false): { label: string; src: string; sourceLabel: string; color: string } {
  const symbol = ticker.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 20) || "Token";
  const fixture = devnet && mint ? FIXTURES[mint] : undefined;
  if (fixture) return {
    label: fixture.label, src: `/images/devnet-tokens/${fixture.icon}.svg`, color: fixture.color,
    sourceLabel: `${fixture.label} · Basalt test token ${fixture.letter} (BSTEST${fixture.letter})`,
  };
  const art = MOCK_SYMBOL_ART[symbol.toUpperCase()];
  return {
    label: symbol,
    src: devnet ? `/images/devnet-tokens/${art?.icon ?? "core"}.svg` : logoUrl(symbol),
    sourceLabel: devnet ? `${symbol} · devnet test token` : symbol,
    color: art?.color ?? "#D5D8AE",
  };
}

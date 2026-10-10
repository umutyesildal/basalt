import { allocationColor, NEUTRAL_ALLOCATION_COLOR } from "./allocation-colors";
import { getConceptAsset } from "./concept-assets";

/** Stock-themed presentation for exact project mocks. These are not issuer xStocks. */
const DEMO_THEMES: Readonly<Record<string, { symbol: string; letter: string }>> = {
  CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ: { symbol: "TSLA", letter: "A" },
  EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab: { symbol: "NVDA", letter: "B" },
  "5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA": { symbol: "PLTR", letter: "C" },
  "8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq": { symbol: "COIN", letter: "D" },
};
const GENERIC_TOKEN_ART = "/images/devnet-tokens/core.svg";

export interface OnchainTokenDisplay {
  label: string;
  symbol: string;
  secondaryLabel: string;
  src: string;
  sourceLabel: string;
  color: string;
  isTestToken: boolean;
}

export function onchainTokenDisplay(ticker: string, mint?: string, devnet = false): OnchainTokenDisplay {
  const symbol = ticker.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim().slice(0, 20) || "Token";
  const theme = devnet && mint ? DEMO_THEMES[mint] : undefined;
  // A devnet theme explicitly borrows stock artwork for a test experience.
  // Mainnet always resolves the exact mint; text alone cannot borrow issuer identity.
  const unresolvedFixture = /^(?:[ABCD]|BSTEST[ABCD])$/i.test(symbol);
  const asset = devnet
    ? theme ? getConceptAsset(theme.symbol) : unresolvedFixture ? undefined : getConceptAsset(symbol)
    : getConceptAsset(symbol, mint);
  const displaySymbol = asset?.symbol ?? symbol;
  return {
    label: asset?.name ?? symbol,
    symbol: displaySymbol,
    secondaryLabel: devnet ? `${displaySymbol} · test token` : displaySymbol,
    src: asset?.logoUrl ?? GENERIC_TOKEN_ART,
    sourceLabel: theme
      ? `${asset?.name ?? theme.symbol} themed demo · Basalt test token ${theme.letter} (BSTEST${theme.letter}) · not issuer-backed`
      : devnet ? `${symbol} · project devnet test token · not issuer-backed` : `${displaySymbol}${mint ? ` · ${mint}` : ""}`,
    color: asset ? allocationColor(asset.symbol, devnet ? undefined : mint) : NEUTRAL_ALLOCATION_COLOR,
    isTestToken: devnet,
  };
}

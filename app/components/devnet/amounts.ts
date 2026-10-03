/** Exact base-unit parsing for the devnet pack. Transfers always use raw u64. */
export const U64_MAX = (1n << 64n) - 1n;

export function parseTokenUnits(input: string, decimals: number): bigint | null {
  const text = input.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12 || !/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d*)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  const raw = BigInt(whole.replace(/,/g, "")) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return raw <= U64_MAX ? raw : null;
}

/** Group on blur without dropping the user's decimal point or trailing zeros. */
export function formatTokenUnitsInput(input: string, decimals = 8): string {
  if (parseTokenUnits(input, decimals) === null) return input;
  const text = input.trim();
  const [whole, fraction = ""] = text.split(".");
  const grouped = BigInt(whole.replace(/,/g, "")).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}${text.includes(".") ? `.${fraction}` : ""}`;
}

export function tokenUnits(raw: bigint | string, decimals: number): string {
  const digits = BigInt(raw).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}

export function percentBps(input: string): number | null {
  const raw = parseTokenUnits(input, 2);
  return raw !== null && raw <= 10_000n ? Number(raw) : null;
}

/** Split a base-token budget by stored weights; floor dust stays in the wallet. */
export function weightedSeed(raw: bigint, weights: number[]): bigint[] {
  return weights.map((weight) => raw * BigInt(weight) / 10_000n);
}

/** Preserve current vault ratios, using the core program's raw quantities. */
export function budgetDeposits(raw: bigint, vaults: bigint[]): bigint[] {
  const total = vaults.reduce((sum, amount) => sum + amount, 0n);
  return total > 0n ? vaults.map((amount) => raw * amount / total) : vaults.map(() => 0n);
}

export function maximumBudget(vaults: bigint[], balances: bigint[]): bigint {
  const total = vaults.reduce((sum, amount) => sum + amount, 0n);
  if (!total || vaults.some((amount) => amount <= 0n)) return 0n;
  return vaults.reduce((limit, vault, i) => {
    const candidate = (balances[i] ?? 0n) * total / vault;
    return candidate < limit ? candidate : limit;
  }, U64_MAX);
}

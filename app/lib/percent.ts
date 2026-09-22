/** Convert a displayed percentage to the exact integer used by the program. */
export function parsePercentToBps(input: string): number | null {
  const value = input.trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= 10_000 ? bps : null;
}

import { readFileSync } from "node:fs";
export const retiredKeys = Object.freeze(JSON.parse(readFileSync(new URL("./retired-keys.json", import.meta.url), "utf8")).keys);
const retired = new Set(retiredKeys.map(key => key.publicKey));
/** Takes public metadata only. Never exempts localnet or accepts a bypass flag. */
export function assertNotRetiredPublicKey(value, role = "signer") {
  const publicKey = typeof value === "string" ? value : value?.toBase58?.();
  if (!publicKey) throw new Error(`Missing public key for ${role}`);
  if (retired.has(publicKey)) throw new Error(`BAS-AUD-01: retired public key cannot be used as ${role}: ${publicKey}`);
  return value;
}

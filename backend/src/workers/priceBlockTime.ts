/** Resolve Jupiter mainnet slots to source timestamps, independently of devnet RPC_URL. */
const times = new Map<number, { value: string | null; checkedAt: number }>();
const inFlight = new Map<string, Promise<Record<number, string | null>>>();
export function clearPriceBlockTimes(): void { times.clear(); inFlight.clear(); }
export async function getPriceBlockTimes(
  slots: number[],
  opts: { fetchImpl?: typeof fetch; rpcUrl?: string; now?: () => Date; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Record<number, string | null>> {
  const at = (opts.now ?? (() => new Date()))().getTime();
  const unique = [...new Set(slots)].filter(slot => Number.isSafeInteger(slot) && slot > 0).slice(0, 100);
  const missing = unique.filter(slot => {
    const hit = times.get(slot);
    return !hit || (hit.value === null && at - hit.checkedAt >= 30_000);
  });
  if (missing.length > 0) {
    const key = [...missing].sort((a, b) => a - b).join(",");
    const existing = inFlight.get(key);
    if (existing) await existing;
    else {
      const job = (async () => {
        const result: Record<number, string | null> = Object.fromEntries(missing.map(slot => [slot, null]));
        try {
          const res = await (opts.fetchImpl ?? fetch)(opts.rpcUrl || process.env.PRICE_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs ?? 3_000)]) : AbortSignal.timeout(opts.timeoutMs ?? 3_000),
            body: JSON.stringify(missing.map(slot => ({ jsonrpc: "2.0", id: slot, method: "getBlockTime", params: [slot] }))),
          });
          if (res.ok) {
            const body: unknown = await res.json();
            if (Array.isArray(body)) for (const item of body) {
              if (!item || typeof item !== "object" || !missing.includes(item.id)) continue;
              const seconds = item.result;
              if (typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 && seconds * 1000 <= at + 60_000) {
                result[item.id] = new Date(seconds * 1000).toISOString();
              }
            }
          }
        } catch { /* Unknown source time stays null; retrieval time cannot replace it. */ }
        for (const slot of missing) {
          const current = times.get(slot);
          // Block timestamps are immutable. An overlapping failure cannot erase one.
          if (current?.value || (current && current.checkedAt > at)) continue;
          times.set(slot, { value: result[slot], checkedAt: at });
        }
        while (times.size > 4096) times.delete(times.keys().next().value!);
        return result;
      })();
      inFlight.set(key, job);
      try { await job; } finally { inFlight.delete(key); }
    }
  }
  return Object.fromEntries(unique.map(slot => [slot, times.get(slot)?.value ?? null]));
}

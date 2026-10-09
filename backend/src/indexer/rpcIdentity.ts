/** Read-only startup identity: bounded independently of ordinary indexer RPCs. */
export async function readIndexerGenesisHash(rpcUrl: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] }),
    signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error("RPC identity unavailable");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("RPC identity body unavailable");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_384) { await reader.cancel(); throw new Error("RPC identity body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: unknown };
  if (body.jsonrpc !== "2.0" || body.id !== 1 || body.error || typeof body.result !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.result)) throw new Error("Invalid RPC identity");
  return body.result;
}

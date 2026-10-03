/** Runtime helpers for the explicitly executed, isolated devnet test harness. */
import { mkdir, readFile, writeFile, rename, lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey, type FetchFn } from "@solana/web3.js";
import { DEVNET_GENESIS, FIXTURE_PROFILE } from "./profile.ts";
export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const RUNS_ROOT = join(REPO_ROOT, ".cache", "devnet-xstocks");
export interface FixtureRecord { letter: string; symbol: string; name: string; mint: string; decimals: 8; multiplier: number; signatures: { create?: string; fund?: string; whitelist?: string } }
export interface FixtureState { version: 1; cluster: "devnet"; genesisHash: string; profile: string; payer: string; createdAt: string; updatedAt: string; mocks: FixtureRecord[]; [key: string]: unknown }
export function getRunDir(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)) throw new Error("Run ID must contain 1-80 letters, numbers, hyphens or underscores");
  return join(RUNS_ROOT, id);
}
export async function prepareRunDir(dir: string): Promise<void> {
  if (!resolve(dir).startsWith(resolve(RUNS_ROOT) + sep)) throw new Error("Test state must be inside the isolated devnet cache directory");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const actual = await realpath(dir), root = await realpath(RUNS_ROOT);
  if (!actual.startsWith(root + sep)) throw new Error("Test state symlink escapes its isolated directory");
}
/** Never logs signer material or incorporates it into an error. Called only after --execute. */
export async function loadSigner(file: string, expected?: PublicKey): Promise<Keypair> {
  const info = await lstat(file);
  if (!info.isFile() || info.size > 1024) throw new Error("Signer must be a regular keypair file");
  let signer: Keypair;
  try {
    const value: unknown = JSON.parse(await readFile(file, "utf8"));
    if (!Array.isArray(value) || value.length !== 64 || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error();
    signer = Keypair.fromSecretKey(Uint8Array.from(value));
  } catch { throw new Error("Unable to decode signer file"); }
  if (expected && !signer.publicKey.equals(expected)) throw new Error("Signer public key does not match the explicitly expected payer");
  return signer;
}
export async function loadOrCreateRunKeypair(dir: string, name: string): Promise<Keypair> {
  await prepareRunDir(dir);
  if (!/^[A-Za-z0-9_-]+\.json$/.test(name)) throw new Error("Unsafe test keypair filename");
  const file = join(dir, name);
  try { await lstat(file); return await loadSigner(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const keypair = Keypair.generate();
  await writeFile(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600, flag: "wx" });
  return keypair;
}
export async function loadFixtureState(dir: string): Promise<FixtureState | null> {
  try {
    const value = JSON.parse(await readFile(join(dir, "state.json"), "utf8")) as FixtureState;
    if (value.version !== 1 || value.cluster !== "devnet" || value.genesisHash !== DEVNET_GENESIS || value.profile !== FIXTURE_PROFILE || !Array.isArray(value.mocks)) throw new Error("Unexpected fixture state identity");
    new PublicKey(value.payer); return value;
  } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
}
export async function saveFixtureState(dir: string, state: FixtureState): Promise<void> {
  await prepareRunDir(dir); state.updatedAt = new Date().toISOString();
  const file = join(dir, "state.json"); await writeFile(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(`${file}.tmp`, file);
}


/** Serializes this test process's public RPC HTTP work; it never retries a request. */
export function createPacedDevnetFetch(options: { fetchImpl?: typeof globalThis.fetch; minIntervalMs?: number; timeoutMs?: number } = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const interval = options.minIntervalMs ?? 400, timeout = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(interval) || interval < 0 || !Number.isFinite(timeout) || timeout <= 0) throw new Error("Invalid RPC pacing configuration");
  const shutdown = new AbortController(); let nextStart = 0, tail: Promise<unknown> = Promise.resolve();
  function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    });
  }
  function wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
      signal.addEventListener("abort", abort, { once: true });
    });
  }
  const pacedFetch: FetchFn = ((input: Parameters<FetchFn>[0], init: Parameters<FetchFn>[1]) => {
    if (shutdown.signal.aborted) return Promise.reject(shutdown.signal.reason);
    // web3 passes a URL string and an init object; only the common Fetch API is used.
    const request = init as RequestInit | undefined;
    const queuedSignal = AbortSignal.any([shutdown.signal, ...(request?.signal ? [request.signal] : [])]);
    const operation = tail.then(async () => {
      queuedSignal.throwIfAborted();
      while (nextStart > Date.now()) await wait(nextStart - Date.now(), queuedSignal);
      queuedSignal.throwIfAborted(); nextStart = Date.now() + interval;
      const signal = AbortSignal.any([queuedSignal, AbortSignal.timeout(timeout)]);
      const response = await fetchImpl(input as string, { ...request, signal });
      // Draining the body before unlocking is essential: headers alone leave a live
      // HTTP connection, including each of web3's internally retried 429 responses.
      const bytes = await response.arrayBuffer();
      signal.throwIfAborted();
      return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    });
    tail = operation.then(() => undefined, () => undefined);
    return abortable(operation, queuedSignal);
  }) as FetchFn;
  return { fetch: pacedFetch, close: () => shutdown.abort(new Error("Devnet RPC transport closed")) };
}
/** Devnet-only factory; standard web3 429 handling remains enabled. */
export function createDevnetConnection(options: Parameters<typeof createPacedDevnetFetch>[0] = {}): Connection & { closeRpc(): void } {
  const transport = createPacedDevnetFetch(options);
  const connection = new Connection("https://api.devnet.solana.com", { commitment: "confirmed", fetch: transport.fetch, disableRetryOnRateLimit: false, httpAgent: false });
  return Object.assign(connection, { closeRpc: transport.close });
}

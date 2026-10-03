/** Persist only a public nonce under a hash of the immutable draft, never its named contents. */
export type DraftNonceStorage = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

const nonces = new Map<string, number>();

function draftKey(fingerprint: string): string {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("The basket draft fingerprint is invalid.");
  return `basalt:create-draft:v1:${fingerprint}`;
}

function browserStorage(): DraftNonceStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.localStorage; }
  catch { return undefined; }
}

/** Unchanged drafts retain the same basket PDA after interrupted account setup. */
export function getDraftNonce(fingerprint: string, storage?: DraftNonceStorage): number {
  const key = draftKey(fingerprint);
  const cached = nonces.get(key);
  if (cached !== undefined) return cached;
  const target = storage ?? browserStorage();
  try {
    const saved = target?.getItem(key);
    if (saved && /^[1-9]\d*$/.test(saved)) {
      const nonce = Number(saved);
      if (Number.isSafeInteger(nonce) && nonce > 0) {
        nonces.set(key, nonce);
        return nonce;
      }
    }
  } catch { /* Memory reuse remains available when storage is denied. */ }
  const nonce = Date.now();
  if (!Number.isSafeInteger(nonce) || nonce <= 0) throw new Error("Your device clock cannot create a valid basket nonce.");
  nonces.set(key, nonce);
  try { target?.setItem(key, String(nonce)); }
  catch { /* No storage permission is required to create a basket. */ }
  return nonce;
}

/** Clear only once RPC confirms that this economic basket creation succeeded. */
export function clearDraftNonce(fingerprint: string, storage?: DraftNonceStorage): void {
  const key = draftKey(fingerprint);
  nonces.delete(key);
  const target = storage ?? browserStorage();
  try {
    if (target?.removeItem) target.removeItem(key);
    else target?.setItem(key, "");
  } catch { /* Confirmation is preserved even if cleanup is unavailable. */ }
}

/**
 * Schedule wallet connect after the current React passive-effect flush. The
 * wallet provider subscribes to adapter events in a parent effect, so an
 * already-authorized adapter must not emit `connect` before that subscription.
 */
export function scheduleAfterWalletProviderEffects(callback: () => void): () => void {
  const timer = globalThis.setTimeout(callback, 0);
  return () => globalThis.clearTimeout(timer);
}

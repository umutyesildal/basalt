export interface WalletIntent { connection: object; wallet: string | null }

/** This assertion is synchronous so the caller can put it directly beside the wallet/RPC invocation. */
export function assertWalletIntentNow(expected: WalletIntent, actual: WalletIntent): void {
  if (actual.connection !== expected.connection || actual.wallet !== expected.wallet || !expected.wallet) {
    throw new Error("Your wallet or network changed. Review the current basket again.");
  }
}

/** Recheck the live wallet/network on both sides of an asynchronous basket-intent guard. */
export async function assertWalletIntent(expected: WalletIntent, current: () => WalletIntent, beforeSign?: () => void | Promise<void>): Promise<void> {
  assertWalletIntentNow(expected, current());
  await beforeSign?.();
  assertWalletIntentNow(expected, current());
}

/** The final assertion and actual send share one synchronous turn, after any async preparation. */
export async function sendWithReviewedIntent<T>(send: () => Promise<T>, prepare: () => void | Promise<void>, assertImmediatelyBeforeSend: () => void): Promise<T> {
  await prepare();
  assertImmediatelyBeforeSend();
  return send();
}

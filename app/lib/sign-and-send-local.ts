import {
  type Connection,
  type Transaction,
  type TransactionSignature,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";

import { isTransientRpcError, withRetry, type RetryEvent } from "./rpc-retry";

/** Keep the wallet's network setting out of local-lab broadcasts. */
export async function signAndSendLocal(
  transaction: Transaction | VersionedTransaction,
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>,
  connection: Pick<Connection, "sendRawTransaction">,
  onRetry?: (event: RetryEvent) => void,
  beforeBroadcast?: () => void | Promise<void>,
  assertImmediatelyBeforeAction?: () => void,
): Promise<TransactionSignature> {
  assertImmediatelyBeforeAction?.();
  const signed = await signTransaction(transaction);
  const signatureBytes = "signature" in signed ? signed.signature : signed.signatures[0];
  if (!(signatureBytes instanceof Uint8Array) || signatureBytes.length !== 64 || !signatureBytes.some((byte) => byte !== 0)) {
    throw new Error("The wallet did not return a signed transaction. Review and sign again.");
  }
  const knownSignature = bs58.encode(signatureBytes);
  const bytes = signed.serialize();
  let ambiguousSend = false;
  try {
    return await withRetry(
      async () => {
        // Guard failures before a send do not imply the transaction was sent.
        await beforeBroadcast?.();
        assertImmediatelyBeforeAction?.();
        try {
          return await connection.sendRawTransaction(bytes, { skipPreflight: true, preflightCommitment: "confirmed" });
        } catch (error) {
          // A lost transport response can follow acceptance by the RPC. Keep
          // retrying these same signed bytes, never a newly built transaction.
          if (isTransientRpcError(error)) ambiguousSend = true;
          throw error;
        }
      },
      { label: "local transaction send", onRetry },
    );
  } catch (error) {
    // Once a send is uncertain, even a later guard failure cannot prove the
    // original transaction was never accepted. Reconcile its local signature
    // through the normal confirmation/submitted flow instead of offering a
    // fresh economic-action retry. No ambiguous attempt: preserve the error.
    if (ambiguousSend) return knownSignature;
    throw error;
  }
}

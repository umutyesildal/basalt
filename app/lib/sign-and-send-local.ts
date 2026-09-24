import {
  type Connection,
  type Transaction,
  type TransactionSignature,
  type VersionedTransaction,
} from "@solana/web3.js";

import { withRetry, type RetryEvent } from "./rpc-retry";

/** Keep the wallet's network setting out of local-lab broadcasts. */
export async function signAndSendLocal(
  transaction: Transaction | VersionedTransaction,
  signTransaction: <T extends Transaction | VersionedTransaction>(transaction: T) => Promise<T>,
  connection: Pick<Connection, "sendRawTransaction">,
  onRetry?: (event: RetryEvent) => void,
): Promise<TransactionSignature> {
  const signed = await signTransaction(transaction);
  const bytes = signed.serialize();
  return withRetry(
    () => connection.sendRawTransaction(bytes, { skipPreflight: true, preflightCommitment: "confirmed" }),
    { label: "local transaction send", onRetry },
  );
}

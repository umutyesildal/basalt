import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  type SendOptions,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { signAndSendLocal } from "../lib/sign-and-send-local";

const signer = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const transfer = SystemProgram.transfer({
  fromPubkey: signer.publicKey,
  toPubkey: Keypair.generate().publicKey,
  lamports: 0,
});

describe("local managed transaction broadcast", () => {
  it("signs a legacy transaction and broadcasts those bytes through the selected RPC", async () => {
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array, _options?: SendOptions) => "local-signature");

    const signature = await signAndSendLocal(transaction, signTransaction, { sendRawTransaction });

    expect(signature).toBe("local-signature");
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledOnce();
    const [bytes, options] = sendRawTransaction.mock.calls[0];
    const decoded = Transaction.from(bytes);
    expect(decoded.verifySignatures()).toBe(true);
    expect(decoded.feePayer?.equals(signer.publicKey)).toBe(true);
    expect(options).toEqual({ skipPreflight: true, preflightCommitment: "confirmed" });
  });

  it("broadcasts a signed v0 transaction without asking the wallet to send it", async () => {
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: blockhash,
      instructions: [transfer],
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof VersionedTransaction) tx.sign([signer]);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => "v0-signature");

    await signAndSendLocal(transaction, signTransaction, { sendRawTransaction });

    const decoded = VersionedTransaction.deserialize(sendRawTransaction.mock.calls[0][0]);
    expect(decoded.signatures[0].some((byte) => byte !== 0)).toBe(true);
    expect(decoded.message.staticAccountKeys[0].equals(signer.publicKey)).toBe(true);
  });

  it("does not broadcast when the wallet refuses to sign", async () => {
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> => {
      throw new Error("User rejected the request");
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => "unreachable");

    await expect(signAndSendLocal(transaction, signTransaction, { sendRawTransaction })).rejects.toThrow("User rejected");
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });
});

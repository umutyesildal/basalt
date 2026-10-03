import { afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
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
  afterEach(() => { vi.useRealTimers(); });
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
  it("does not broadcast if the wallet or network changed during signing", async () => {
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => "unreachable");
    const guard = vi.fn(async () => { throw new Error("Your wallet changed. Review again."); });
    await expect(signAndSendLocal(transaction, signTransaction, { sendRawTransaction }, undefined, guard)).rejects.toThrow("Your wallet changed");
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledOnce();
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it("reconciles the locally signed signature when all raw-send responses are lost", async () => {
    vi.useFakeTimers();
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => { throw new Error("fetch failed after RPC accepted the transaction"); });
    const pending = signAndSendLocal(transaction, signTransaction, { sendRawTransaction });
    await vi.runAllTimersAsync();
    expect(await pending).toBe(bs58.encode(transaction.signature!));
    expect(signTransaction).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledTimes(6);
    const firstBytes = Buffer.from(sendRawTransaction.mock.calls[0][0]);
    for (const [bytes] of sendRawTransaction.mock.calls) expect(Buffer.from(bytes)).toEqual(firstBytes);
  });

  it("reconciles an uncertain send if the wallet guard stops a later retry", async () => {
    vi.useFakeTimers();
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => { throw new Error("socket hang up after submission"); });
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("Your wallet changed"));
    const pending = signAndSendLocal(transaction, signTransaction, { sendRawTransaction }, undefined, guard);
    await vi.runAllTimersAsync();
    expect(await pending).toBe(bs58.encode(transaction.signature!));
    expect(sendRawTransaction).toHaveBeenCalledOnce();
    expect(guard).toHaveBeenCalledTimes(2);
  });

  it("does not invent a submission after retryable guards fail before every send", async () => {
    vi.useFakeTimers();
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => "never-sent");
    const guard = vi.fn(async () => { throw new Error("fetch failed while verifying the network"); });
    const pending = signAndSendLocal(transaction, signTransaction, { sendRawTransaction }, undefined, guard);
    const rejection = expect(pending).rejects.toThrow("RPC stayed unavailable");
    await vi.runAllTimersAsync();
    await rejection;
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

  it("preserves deterministic broadcast errors when there was no uncertain send", async () => {
    const transaction = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(transfer);
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) tx.sign(signer);
      return tx;
    });
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => { throw new Error("Transaction signature verification failure"); });
    await expect(signAndSendLocal(transaction, signTransaction, { sendRawTransaction })).rejects.toThrow("signature verification failure");
    expect(sendRawTransaction).toHaveBeenCalledOnce();
  });

  it("never broadcasts a wallet response with an all-zero v0 signature", async () => {
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: blockhash, instructions: [transfer] }).compileToV0Message());
    const signTransaction = vi.fn(async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx);
    const sendRawTransaction = vi.fn(async (_bytes: Buffer | Uint8Array) => "never-sent");
    await expect(signAndSendLocal(transaction, signTransaction, { sendRawTransaction })).rejects.toThrow("did not return a signed transaction");
    expect(sendRawTransaction).not.toHaveBeenCalled();
  });

});

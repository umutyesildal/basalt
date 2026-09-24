import {
  BaseSignerWalletAdapter,
  isVersionedTransaction,
  WalletNotConnectedError,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { Keypair, type PublicKey, type Transaction, type TransactionVersion, type VersionedTransaction } from "@solana/web3.js";

import { isLocalManagedEndpoint } from "@/lib/managed-chain";
import { CLUSTER, RPC_ENDPOINT } from "@/lib/wallet";

export type LocalLabRole = "manager" | "guardian";
const names = { manager: "Local test manager", guardian: "Local test guardian" } as const;

export function localLabEnabled(): boolean {
  if (process.env.NODE_ENV !== "development" || !isLocalManagedEndpoint(CLUSTER, RPC_ENDPOINT) || typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

function localKeypair(role: LocalLabRole): Keypair {
  if (!localLabEnabled()) throw new Error("Local test wallets are available only on the local development lab.");
  const storageKey = `basalt:managed-lab:${role}`;
  const saved = window.sessionStorage.getItem(storageKey);
  if (saved) {
    try {
      const bytes: unknown = JSON.parse(saved);
      if (Array.isArray(bytes) && bytes.length === 64 && bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return Keypair.fromSecretKey(Uint8Array.from(bytes));
      }
    } catch { /* Invalid test-only session key; replace it below. */ }
  }
  const keypair = Keypair.generate();
  window.sessionStorage.setItem(storageKey, JSON.stringify(Array.from(keypair.secretKey)));
  return keypair;
}

export function localLabPublicKey(role: LocalLabRole): PublicKey {
  return localKeypair(role).publicKey;
}

/** Disposable localnet signer. Keys live only in this browser tab's session storage. */
export class LocalLabWalletAdapter extends BaseSignerWalletAdapter {
  name: WalletName;
  url = "http://localhost";
  icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='10' fill='%23FCEE0A'/%3E%3C/svg%3E";
  readyState = WalletReadyState.Loadable;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(["legacy", 0]);
  private keypair: Keypair | null = null;

  constructor(private readonly role: LocalLabRole) {
    super();
    this.name = names[role] as WalletName;
  }
  get connecting() { return false; }
  get publicKey() { return this.keypair?.publicKey ?? null; }

  async connect(): Promise<void> {
    this.keypair = localKeypair(this.role);
    this.emit("connect", this.keypair.publicKey);
  }

  async disconnect(): Promise<void> {
    this.keypair = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T> {
    if (!localLabEnabled() || !this.keypair) throw new WalletNotConnectedError();
    if (isVersionedTransaction(transaction)) transaction.sign([this.keypair]);
    else transaction.partialSign(this.keypair);
    return transaction;
  }
}

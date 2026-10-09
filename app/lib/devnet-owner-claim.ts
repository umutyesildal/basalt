/** Public-only whitelist handoff. The connected owner wallet is the only signer. */
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import { createNamespaceRouting, DEVNET_GENESIS_HASH, type NamespaceRouting } from "./program-namespaces";
import { DEVNET_OWNER_NAMESPACE } from "../../backend/src/config/programNamespaces";
import { assertWalletIntentNow } from "./wallet-intent";

import publicPolicy from "../../backend/src/config/devnetOwnerPolicy.json";

// Public source policy only; neither URL/API/env nor a wallet supplies trust roots.
export const DEVNET_OWNER_CLAIM_POLICY = Object.freeze({
  namespaceId: "devnet-owner-v1",
  owner: publicPolicy.owner,
  bootstrapAuthority: publicPolicy.bootstrapAuthority,
  programs: Object.freeze({ whitelist: publicPolicy.programIds.whitelist,
    factory: publicPolicy.programIds.basket_factory, basket: publicPolicy.programIds.basket }),
});
// Prepared setup only: this does not register programs for workers or enable creation.
const OWNER_CLAIM_ROUTING = createNamespaceRouting([DEVNET_OWNER_NAMESPACE]);
export const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const CONFIG_DISC = Buffer.from("3a330ca6266d12ff", "hex");
const CLAIM_DISC = Buffer.from("de84b97b7f6b061f", "hex");
export type OwnerClaimState = Readonly<{
  status: "waiting" | "ready" | "claimed";
  contextSlot: number;
  authority: string;
  pendingAuthority: string | null;
  loaderAuthority: string;
  mintCount: number;
}>;
export type OwnerClaimRpc = Pick<Connection, "getGenesisHash" | "getMultipleAccountsInfoAndContext">;
const invalid = (): never => { throw new Error("The devnet whitelist handoff does not match the reviewed setup."); };
export class OwnerClaimAlreadyCompleteError extends Error {
  constructor() { super("The owner has already accepted whitelist authority."); }
}
function claimNamespace(routing: NamespaceRouting) {
  const p = DEVNET_OWNER_CLAIM_POLICY;
  if (publicPolicy.cluster !== "devnet" || publicPolicy.genesisHash !== DEVNET_GENESIS_HASH || publicPolicy.governance.kind !== "single-owner-devnet-only" || publicPolicy.governance.multisig || publicPolicy.governance.productionApproval) return invalid();
  const namespace = routing.registry.find(entry => entry.id === p.namespaceId);
  if (!namespace || namespace.genesisHash !== DEVNET_GENESIS_HASH ||
      namespace.programs.whitelist !== p.programs.whitelist || namespace.programs.factory !== p.programs.factory ||
      namespace.programs.basket !== p.programs.basket) {
    throw new Error("The reviewed devnet owner setup is not registered yet.");
  }
  return namespace;
}

/** One finalized bank authenticates the program, canonical loader state and config. */
export async function inspectDevnetOwnerClaim(connection: OwnerClaimRpc, routing = OWNER_CLAIM_ROUTING, minContextSlot?: number): Promise<OwnerClaimState> {
  const namespace = claimNamespace(routing);
  if (minContextSlot !== undefined && (!Number.isSafeInteger(minContextSlot) || minContextSlot < 0)) return invalid();
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Owner setup is available on Solana devnet only.");
  const programId = new PublicKey(namespace.programs.whitelist);
  const [programData] = PublicKey.findProgramAddressSync([programId.toBuffer()], UPGRADEABLE_LOADER);
  const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
  if (config.toBase58() !== namespace.whitelistConfig) return invalid();
  const result = await connection.getMultipleAccountsInfoAndContext([programId, programData, config], { commitment: "finalized", ...(minContextSlot === undefined ? {} : { minContextSlot }) });
  if (!Number.isSafeInteger(result.context.slot) || result.context.slot < (minContextSlot ?? 0) || result.value.length !== 3) return invalid();
  const [program, loader, whitelist] = result.value;
  if (!program || !program.executable || !program.owner.equals(UPGRADEABLE_LOADER) || program.data.length !== 36 ||
      program.data.readUInt32LE(0) !== 2 || !new PublicKey(program.data.subarray(4, 36)).equals(programData) ||
      !loader || loader.executable || !loader.owner.equals(UPGRADEABLE_LOADER) || loader.data.length < 45 ||
      loader.data.readUInt32LE(0) !== 3 || loader.data[12] !== 1 || loader.data.readBigUInt64LE(4) > BigInt(result.context.slot) ||
      !whitelist || whitelist.executable || !whitelist.owner.equals(programId) || whitelist.data.length !== 78 ||
      !whitelist.data.subarray(0, 8).equals(CONFIG_DISC)) return invalid();
  const loaderAuthority = new PublicKey(loader.data.subarray(13, 45)).toBase58();
  if (loaderAuthority !== DEVNET_OWNER_CLAIM_POLICY.bootstrapAuthority && loaderAuthority !== DEVNET_OWNER_CLAIM_POLICY.owner) return invalid();
  const data = whitelist.data, authority = new PublicKey(data.subarray(8, 40)).toBase58(), option = data[40];
  if (option !== 0 && option !== 1) return invalid();
  const pendingAuthority = option === 1 ? new PublicKey(data.subarray(41, 73)).toBase58() : null;
  const countOffset = option === 1 ? 73 : 41;
  if (data[countOffset + 4] !== bump) return invalid();
  let status: OwnerClaimState["status"];
  if (authority === DEVNET_OWNER_CLAIM_POLICY.owner && pendingAuthority === null) status = "claimed";
  else if (authority === DEVNET_OWNER_CLAIM_POLICY.bootstrapAuthority && pendingAuthority === DEVNET_OWNER_CLAIM_POLICY.owner) status = "ready";
  else if (authority === DEVNET_OWNER_CLAIM_POLICY.bootstrapAuthority && pendingAuthority === null) status = "waiting";
  else return invalid();
  return { status, contextSlot: result.context.slot, authority, pendingAuthority, loaderAuthority, mintCount: data.readUInt32LE(countOffset) };
}

/** Wrong wallets are rejected before any RPC or wallet preparation. Completed claims have no instruction. */
export async function prepareDevnetOwnerClaim(connection: OwnerClaimRpc, wallet: PublicKey, routing = OWNER_CLAIM_ROUTING, minContextSlot?: number) {
  if (wallet.toBase58() !== DEVNET_OWNER_CLAIM_POLICY.owner) throw new Error("Connect the designated owner wallet to accept this devnet whitelist.");
  const state = await inspectDevnetOwnerClaim(connection, routing, minContextSlot);
  if (state.status === "claimed") return { state, instructions: [] as TransactionInstruction[] };
  if (state.status !== "ready") throw new Error("The current administrator has not proposed the owner handoff yet.");
  const namespace = claimNamespace(routing);
  return { state, instructions: [new TransactionInstruction({
    programId: new PublicKey(namespace.programs.whitelist), data: Buffer.from(CLAIM_DISC),
    keys: [
      { pubkey: new PublicKey(namespace.whitelistConfig), isWritable: true, isSigner: false },
      { pubkey: wallet, isWritable: false, isSigner: true },
    ],
  })] };
}

export interface OwnerClaimIntent {
  connection: object;
  wallet: string | null;
  accepted: boolean;
  active: boolean;
}
/** One reviewed page/wallet/RPC scope spans preparation, simulation and the final synchronous signing guard. */
export function createDevnetOwnerClaimReview(connection: OwnerClaimRpc, wallet: PublicKey, current: () => OwnerClaimIntent, routing = OWNER_CLAIM_ROUTING, initialSlot?: number) {
  const expected = { connection, wallet: wallet.toBase58() };
  let observedSlot = initialSlot;
  const assertCurrent = () => {
    const now = current();
    assertWalletIntentNow(expected, now);
    if (!now.active || !now.accepted) throw new Error("Review and accept the devnet administration step on the setup page again.");
  };
  return {
    assertCurrent,
    async prepare() {
      assertCurrent();
      const next = await prepareDevnetOwnerClaim(connection, wallet, routing, observedSlot);
      assertCurrent();
      observedSlot = next.state.contextSlot;
      return next;
    },
  };
}

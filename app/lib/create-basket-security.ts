import { PublicKey, type Connection } from "@solana/web3.js";
import retiredInventory from "../../scripts/security/retired-keys.json";
import { APP_NAMESPACE_ROUTING, namespacePrograms, type NamespaceRouting, type ProgramNamespace, DEVNET_GENESIS_HASH } from "./program-namespaces";

// The inventory contains public identities only; CLI and browser creation use
// the same source, with no localnet exemption or caller-controlled bypass.
const retiredPublicKeys = new Set(retiredInventory.keys.map((entry) => entry.publicKey));
const FACTORY_CONFIG_DISCRIMINATOR = [29,197,255,232,22,128,67,26];
const FACTORY_CREATION_ERROR = "New basket creation is blocked: the factory configuration or treasury is invalid or retired.";

/** Only new basket creation uses this guard. Existing redemption stays permissionless. */
export async function assertSafeCreateBasketFactory(connection: Pick<Connection,"getAccountInfo" | "getGenesisHash">, routing: NamespaceRouting = APP_NAMESPACE_ROUTING): Promise<ProgramNamespace> {
  const namespace = routing.creation(), programs = namespacePrograms(namespace);
  const [factory,bump] = PublicKey.findProgramAddressSync([new TextEncoder().encode("factory")],programs.factory);
  try {
    if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error(FACTORY_CREATION_ERROR);
    const info = await connection.getAccountInfo(factory,"finalized");
    if (!info || info.executable || !info.owner.equals(programs.factory) || info.data.length < 89 ||
        !FACTORY_CONFIG_DISCRIMINATOR.every((byte,index)=>info.data[index] === byte) || info.data[88] !== bump) {
      throw new Error(FACTORY_CREATION_ERROR);
    }
    const treasury = new PublicKey(info.data.subarray(40,72));
    if (treasury.toBase58() !== namespace.creation.treasury || treasury.equals(PublicKey.default) || retiredPublicKeys.has(treasury.toBase58()) ||
        info.data.readUInt16LE(72) !== 9000 || info.data.readUInt16LE(74) !== 300 || info.data.readUInt16LE(76) !== 100 || info.data.readUInt16LE(78) !== 300) throw new Error(FACTORY_CREATION_ERROR);
    return namespace;
  } catch {
    throw new Error(FACTORY_CREATION_ERROR);
  }
}

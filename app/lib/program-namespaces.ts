import { PublicKey } from "@solana/web3.js";
import {
  PROGRAM_NAMESPACES, CREATION_NAMESPACE_ID, DEVNET_GENESIS_HASH,
  creationNamespace, namespaceForFactory, validateNamespaceRegistry,
  type ProgramNamespace,
} from "../../backend/src/config/programNamespaces";

export { DEVNET_GENESIS_HASH };
export type { ProgramNamespace };
export const CREATION_DISABLED_MESSAGE = "New basket creation is blocked: no reviewed creation namespace is active.";

/** Source-controlled trust roots only. Isolated contexts are useful for namespace collision tests. */
export function createNamespaceRouting(entries: readonly ProgramNamespace[], selectedCreation: string | null = null) {
  const registry = validateNamespaceRegistry(entries);
  return Object.freeze({
    registry,
    forFactory(factory: string): ProgramNamespace {
      const namespace = namespaceForFactory(factory, registry);
      if (!namespace) throw new Error("This basket factory is not registered.");
      return namespace;
    },
    creation(): ProgramNamespace {
      const namespace = creationNamespace(registry, selectedCreation);
      if (!namespace) throw new Error(CREATION_DISABLED_MESSAGE);
      return namespace;
    },
  });
}
export type NamespaceRouting = ReturnType<typeof createNamespaceRouting>;
export const APP_NAMESPACE_ROUTING = createNamespaceRouting(PROGRAM_NAMESPACES, CREATION_NAMESPACE_ID);
export function namespacePrograms(namespace: ProgramNamespace) {
  return { whitelist: new PublicKey(namespace.programs.whitelist), factory: new PublicKey(namespace.programs.factory), basket: new PublicKey(namespace.programs.basket) };
}
export interface RoutedBasketKeys {
  basket: PublicKey; factory: PublicKey; shareMint: PublicKey;
}
/** Indexed fields may select a registered factory, never supply new program identities. */
export function requireBasketNamespace(keys: RoutedBasketKeys, routing = APP_NAMESPACE_ROUTING): ProgramNamespace {
  const namespace = routing.forFactory(keys.factory.toBase58());
  const [share] = PublicKey.findProgramAddressSync([new TextEncoder().encode("share_mint"), keys.basket.toBytes()], new PublicKey(namespace.programs.factory));
  if (!share.equals(keys.shareMint)) throw new Error("Basket share mint does not match its registered factory.");
  return namespace;
}

/** Reviewed devnet trust roots. Registration is source-controlled, never API/env supplied. */
import { PublicKey } from "@solana/web3.js";
import ownerPolicy from "./devnetOwnerPolicy.json" with { type: "json" };

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export type NamespaceRole = "whitelist" | "factory" | "basket";
export type ProgramNamespace = Readonly<{
  id: string;
  genesisHash: string;
  programs: Readonly<Record<NamespaceRole, string>>;
  factoryConfig: string;
  whitelistConfig: string;
  creation: Readonly<{ enabled: boolean; treasury: string | null }>;
}>;
const roles: NamespaceRole[] = ["whitelist", "factory", "basket"];
const canonicalKey = (value: string): string => {
  const key = new PublicKey(value);
  if (key.toBase58() !== value || key.equals(PublicKey.default)) throw new Error("Invalid namespace public key");
  return value;
};
const derive = (seed: string, program: string): string => PublicKey.findProgramAddressSync(
  [new TextEncoder().encode(seed)], new PublicKey(program),
)[0].toBase58();

/** Tests may construct an isolated reviewed registry; production always uses the frozen constant below. */
export function validateNamespaceRegistry(entries: readonly ProgramNamespace[]): readonly ProgramNamespace[] {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 2) throw new Error("One or two reviewed namespaces required");
  const identities = new Set<string>(), ids = new Set<string>();
  return Object.freeze(entries.map(entry => {
    if (!/^devnet-[a-z0-9-]{1,48}$/.test(entry.id) || ids.has(entry.id) || entry.genesisHash !== DEVNET_GENESIS_HASH) throw new Error("Invalid namespace identity");
    ids.add(entry.id);
    for (const role of roles) {
      const key = canonicalKey(entry.programs[role]);
      if (!PublicKey.isOnCurve(new PublicKey(key).toBytes()) || identities.has(key)) throw new Error("Namespace program identities must be distinct");
      identities.add(key);
    }
    if (entry.factoryConfig !== derive("factory",entry.programs.factory) ||
        entry.whitelistConfig !== derive("config",entry.programs.whitelist)) throw new Error("Namespace singleton binding mismatch");
    if (typeof entry.creation.enabled !== "boolean" ||
        (entry.creation.treasury !== null && canonicalKey(entry.creation.treasury) !== entry.creation.treasury) ||
        (entry.creation.enabled && entry.creation.treasury === null)) throw new Error("Creation requires a reviewed treasury");
    return Object.freeze({...entry,programs:Object.freeze({...entry.programs}),creation:Object.freeze({...entry.creation})});
  }));
}

export const PROGRAM_NAMESPACES = validateNamespaceRegistry([{
  id: "devnet-legacy-v1", genesisHash: DEVNET_GENESIS_HASH,
  programs: {
    whitelist: "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS",
    factory: "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF",
    basket: "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k",
  },
  factoryConfig: "CfxquMe4MAPksEEsVyw8XmcxYH5W7qftRWNySgHjLi6e",
  whitelistConfig: "ESRwG8qoKaLM17dLEM6MJDRpKVYtkd9M2zUmbud2uXZd",
  creation: {enabled:false,treasury:null},
}]);
/** Prepared actual identities; the active union only changes after finalized deployment evidence. */
export const DEVNET_OWNER_NAMESPACE: ProgramNamespace = validateNamespaceRegistry([{
  id: "devnet-owner-v1", genesisHash: DEVNET_GENESIS_HASH,
  programs: {whitelist:ownerPolicy.programIds.whitelist,factory:ownerPolicy.programIds.basket_factory,basket:ownerPolicy.programIds.basket},
  factoryConfig: derive("factory",ownerPolicy.programIds.basket_factory),
  whitelistConfig: derive("config",ownerPolicy.programIds.whitelist),
  creation: {enabled:false,treasury:ownerPolicy.treasury},
}])[0];
/** Only a separately reviewed source change may select an activated clean namespace. */
export const CREATION_NAMESPACE_ID: string | null = null;
export const namespaceProgramIds = (entry: ProgramNamespace): string[] => roles.map(role=>entry.programs[role]).sort();
export const registeredProgramIds = (entries: readonly ProgramNamespace[] = PROGRAM_NAMESPACES): string[] => entries.flatMap(namespaceProgramIds).sort();
export const namespaceForFactory = (factory: string, entries: readonly ProgramNamespace[] = PROGRAM_NAMESPACES): ProgramNamespace | undefined => entries.find(entry=>entry.factoryConfig===factory);
export function namespaceForProgram(program: string, entries: readonly ProgramNamespace[] = PROGRAM_NAMESPACES): {namespace:ProgramNamespace;role:NamespaceRole} | undefined {
  for (const namespace of entries) for (const role of roles) if (namespace.programs[role]===program) return {namespace,role};
  return undefined;
}
export function namespaceForPrograms(programs:{basket:{toBase58():string};factory:{toBase58():string};ids:readonly string[]}, entries:readonly ProgramNamespace[]=PROGRAM_NAMESPACES):ProgramNamespace|undefined {
  return entries.find(entry=>entry.programs.basket===programs.basket.toBase58() && entry.programs.factory===programs.factory.toBase58() &&
    JSON.stringify(namespaceProgramIds(entry))===JSON.stringify([...programs.ids].sort()));
}
export function creationNamespace(entries:readonly ProgramNamespace[]=PROGRAM_NAMESPACES,id:string|null=CREATION_NAMESPACE_ID):ProgramNamespace|undefined {
  return id===null ? undefined : entries.find(entry=>entry.id===id && entry.creation.enabled && entry.creation.treasury!==null);
}

/** Static trusted SQL relation for queries that cannot accept another parameter. */
export function namespaceSqlValues(entries:readonly ProgramNamespace[]=PROGRAM_NAMESPACES):string {
  return validateNamespaceRegistry(entries).map(entry=>`('${entry.factoryConfig}',ARRAY[${namespaceProgramIds(entry).map(key=>`'${key}'`).join(',')}]::text[])`).join(',');
}

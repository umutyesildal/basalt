/** Isolated reviewed synthetic trust roots. Never imported by application code. */
import { Keypair, PublicKey } from "@solana/web3.js";
import { DEVNET_GENESIS_HASH, namespaceForPrograms, namespaceProgramIds, validateNamespaceRegistry, type ProgramNamespace } from "../../src/config/programNamespaces";
import type { RecoveryPrograms } from "../../src/indexer/positionsSync";
const singleton=(seed:string,program:string)=>PublicKey.findProgramAddressSync([Buffer.from(seed)],new PublicKey(program))[0].toBase58();
function synthetic(seed:number,id:string):ProgramNamespace {
  const publicKey=(byte:number)=>Keypair.fromSeed(Buffer.alloc(32,byte)).publicKey.toBase58();
  const programs={whitelist:publicKey(seed),factory:publicKey(seed+1),basket:publicKey(seed+2)};
  return{id,genesisHash:DEVNET_GENESIS_HASH,programs,factoryConfig:singleton("factory",programs.factory),whitelistConfig:singleton("config",programs.whitelist),creation:{enabled:false,treasury:null}};
}
export const namespaceFixtures=validateNamespaceRegistry([synthetic(31,"devnet-fixture-a"),synthetic(34,"devnet-fixture-b")]);
export function namespaceRecoveryPrograms(index:number):RecoveryPrograms {
  const namespace=namespaceFixtures[index];if(!namespace)throw new Error("Unknown test namespace");
  return{basket:new PublicKey(namespace.programs.basket),factory:new PublicKey(namespace.programs.factory),ids:namespaceProgramIds(namespace)};
}
/** Explicit registry adapter for canonical recovery test programs. */
export function namespaceForRecoveryFixture(programs:RecoveryPrograms):ProgramNamespace {
  const known=namespaceForPrograms(programs,namespaceFixtures);if(known)return known;
  const whitelist=programs.ids.find(id=>id!==programs.basket.toBase58()&&id!==programs.factory.toBase58());
  if(!whitelist)throw new Error("Fixture requires three programs");
  const roles={whitelist,factory:programs.factory.toBase58(),basket:programs.basket.toBase58()};
  return validateNamespaceRegistry([{id:"devnet-recovery-fixture",genesisHash:DEVNET_GENESIS_HASH,programs:roles,factoryConfig:singleton("factory",roles.factory),whitelistConfig:singleton("config",roles.whitelist),creation:{enabled:false,treasury:null}}])[0];
}

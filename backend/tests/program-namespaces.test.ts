import {describe,it,expect} from "vitest";
import {PublicKey} from "@solana/web3.js";
import {PROGRAM_NAMESPACES,DEVNET_OWNER_NAMESPACE,CREATION_NAMESPACE_ID,creationNamespace,namespaceForFactory,namespaceForProgram,namespaceForPrograms,namespaceProgramIds,registeredProgramIds,validateNamespaceRegistry,namespaceSqlValues} from "../src/config/programNamespaces";
import {namespaceFixtures,namespaceRecoveryPrograms} from "./fixtures/program-namespaces";
import ownerPolicy from "../src/config/devnetOwnerPolicy.json";

describe("closed devnet namespace trust roots",()=>{
 it("registers exactly owner plus legacy, enabling only the selected owner with pinned treasury",()=>{
  expect(PROGRAM_NAMESPACES).toHaveLength(2);
  expect(CREATION_NAMESPACE_ID).toBe("devnet-owner-v1");
  expect(creationNamespace()).toEqual(DEVNET_OWNER_NAMESPACE);
  expect(DEVNET_OWNER_NAMESPACE.creation).toEqual({enabled:true,treasury:ownerPolicy.treasury});
  expect(PROGRAM_NAMESPACES[0].creation).toEqual({enabled:false,treasury:null});
  expect(creationNamespace(PROGRAM_NAMESPACES,PROGRAM_NAMESPACES[0].id)).toBeUndefined();
  expect(registeredProgramIds()).toHaveLength(6);
  expect(new Set(registeredProgramIds()).size).toBe(6);
  expect(creationNamespace([PROGRAM_NAMESPACES[0]],null)).toBeUndefined();
  expect(namespaceForFactory(PROGRAM_NAMESPACES[0].factoryConfig)?.id).toBe("devnet-legacy-v1");
  expect(Object.isFrozen(PROGRAM_NAMESPACES[0].programs)).toBe(true);
 });
 it("resolves factory and emitter roles without accepting a caller's unrelated ID",()=>{
  const [a,b]=namespaceFixtures;
  expect(namespaceForFactory(a.factoryConfig,namespaceFixtures)).toBe(a);
  expect(namespaceForProgram(b.programs.factory,namespaceFixtures)).toEqual({namespace:b,role:"factory"});
  expect(namespaceForFactory(b.programs.factory,namespaceFixtures)).toBeUndefined();
  expect(namespaceForProgram(PublicKey.default.toBase58(),namespaceFixtures)).toBeUndefined();
 });
 it("requires the exact role binding and complete trio, not any three registered emitters",()=>{
  const programs=namespaceRecoveryPrograms(0);
  expect(namespaceForPrograms(programs,namespaceFixtures)?.id).toBe(namespaceFixtures[0].id);
  expect(namespaceForPrograms({...programs,factory:new PublicKey(namespaceFixtures[1].programs.factory)},namespaceFixtures)).toBeUndefined();
  expect(namespaceForPrograms({...programs,ids:[...namespaceProgramIds(namespaceFixtures[0]).slice(0,2),namespaceFixtures[1].programs.whitelist]},namespaceFixtures)).toBeUndefined();
  expect(namespaceForPrograms({...programs,ids:[...programs.ids,programs.ids[0]]},namespaceFixtures)).toBeUndefined();
 });
 it("bounds discovery to the union of reviewed distinct trios",()=>{
  expect(registeredProgramIds(namespaceFixtures)).toHaveLength(6);
  expect(new Set(registeredProgramIds(namespaceFixtures)).size).toBe(6);
  expect(()=>validateNamespaceRegistry([])).toThrow();
  expect(()=>validateNamespaceRegistry([...namespaceFixtures,namespaceFixtures[0]])).toThrow();
 });
 it.each(["id","genesis","factory","whitelist","role","creation"])("rejects corrupted %s registration",kind=>{
  const a=structuredClone(namespaceFixtures[0]);
  if(kind==="id")a.id="bad'; SQL";
  if(kind==="genesis")a.genesisHash="mainnet";
  if(kind==="factory")a.factoryConfig=namespaceFixtures[1].factoryConfig;
  if(kind==="whitelist")a.whitelistConfig=namespaceFixtures[1].whitelistConfig;
  if(kind==="role")a.programs.factory=a.programs.basket;
  if(kind==="creation")a.creation.enabled=true;
  expect(()=>validateNamespaceRegistry([a])).toThrow();
 });
 it("rejects cross-namespace program reuse even with independently derived singletons",()=>{
  const a=structuredClone(namespaceFixtures[0]);a.id="devnet-other";
  expect(()=>validateNamespaceRegistry([namespaceFixtures[0],a])).toThrow();
 });
 it("requires an explicit selected and enabled clean namespace for creation",()=>{
  expect(creationNamespace(namespaceFixtures,namespaceFixtures[1].id)).toBeUndefined();
  const b={...namespaceFixtures[1],creation:{enabled:true,treasury:namespaceFixtures[0].factoryConfig}};
  const entries=validateNamespaceRegistry([namespaceFixtures[0],b]);
  expect(creationNamespace(entries,null)).toBeUndefined();
  expect(creationNamespace(entries,b.id)?.id).toBe(b.id);
 });
 it("validates source SQL bindings before interpolation",()=>{
  expect(namespaceSqlValues()).toContain(PROGRAM_NAMESPACES[0].factoryConfig);
  expect(()=>namespaceSqlValues([{...PROGRAM_NAMESPACES[0],factoryConfig:"' OR true --"}])).toThrow();
 });
});

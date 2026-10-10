import { describe, expect, it } from "vitest";
import { EventIndexer, indexerConfigFromEnv, type SolanaRpc } from "../src/indexer/listener";
import { PROGRAM_NAMESPACES, registeredProgramIds, namespaceProgramIds } from "../src/config/programNamespaces";
import { namespaceFixtures } from "./fixtures/program-namespaces";
import type { PgLike } from "../src/db/client";

const rpc:SolanaRpc={async getSignaturesForAddress(){return [];},async getParsedTransaction(){return null;},async getAccountInfo(){return null;}};
const database:PgLike={async query(){return {rows:[],rowCount:0};},async connect(){return {query:database.query.bind(database),release(){}};}};
const config={programIds:registeredProgramIds(namespaceFixtures),namespaces:namespaceFixtures,durableHistory:true,pollIntervalMs:1,signaturesPerPoll:10,maxSeenCache:10,transactionSpacingMs:0};

describe("closed durable namespace coordinator",()=>{
  it("rejects arbitrary durable programs without an explicitly injected test registry",()=>{
    expect(()=>new EventIndexer(rpc,{...config,namespaces:undefined},database)).toThrow(/registered namespace/);
  });
  it("requires complete matching roles and rejects partial or cross-namespace tuples",()=>{
    const a=namespaceFixtures[0],b=namespaceFixtures[1];
    for(const roles of [{basketProgramId:a.programs.basket},{whitelistProgramId:a.programs.whitelist,factoryProgramId:b.programs.factory,basketProgramId:a.programs.basket}]) {
      expect(()=>new EventIndexer(rpc,{...config,...roles},database)).toThrow(/complete registered namespace/);
    }
    expect(()=>new EventIndexer(rpc,{...config,programIds:[a.programs.basket]},database)).toThrow(/registered namespace/);
  });
  it("accepts an exact recovery trio but always discovers the entire registered union",()=>{
    const indexer=new EventIndexer(rpc,{...config,programIds:namespaceProgramIds(namespaceFixtures[0])},database);
    expect(indexer.readinessEvidence.programIds).toEqual(registeredProgramIds(namespaceFixtures));
  });
  it("validates injected registry collisions before constructing a poller",()=>{
    expect(()=>new EventIndexer(rpc,{...config,namespaces:[namespaceFixtures[0],namespaceFixtures[0]]},database)).toThrow(/identity/);
  });
  it("accepts either complete registered env trio while indexing six programs and preserving legacy creation disabled",()=>{
    for (const {programs:roles} of PROGRAM_NAMESPACES) {
      const cfg=indexerConfigFromEnv({RPC_URL:"http://127.0.0.1:8899",PROGRAM_WHITELIST:roles.whitelist,PROGRAM_FACTORY:roles.factory,PROGRAM_BASKET:roles.basket});
      expect(cfg?.programIds).toEqual(registeredProgramIds());expect(cfg?.programIds).toHaveLength(6);expect(cfg?.namespaces).toBe(PROGRAM_NAMESPACES);
    }
    expect(PROGRAM_NAMESPACES.filter(namespace=>namespace.creation.enabled).map(namespace=>namespace.id)).toEqual(["devnet-owner-v1"]);
    expect(PROGRAM_NAMESPACES[0].creation.enabled).toBe(false);
  });
});

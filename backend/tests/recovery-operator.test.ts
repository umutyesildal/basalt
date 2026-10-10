import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PublicKey, type Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgLike } from "../src/db/client";
import {
  DEVNET_GENESIS, RELEASE_PROGRAM_IDS, assertCandidateIdentity, candidateProgramSet, candidateRpc, loadCandidateContext, openCandidateDatabase,
  parseOperatorArgs, runRecoveryOperator, validateCandidateManifest,
  type CandidateContext, type CandidateDatabase, type CandidateManifest, type OperatorDependencies,
} from "../src/maintenance/recovery-operator";
import { parseReplayArgs } from "../src/maintenance/replay-indexer";
import { namespaceFixtures } from "./fixtures/program-namespaces";
import { registeredProgramIds } from "../src/config/programNamespaces";

const key = (byte: number) => new PublicKey(Buffer.alloc(32,byte)).toBase58();
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const manifest: CandidateManifest = {
  schemaVersion:1,candidateId:"test",databaseName:"basalt_candidate_test",sourceDatabase:"foliox",
  sourceSha:"a".repeat(40),backupSha256:"b".repeat(64),genesisHash:DEVNET_GENESIS,
  programIds:{...RELEASE_PROGRAM_IDS},
  snapshotAt:"2026-10-09T13:00:00.000Z",backupFile:"foliox.dump",
};
const env = { CANDIDATE_DATABASE_URL:"postgresql://basalt_candidate_test@localhost/basalt_candidate_test",
  RELEASE_SOURCE_SHA:manifest.sourceSha,RPC_URL:"https://candidate.invalid",DATABASE_URL:"postgresql://root@live.invalid/foliox" };
let directory: string, manifestPath: string, outputPath: string;
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),"basalt-recovery-operator-"));
  manifestPath=join(directory,"candidate.json");outputPath=join(directory,"review.json");
  await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600});
});
afterEach(async()=>{vi.restoreAllMocks();await rm(directory,{recursive:true,force:true});});

function fakeDatabase() {
  const calls: {sql:string;values?:unknown[]}[]=[];
  const row = {run_id:"reviewed-run",basket:key(20),history_hash:"c".repeat(64),
    program_ids:Object.values(manifest.programIds),chain_slot:"100",chain_supply:"1000000",event_count:2,
    created_at:new Date("2026-10-09T13:01:00.000Z"),status:"staged-pending-review"};
  const state = {
    databaseName:manifest.databaseName,roleName:manifest.databaseName,identityRows:1,schemaReady:true,
    identity:{candidate_id:manifest.candidateId,database_name:manifest.databaseName,source_database:manifest.sourceDatabase,
      source_sha:manifest.sourceSha,backup_sha256:manifest.backupSha256,genesis_hash:manifest.genesisHash,program_ids:{...manifest.programIds}},
    row,
    positions:[{user:key(21),basket:row.basket,shares:"1000000",cost_basis:null,cost_basis_source:null}],
    claims:[{sig:bs58.encode(Buffer.alloc(64,7)),log_index:2,kind:"Minted",basket:row.basket}],
    closed:0,
  };
  const db: CandidateDatabase = {
    query:async(sql,values)=>{
      calls.push({sql,values});
      let rows: Record<string,unknown>[]=[];
      if (sql.startsWith("SELECT current_database")) rows=[{database_name:state.databaseName,role_name:state.roleName}];
      else if (sql.includes("FROM public.release_candidate_identity")) rows=Array.from({length:state.identityRows},()=>state.identity);
      else if (sql.includes("to_regclass")) rows=(values![0] as string[]).map(name=>({name,table_name:state.schemaReady?name:null}));
      else if (sql.includes("FROM public.position_rebuild_runs") || sql.includes("FROM position_rebuild_runs")) rows=[state.row];
      else if (sql.includes("FROM position_rebuild_staging")) rows=state.positions;
      else if (sql.includes("FROM position_rebuild_claims")) rows=state.claims;
      else if (sql.includes("FROM public.indexer_program_state") || sql.includes("FROM public.indexer_signature_queue")) rows=[];
      else if (!["BEGIN","COMMIT","ROLLBACK","SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"].includes(sql)) throw new Error("Unexpected SQL: "+sql);
      return {rows,rowCount:rows.length,command:"SELECT",oid:0,fields:[]};
    },
    connect:async()=>({query:(sql,values)=>db.query(sql,values),release:()=>{}}),
    end:async()=>{state.closed++;},
  };
  return {db,state,calls};
}
function dependencies(db: CandidateDatabase) {
  const genesis=vi.fn(async()=>DEVNET_GENESIS);
  const rpc={getGenesisHash:genesis} as unknown as Connection;
  const replay=vi.fn(async()=>{});
  const published=vi.fn();
  const activate=vi.fn(async(database,rpc,runId,historyHash,programs,options)=>{
    await options.validateReviewedEvidence(database);
    await options.catchUpThroughSlot(100);
    published();
    return {runId,basket:key(20),historyHash,finalizedSlot:"100",activatedAt:"2026-10-09T13:02:00.000Z"};
  });
  return {connect:vi.fn(async()=>db),rpc:vi.fn(()=>rpc),activate,replay,genesis,published,now:()=>new Date("2026-10-09T13:01:01.000Z")};
}
const inspectArgs=()=>["--manifest="+manifestPath];
const exportArgs=()=>["export","--manifest="+manifestPath,"--run-id=reviewed-run","--output="+outputPath];
async function reviewFile(deps: OperatorDependencies) {
  const result=await runRecoveryOperator(exportArgs(),env,deps) as {approvalSha256:string};
  return {result,args:["activate","--manifest="+manifestPath,"--review="+outputPath,"--approve-sha256="+result.approvalSha256,"--max-polls=3"]};
}
function assertReadOnly(calls: {sql:string}[]) {
  expect(calls.some(({sql})=>/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(sql))).toBe(false);
}
describe("candidate-only recovery operator",()=>{
  it("binds a future registered complete trio without accepting arbitrary or cross-namespace roles",()=>{
    const a=namespaceFixtures[0],b=namespaceFixtures[1];
    expect(validateCandidateManifest({...manifest,programIds:{...b.programs}},namespaceFixtures).programIds).toEqual(b.programs);
    const proof = candidateProgramSet({programIds:{...b.programs}},namespaceFixtures);
    expect(proof.ids).toEqual(Object.values(b.programs).sort());expect(proof.ids).toHaveLength(3);
    expect(proof.ids.some(id=>Object.values(a.programs).includes(id))).toBe(false);
    expect(proof.basket.toBase58()).toBe(b.programs.basket);
    expect(()=>candidateProgramSet({programIds:{...b.programs,factory:a.programs.factory}},namespaceFixtures)).toThrow(/registered devnet namespace/);
    expect(()=>validateCandidateManifest({...manifest,programIds:{...b.programs,factory:a.programs.factory}},namespaceFixtures)).toThrow(/registered devnet namespace/);
    expect(()=>validateCandidateManifest({...manifest,programIds:{...b.programs}})).toThrow(/registered devnet namespace/);
  });

  it("defaults to bounded read-only inspect, does not use application DATABASE_URL or RPC",async()=>{
    const {db,calls,state}=fakeDatabase();const deps=dependencies(db);
    const result = await runRecoveryOperator(inspectArgs(),env,deps);
    expect(result).toMatchObject({schemaReady:true,activeProjectionChanged:false,collectionPrograms:registeredProgramIds()});
    expect(registeredProgramIds()).toHaveLength(6);
    expect(candidateProgramSet(manifest).ids).toHaveLength(3);
    for (const {sql,values} of calls.filter(({sql})=>sql.includes("FROM public.indexer_program_state") || sql.includes("FROM public.indexer_signature_queue"))) {
      expect(values?.[0]).toEqual(registeredProgramIds());
    }
    expect(deps.connect.mock.calls[0][0].databaseUrl).toBe(env.CANDIDATE_DATABASE_URL);
    expect(deps.rpc).not.toHaveBeenCalled();expect(deps.activate).not.toHaveBeenCalled();
    expect(calls.some(({sql})=>sql.includes("REPEATABLE READ, READ ONLY"))).toBe(true);
    expect(calls.some(({sql})=>sql.includes("LIMIT 20"))).toBe(true);assertReadOnly(calls);expect(state.closed).toBe(1);
  });
  it("rejects evidence symlinks before opening a database",async()=>{
    const link=join(directory,"candidate-link.json");await symlink(manifestPath,link);
    const {db}=fakeDatabase(),deps=dependencies(db);
    await expect(runRecoveryOperator(["--manifest="+link],env,deps)).rejects.toThrow();
    expect(deps.connect).not.toHaveBeenCalled();
  });
  it("rejects a FIFO without blocking for a writer",async()=>{
    const fifo=join(directory,"candidate-pipe");expect(spawnSync("mkfifo",[fifo]).status).toBe(0);
    const {db}=fakeDatabase(),deps=dependencies(db);
    await expect(runRecoveryOperator(["--manifest="+fifo],env,deps)).rejects.toThrow("size/type");
    expect(deps.connect).not.toHaveBeenCalled();
  });
  it("reports an unmigrated candidate without creating schema",async()=>{
    const {db,state,calls}=fakeDatabase();state.schemaReady=false;
    expect(await runRecoveryOperator(inspectArgs(),env,dependencies(db))).toMatchObject({schemaReady:false});
    assertReadOnly(calls);
  });
  it.each([
    ["live database", {databaseName:"foliox"}],["mainnet genesis",{genesisHash:"mainnet"}],
    ["missing version",{schemaVersion:undefined}],["unreviewed field",{password:"never accepted"}],
    ["invalid source",{sourceSha:"short"}],["invalid backup",{backupSha256:"short"}],
    ["path traversal",{backupFile:"../foliox.dump"}],["invalid timestamp",{snapshotAt:"yesterday"}],
    ["duplicate roles",{programIds:{...manifest.programIds,basket:manifest.programIds.factory}}],
    ["different namespace",{programIds:{basket:key(250),factory:key(249),whitelist:key(248)}}],
    ["different candidate suffix",{candidateId:"another"}],
  ])("rejects %s in manifest before opening a database",async(_,change)=>{
    await writeFile(manifestPath,JSON.stringify({...manifest,...change}));
    const {db}=fakeDatabase(),deps=dependencies(db);
    await expect(runRecoveryOperator(inspectArgs(),env,deps)).rejects.toThrow();
    expect(deps.connect).not.toHaveBeenCalled();
  });
  it.each([
    ["no dedicated URL",{CANDIDATE_DATABASE_URL:undefined}],["wrong source",{RELEASE_SOURCE_SHA:"d".repeat(40)}],
    ["live URL",{CANDIDATE_DATABASE_URL:"postgres://basalt@localhost/foliox"}],
    ["admin role",{CANDIDATE_DATABASE_URL:"postgres://basalt@localhost/basalt_candidate_test"}],
    ["search path injection",{CANDIDATE_DATABASE_URL:env.CANDIDATE_DATABASE_URL+"?options=-c%20search_path=other"}],
  ])("rejects %s before opening a database",async(_,change)=>{
    const {db}=fakeDatabase(),deps=dependencies(db);
    await expect(runRecoveryOperator(inspectArgs(),{...env,...change},deps)).rejects.toThrow();
    expect(deps.connect).not.toHaveBeenCalled();
  });
  it.each(["databaseName","roleName","source_sha","backup_sha256","candidate_id","genesis_hash","program_ids","identityRows"])("rejects mismatched connected identity %s",async field=>{
    const {db,state,calls}=fakeDatabase();
    if(field==="identityRows")state.identityRows=2;
    else if(field==="databaseName"||field==="roleName")state[field]="foliox";
    else (state.identity as Record<string,unknown>)[field]="different";
    const deps=dependencies(db);
    await expect(runRecoveryOperator(inspectArgs(),env,deps)).rejects.toThrow();
    expect(deps.activate).not.toHaveBeenCalled();assertReadOnly(calls);expect(state.closed).toBe(1);
  });
  it("exports exact immutable run and staged commitments into a new private file",async()=>{
    const {db,calls}=fakeDatabase(),deps=dependencies(db);
    const {result}=await reviewFile(deps);
    const bytes=await readFile(outputPath),review=JSON.parse(bytes.toString());
    expect(result.approvalSha256).toBe(sha(bytes));
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
    expect(review).toMatchObject({manifestSha256:sha(await readFile(manifestPath)),manifest,
      run:{runId:"reviewed-run",historyHash:"c".repeat(64),chainSlot:"100"},staging:{positionCount:1,claimCount:1}});
    expect(bytes.toString()).not.toContain(env.CANDIDATE_DATABASE_URL);
    expect(bytes.toString()).not.toContain(env.DATABASE_URL);assertReadOnly(calls);
    await expect(runRecoveryOperator(exportArgs(),env,deps)).rejects.toMatchObject({code:"EEXIST"});
  });
  it("calls only the existing atomic API with reviewed run/hash/programs and bounded catch-up",async()=>{
    const {db}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    const result=await runRecoveryOperator(args,env,deps);
    expect(result).toMatchObject({candidateId:manifest.candidateId,sourceSha:manifest.sourceSha,backupSha256:manifest.backupSha256,activeProjectionChanged:true});
    expect(deps.genesis).toHaveBeenCalledTimes(1);expect(deps.published).toHaveBeenCalledTimes(1);
    expect(deps.activate.mock.calls[0].slice(2,4)).toEqual(["reviewed-run","c".repeat(64)]);
    expect(deps.activate.mock.calls[0][4].ids).toEqual(Object.values(manifest.programIds).sort());
    expect(deps.replay.mock.calls[0][2]).toEqual(registeredProgramIds());
    expect(deps.replay.mock.calls[0][3]).toEqual({remaining:3,polls:0});
    expect(deps.replay.mock.calls[0][4]).toBe(100);
  });
  it("rejects wrong raw review-file approval before any RPC or activation",async()=>{
    const {db}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    args[3]="--approve-sha256="+"0".repeat(64);
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("SHA256");
    expect(deps.rpc).not.toHaveBeenCalled();expect(deps.activate).not.toHaveBeenCalled();
  });
  it("rejects a review artifact for another candidate even when its new file digest is approved",async()=>{
    const {db}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    const review=JSON.parse(await readFile(outputPath,"utf8"));review.manifest.backupSha256="e".repeat(64);
    const bytes=JSON.stringify(review);await writeFile(outputPath,bytes);args[3]="--approve-sha256="+sha(bytes);
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("another candidate");
    expect(deps.activate).not.toHaveBeenCalled();
  });
  it("rejects staged evidence changed after export without calling activation",async()=>{
    const {db,state}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    state.positions[0].shares="999999";
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("evidence changed");
    expect(deps.activate).not.toHaveBeenCalled();
  });
  it("rechecks exact review in the activation transaction and rejects a race before effects",async()=>{
    const {db,state}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    deps.activate.mockImplementationOnce(async(database,rpc,runId,hash,programs,options)=>{
      state.positions[0].shares="999999";
      await options.validateReviewedEvidence(database);
      deps.published();throw new Error("must not publish");
    });
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("evidence changed");
    expect(deps.published).not.toHaveBeenCalled();
  });
  it("rechecks the candidate identity inside the atomic callback",async()=>{
    const {db,state}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    deps.activate.mockImplementationOnce(async(database,rpc,runId,hash,programs,options)=>{
      state.identity.backup_sha256="f".repeat(64);await options.validateReviewedEvidence(database);
      deps.published();throw new Error("must not publish");
    });
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("identity");
    expect(deps.published).not.toHaveBeenCalled();
  });
  it("rejects non-devnet RPC before activation",async()=>{
    const {db}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    deps.genesis.mockResolvedValueOnce("mainnet");
    await expect(runRecoveryOperator(args,env,deps)).rejects.toThrow("devnet genesis");
    expect(deps.activate).not.toHaveBeenCalled();
  });
  it("an activated exact retry requires no genesis network call",async()=>{
    const {db,state}=fakeDatabase(),deps=dependencies(db);const {args}=await reviewFile(deps);
    state.row.status="activated";await runRecoveryOperator(args,env,deps);
    expect(deps.genesis).not.toHaveBeenCalled();expect(deps.activate).toHaveBeenCalledTimes(1);
  });
  it.each([
    [],["activate","--manifest=/x"],["--manifest=relative"],["--manifest=/x","--manifest=/y"],
    ["--manifest=/x","--max-polls=1"],["activate","--manifest=/x","--review=/y","--approve-sha256="+sha("x"),"--max-polls=101"],
    ["--manifest=/x","--timeout-seconds=301"],["--manifest=/x","--timeout-seconds=1e2"],["--manifest=/x","--execute=true"],
  ])("rejects incomplete, ambiguous or unbounded args %j",args=>{expect(()=>parseOperatorArgs([...args])).toThrow();});
  it("guards standalone replay before any schema connection and bounds its options",async()=>{
    expect(()=>parseReplayArgs(["--max-polls=100"])).toThrow("manifest");
    expect(()=>parseReplayArgs(["--manifest=/x","--max-polls=10001"])).toThrow("budget");
    expect(()=>parseReplayArgs(["--manifest=/x","--timeout-seconds=1e2"])).toThrow("Integer");
    expect(()=>parseReplayArgs(["--manifest=/x","--manifest=/y"])).toThrow("duplicate");
    expect(()=>parseReplayArgs(["--manifest=/x","--stage-basket=bad"])).toThrow("Canonical");
    expect(parseReplayArgs(["--manifest=/x","--max-polls=100","--stage-basket="+key(1)])).toMatchObject({maxPolls:100,timeoutSeconds:300});
  });
  it("refuses driver work after a command deadline and still permits rollback",async()=>{
    const context=await loadCandidateContext(manifestPath,env);
    const controller=new AbortController();controller.abort();
    const database=openCandidateDatabase(context,controller.signal);
    await expect(database.query("SELECT 1")).rejects.toThrow();
    await expect(database.connect!()).rejects.toThrow();await database.end();
  });
  it("RPC adapter uses the operator deadline and per-request abort without network",async()=>{
    const controller=new AbortController();
    const mock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,init)=>new Response(JSON.stringify({jsonrpc:"2.0",id:JSON.parse(String(init?.body)).id,result:DEVNET_GENESIS}),{headers:{"content-type":"application/json"}}));
    const rpc=candidateRpc("https://candidate.invalid",controller.signal);
    await expect(rpc.getGenesisHash()).resolves.toBe(DEVNET_GENESIS);
    expect(mock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    controller.abort();await expect(rpc.getGenesisHash()).rejects.toThrow();expect(mock).toHaveBeenCalledTimes(1);
  });
});

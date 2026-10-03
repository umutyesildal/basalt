import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { attestDeployment, DEPLOYMENT_PROGRAMS, DEPLOYMENT_RPC, EXPECTED_AUTHORITY, EXPECTED_GENESIS, LOADER, programDataAddress, validateSbfElf, verifyProgramBytes } from "../../scripts/verifyXStocksDeployment";
function elf() {
  const b=Buffer.alloc(192); Buffer.from([127,69,76,70,2,1,1]).copy(b); b.writeUInt16LE(3,16); b.writeUInt16LE(263,18); b.writeUInt32LE(1,20);
  b.writeBigUInt64LE(0x100000080n,24); b.writeBigUInt64LE(64n,32); b.writeUInt16LE(64,52); b.writeUInt16LE(56,54); b.writeUInt16LE(1,56);
  b.writeUInt32LE(1,64); b.writeUInt32LE(5,68); b.writeBigUInt64LE(128n,72); b.writeBigUInt64LE(0x100000080n,80); b.writeBigUInt64LE(64n,96); b.writeBigUInt64LE(64n,104); b[128]=149; return b;
}
function programData() { const b=Buffer.alloc(45+192+16); b.writeUInt32LE(3); b.writeBigUInt64LE(100n,4); b[12]=1; new PublicKey(EXPECTED_AUTHORITY).toBuffer().copy(b,13); elf().copy(b,45); return b; }
function account(data: Buffer, owner=LOADER, executable=false) { return { owner, executable, data:[data.toString("base64"),"base64"] }; }
function batch() {
  const programs=Object.values(DEPLOYMENT_PROGRAMS).map(id => { const b=Buffer.alloc(36); b.writeUInt32LE(2); new PublicKey(programDataAddress(id)).toBuffer().copy(b,4); return account(b,LOADER,true); });
  const config=Buffer.alloc(78); createHash("sha256").update("account:WhitelistConfig").digest().copy(config,0,0,8); new PublicKey(EXPECTED_AUTHORITY).toBuffer().copy(config,8);
  return { context:{slot:101}, value:[...programs,...programs.map(()=>account(programData())),account(config,DEPLOYMENT_PROGRAMS.whitelist)] };
}
let root:string;
beforeAll(async()=>{
  root=await mkdtemp(join(tmpdir(),"basalt-attestation-test-"));
  for(const path of ["target/deploy",...Object.keys(DEPLOYMENT_PROGRAMS).map(n=>`programs/${n}/src`),"crates/token-policy/src"]) await mkdir(join(root,path),{recursive:true});
  for(const path of ["Cargo.toml","Cargo.lock","Anchor.toml",...Object.keys(DEPLOYMENT_PROGRAMS).flatMap(n=>[`programs/${n}/Cargo.toml`,`programs/${n}/src/lib.rs`]),"crates/token-policy/Cargo.toml","crates/token-policy/src/lib.rs"]) await writeFile(join(root,path),"// synthetic fixture\n");
  for(const name of Object.keys(DEPLOYMENT_PROGRAMS)) await writeFile(join(root,`target/deploy/${name}.so`),elf());
  execFileSync("git",["init","-q"],{cwd:root}); execFileSync("git",["-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","--allow-empty","-qm","fixture"],{cwd:root});
});
afterAll(async()=>{if(root)await rm(root,{recursive:true,force:true});});
function rpcFixture(options:{genesis?:string;mutate?:(b:ReturnType<typeof batch>)=>void;afterRead?:()=>Promise<void>}={}) {
  return vi.fn(async(url:any,init:any)=>{
    expect(url).toBe(DEPLOYMENT_RPC); expect(init.method).toBe("POST"); expect(init.redirect).toBe("error"); const request=JSON.parse(init.body); let result:any;
    if(request.method==="getGenesisHash")result=options.genesis??EXPECTED_GENESIS;
    else { expect(request.method).toBe("getMultipleAccounts"); expect(request.params[1]).toEqual({commitment:"finalized",encoding:"base64"}); expect(request.params[0]).toHaveLength(7); result=batch(); options.mutate?.(result); await options.afterRead?.(); }
    return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result}),{status:200});
  });
}
describe("read-only deployed executable byte attestation",()=>{
  it("requires an executable ELF entrypoint, including the observed CPI-only failure mode",()=>{
    expect(validateSbfElf(elf())).toMatchObject({machine:263,bytes:192,entrypoint:"0x100000080"});
    const cpi=elf(); cpi.writeBigUInt64LE(0n,24); expect(()=>validateSbfElf(cpi)).toThrow("CPI-only");
    const off=elf(); off.writeBigUInt64LE(0x1000000c0n,24); expect(()=>validateSbfElf(off)).toThrow("outside executable");
    const noexec=elf(); noexec.writeUInt32LE(4,68); expect(()=>validateSbfElf(noexec)).toThrow("outside executable");
    expect(()=>validateSbfElf(elf().subarray(0,191))).toThrow("exceeds its file");
  });
  it("uses offset45 and rejects changed bytes, short data, and nonzero trailing capacity",()=>{
    const artifact=elf(),match=verifyProgramBytes(programData(),artifact); expect(match).toMatchObject({deployedSlot:"100",executableOffset:45,matchedPrefixBytes:192,trailingPaddingBytes:16,trailingPaddingAllZero:true});
    expect(match.storedPrefixSha256).toBe(createHash("sha256").update(artifact).digest("hex"));
    const changed=programData(); changed[173]^=1; expect(()=>verifyProgramBytes(changed,artifact)).toThrow("differ");
    const suffix=programData(); suffix[suffix.length-1]=1; expect(()=>verifyProgramBytes(suffix,artifact)).toThrow("nonzero");
    expect(()=>verifyProgramBytes(programData().subarray(0,100),artifact)).toThrow("shorter");
  });
  it("rejects wrong loader state, malformed authority option and unexpected authority",()=>{
    const data=programData(); data[0]=2; expect(()=>verifyProgramBytes(data,elf())).toThrow("tag 3"); data[0]=3; data[12]=2; expect(()=>verifyProgramBytes(data,elf())).toThrow("option");
    data[12]=0; expect(()=>verifyProgramBytes(data,elf())).toThrow("authority"); data[12]=1; data[13]^=1; expect(()=>verifyProgramBytes(data,elf())).toThrow("authority");
  });
  it("attests three exact IDs in one finalized batch and records a bounded source-manifest claim",async()=>{
    const fetchImpl=rpcFixture(),result=await attestDeployment({root,fetchImpl,now:()=>new Date("2026-10-03T01:00:00Z")});
    expect(fetchImpl).toHaveBeenCalledTimes(2); expect(result).toMatchObject({commitment:"finalized",genesisHash:EXPECTED_GENESIS,byteMatch:true,finalizedSlot:101});
    expect(result.programs.map(p=>p.programId)).toEqual(Object.values(DEPLOYMENT_PROGRAMS)); expect(result.programs.every(p=>p.artifact.sha256===p.storedPrefixSha256)).toBe(true);
    expect(result.checkout.sourceFiles).toHaveLength(11); expect(result.checkout.dirty).toBe(true); expect(result.claim).toContain("do not prove reproducible source-to-binary");
  });
  it("stops before account reads on a wrong genesis",async()=>{
    const fetchImpl=rpcFixture({genesis:"mainnet"}); await expect(attestDeployment({root,fetchImpl})).rejects.toThrow("not Solana devnet"); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["wrong program owner",(b:ReturnType<typeof batch>)=>{b.value[0].owner=EXPECTED_AUTHORITY;},"wrong owner"],
    ["wrong ProgramData PDA",(b:ReturnType<typeof batch>)=>{const d=Buffer.from(b.value[0].data[0],"base64");d[4]^=1;b.value[0].data[0]=d.toString("base64");},"PDA"],
    ["nonfinalized deployment",(b:ReturnType<typeof batch>)=>{b.context.slot=99;},"newer than finalized"],
    ["pending authority",(b:ReturnType<typeof batch>)=>{const d=Buffer.from(b.value[6].data[0],"base64");d[40]=1;new PublicKey(EXPECTED_AUTHORITY).toBuffer().copy(d,41);b.value[6].data[0]=d.toString("base64");},"pending authority"],
  ] as const)("rejects %s",async(_label,mutate,message)=>{await expect(attestDeployment({root,fetchImpl:rpcFixture({mutate})})).rejects.toThrow(message);});
  it("fails if a concurrent build changes a local artifact during observation",async()=>{
    const path=join(root,"target/deploy/whitelist.so"); try{await expect(attestDeployment({root,fetchImpl:rpcFixture({afterRead:async()=>{const bytes=elf();bytes[129]=1;await writeFile(path,bytes);}})})).rejects.toThrow("artifact changed");}finally{await writeFile(path,elf());}
  });
  it("rejects a local CPI-only artifact before any network call",async()=>{
    const path=join(root,"target/deploy/basket.so"),bytes=elf(),fetchImpl=rpcFixture();bytes.writeBigUInt64LE(0n,24);await writeFile(path,bytes);
    try{await expect(attestDeployment({root,fetchImpl})).rejects.toThrow("CPI-only");expect(fetchImpl).not.toHaveBeenCalled();}finally{await writeFile(path,elf());}
  });
});

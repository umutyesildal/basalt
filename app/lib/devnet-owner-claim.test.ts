import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, SystemProgram, type AccountInfo } from "@solana/web3.js";
import { sendWithReviewedIntent } from "./wallet-intent";
import { createNamespaceRouting, DEVNET_GENESIS_HASH } from "./program-namespaces";
import { DEVNET_OWNER_CLAIM_POLICY as policy, UPGRADEABLE_LOADER, inspectDevnetOwnerClaim, prepareDevnetOwnerClaim, type OwnerClaimRpc, createDevnetOwnerClaimReview, type OwnerClaimIntent } from "./devnet-owner-claim";

const program = new PublicKey(policy.programs.whitelist);
const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()], UPGRADEABLE_LOADER);
const [config, bump] = PublicKey.findProgramAddressSync([Buffer.from("config")], program);
const routing = createNamespaceRouting([{
  id: policy.namespaceId, genesisHash: DEVNET_GENESIS_HASH, programs: policy.programs,
  factoryConfig: PublicKey.findProgramAddressSync([Buffer.from("factory")], new PublicKey(policy.programs.factory))[0].toBase58(),
  whitelistConfig: config.toBase58(), creation: { enabled: false, treasury: null },
}]);
const account = (owner: PublicKey, data: Buffer, executable = false): AccountInfo<Buffer> => ({owner,data,executable,lamports:1,rentEpoch:0});
function fixture(status: "waiting" | "ready" | "claimed" = "ready") {
  const programBytes = Buffer.alloc(36); programBytes.writeUInt32LE(2); programData.toBuffer().copy(programBytes, 4);
  const loaderBytes = Buffer.alloc(64); loaderBytes.writeUInt32LE(3); loaderBytes.writeBigUInt64LE(99n, 4); loaderBytes[12] = 1;
  new PublicKey(policy.bootstrapAuthority).toBuffer().copy(loaderBytes, 13);
  const configBytes = Buffer.alloc(78); Buffer.from("3a330ca6266d12ff", "hex").copy(configBytes);
  new PublicKey(status === "claimed" ? policy.owner : policy.bootstrapAuthority).toBuffer().copy(configBytes, 8);
  const option = status === "ready" ? 1 : 0; configBytes[40] = option;
  if (option) new PublicKey(policy.owner).toBuffer().copy(configBytes, 41);
  const countOffset = option ? 73 : 41; configBytes.writeUInt32LE(4, countOffset); configBytes[countOffset + 4] = bump;
  const accounts: (AccountInfo<Buffer> | null)[] = [account(UPGRADEABLE_LOADER, programBytes, true), account(UPGRADEABLE_LOADER, loaderBytes), account(program, configBytes)];
  let reads = 0, genesis = DEVNET_GENESIS_HASH, slot = 100;
  const rpc = {
    getGenesisHash: async () => { reads++; return genesis; },
    getMultipleAccountsInfoAndContext: async (keys: PublicKey[], options: unknown) => {
      reads++; assert.deepEqual(keys.map(String), [program,programData,config].map(String));
      assert.deepEqual(options, {commitment:"finalized",minContextSlot:90});
      return {context:{slot},value:accounts};
    },
  } as unknown as OwnerClaimRpc;
  return {rpc, accounts, programBytes, loaderBytes, configBytes, reads:()=>reads, setGenesis:(value:string)=>{genesis=value;}, setSlot:(value:number)=>{slot=value;}};
}
const inspect = (f: ReturnType<typeof fixture>) => inspectDevnetOwnerClaim(f.rpc, routing, 90);

test("only the pinned owner can prepare the exact two-account whitelist claim", async () => {
  const f = fixture();
  const {state,instructions} = await prepareDevnetOwnerClaim(f.rpc, new PublicKey(policy.owner), routing, 90);
  assert.equal(state.status,"ready"); assert.equal(state.contextSlot,100); assert.equal(state.mintCount,4);
  assert.equal(instructions.length,1); const ix=instructions[0];
  assert.equal(ix.programId.toBase58(),policy.programs.whitelist);
  assert.equal(ix.data.toString("hex"),"de84b97b7f6b061f");
  assert.deepEqual(ix.keys,[{pubkey:config,isWritable:true,isSigner:false},{pubkey:new PublicKey(policy.owner),isWritable:false,isSigner:true}]);
  assert.throws(()=>routing.creation(),/no reviewed creation namespace/);
});

test("wrong wallet fails before RPC, even with an otherwise valid handoff", async () => {
  const f=fixture();
  await assert.rejects(prepareDevnetOwnerClaim(f.rpc,new PublicKey(policy.bootstrapAuthority),routing,90),/designated owner wallet/);
  assert.equal(f.reads(),0);
});

test("completed owner acceptance is authenticated success with no signing instruction", async () => {
  for (const loaderAuthority of [policy.bootstrapAuthority,policy.owner]) {
    const f=fixture("claimed"); new PublicKey(loaderAuthority).toBuffer().copy(f.loaderBytes,13);
    const result=await prepareDevnetOwnerClaim(f.rpc,new PublicKey(policy.owner),routing,90);
    assert.equal(result.state.status,"claimed"); assert.equal(result.state.loaderAuthority,loaderAuthority);
    assert.deepEqual(result.instructions,[]);
  }
});

test("missing pending handoff stays informational and cannot prepare a claim", async () => {
  const f=fixture("waiting"); assert.equal((await inspect(f)).status,"waiting");
  await assert.rejects(prepareDevnetOwnerClaim(f.rpc,new PublicKey(policy.owner),routing,90),/not proposed/);
});

test("wrong cluster, stale context and future ProgramData cannot become a ready claim", async () => {
  const f=fixture(); f.setGenesis("mainnet"); await assert.rejects(inspect(f),/devnet only/); assert.equal(f.reads(),1);
  for (const mutate of [(f:ReturnType<typeof fixture>)=>f.setSlot(89),(f:ReturnType<typeof fixture>)=>f.setSlot(NaN),(f:ReturnType<typeof fixture>)=>f.loaderBytes.writeBigUInt64LE(101n,4)]) {
    const next=fixture(); mutate(next); await assert.rejects(inspect(next),/reviewed setup/);
  }
});

const tamper: Record<string,(f:ReturnType<typeof fixture>)=>void> = {
  "missing program": f=>{f.accounts[0]=null;},
  "nonexecutable program": f=>{f.accounts[0]!.executable=false;},
  "wrong loader owner": f=>{f.accounts[0]!.owner=SystemProgram.programId;},
  "wrong program tag": f=>{f.programBytes.writeUInt32LE(3);},
  "noncanonical loader pointer": f=>{f.programBytes[4]^=1;},
  "truncated program": f=>{f.accounts[0]!.data=f.programBytes.subarray(0,35);},
  "missing ProgramData": f=>{f.accounts[1]=null;},
  "wrong ProgramData owner": f=>{f.accounts[1]!.owner=program;},
  "executable ProgramData": f=>{f.accounts[1]!.executable=true;},
  "wrong ProgramData tag": f=>{f.loaderBytes.writeUInt32LE(2);},
  "truncated ProgramData": f=>{f.accounts[1]!.data=f.loaderBytes.subarray(0,44);},
  "immutable loader": f=>{f.loaderBytes[12]=0;},
  "malformed loader option": f=>{f.loaderBytes[12]=2;},
  "unknown upgrade authority": f=>{program.toBuffer().copy(f.loaderBytes,13);},
  "missing config": f=>{f.accounts[2]=null;},
  "wrong config owner": f=>{f.accounts[2]!.owner=UPGRADEABLE_LOADER;},
  "executable config": f=>{f.accounts[2]!.executable=true;},
  "wrong discriminator": f=>{f.configBytes[0]^=1;},
  "truncated config": f=>{f.accounts[2]!.data=f.configBytes.subarray(0,77);},
  "unknown current authority": f=>{program.toBuffer().copy(f.configBytes,8);},
  "wrong pending owner": f=>{program.toBuffer().copy(f.configBytes,41);},
  "malformed pending option": f=>{f.configBytes[40]=2;},
  "wrong config bump": f=>{f.configBytes[77]^=1;},
};
for (const [name,mutate] of Object.entries(tamper)) test(`claim preparation rejects ${name} before producing a wallet instruction`,async()=>{
  const f=fixture(); mutate(f);
  await assert.rejects(prepareDevnetOwnerClaim(f.rpc,new PublicKey(policy.owner),routing,90),/reviewed setup/);
});

test("owner with a different pending successor is not misreported as completed",async()=>{
  const f=fixture(); new PublicKey(policy.owner).toBuffer().copy(f.configBytes,8);
  await assert.rejects(inspect(f),/reviewed setup/);
});

test("namespace role substitution is blocked locally before any RPC",async()=>{
  const f=fixture();
  const foreign=createNamespaceRouting([{...routing.registry[0],id:"devnet-other"}]);
  await assert.rejects(inspectDevnetOwnerClaim(f.rpc,foreign,90),/not registered/); assert.equal(f.reads(),0);
});

test("prepared owner setup can be checked without entering the active namespace registry", async () => {
  const f=fixture();
  assert.equal((await inspectDevnetOwnerClaim(f.rpc,undefined,90)).status,"ready");
});

test("reviewed owner claim requires active page and accepted owner intent before RPC", async () => {
  for (const changed of [{accepted:false},{active:false},{wallet:policy.bootstrapAuthority},{connection:{}}]) {
    const f=fixture();
    const current:OwnerClaimIntent={connection:f.rpc,wallet:policy.owner,accepted:true,active:true,...changed};
    const review=createDevnetOwnerClaimReview(f.rpc,new PublicKey(policy.owner),()=>current,routing,90);
    await assert.rejects(review.prepare()); assert.equal(f.reads(),0);
  }
});

test("reviewed claim rejects a wallet switch during its finalized account read", async () => {
  const f=fixture();
  let current:OwnerClaimIntent={connection:f.rpc,wallet:policy.owner,accepted:true,active:true};
  const read=f.rpc.getMultipleAccountsInfoAndContext;
  f.rpc.getMultipleAccountsInfoAndContext=(async(...args:Parameters<typeof read>)=>{
    const result=await read(...args); current={...current,wallet:policy.bootstrapAuthority}; return result;
  }) as typeof read;
  const review=createDevnetOwnerClaimReview(f.rpc,new PublicKey(policy.owner),()=>current,routing,90);
  await assert.rejects(review.prepare(),/wallet or network changed/);
});

test("fresh post-simulation claim review carries a monotonic finalized context", async () => {
  const f=fixture(); let calls=0;
  const read=f.rpc.getMultipleAccountsInfoAndContext;
  f.rpc.getMultipleAccountsInfoAndContext=(async(keys:PublicKey[],options:Parameters<typeof read>[1])=>{
    if (calls++ === 0) return read(keys,options);
    assert.deepEqual(options,{commitment:"finalized",minContextSlot:100});
    return {context:{slot:101},value:f.accounts};
  }) as typeof read;
  const current:OwnerClaimIntent={connection:f.rpc,wallet:policy.owner,accepted:true,active:true};
  const review=createDevnetOwnerClaimReview(f.rpc,new PublicKey(policy.owner),()=>current,routing,90);
  assert.equal((await review.prepare()).state.contextSlot,100);
  assert.equal((await review.prepare()).state.contextSlot,101);
});

test("context changes after async review never reach the owner wallet invocation", async () => {
  for (const changed of [{accepted:false},{active:false},{wallet:policy.bootstrapAuthority},{connection:{}}]) {
    const f=fixture(); let sends=0;
    let current:OwnerClaimIntent={connection:f.rpc,wallet:policy.owner,accepted:true,active:true};
    const review=createDevnetOwnerClaimReview(f.rpc,new PublicKey(policy.owner),()=>current,routing,90);
    await assert.rejects(sendWithReviewedIntent(async()=>{sends++;},async()=>{await review.prepare();current={...current,...changed};},review.assertCurrent));
    assert.equal(sends,0);
  }
});

test("the current reviewed owner intent reaches the wallet once", async () => {
  const f=fixture(); let sends=0;
  const current:OwnerClaimIntent={connection:f.rpc,wallet:policy.owner,accepted:true,active:true};
  const review=createDevnetOwnerClaimReview(f.rpc,new PublicKey(policy.owner),()=>current,routing,90);
  await sendWithReviewedIntent(async()=>{sends++;},async()=>{await review.prepare();},review.assertCurrent);
  assert.equal(sends,1);
});

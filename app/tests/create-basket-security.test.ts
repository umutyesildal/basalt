import assert from "node:assert/strict";
import test from "node:test";
import { AddressLookupTableAccount, AddressLookupTableProgram, PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import retiredInventory from "../../scripts/security/retired-keys.json";
import { assertSafeCreateBasketFactory } from "../lib/create-basket-security";
import { buildCreateBasketTransaction, deriveCreateBasketAltAddresses, ensureCreateBasketAlt } from "../lib/transactions";
import type { CreateBasketArgs } from "../lib/create-basket";
import { FACTORY_FIXTURE_ADDRESS, FACTORY_FIXTURE_BUMP, factoryFixture } from "./factory-fixture";

const key = (byte: number) => new PublicKey(Buffer.alloc(32,byte));
const creator = key(52).toBase58();
const args = (count = 2): CreateBasketArgs => ({nonce:1,constituents:Array.from({length:count},(_,i)=>key(60+i).toBase58()),
  weightsBps:Array(count).fill(10000/count),entryFeeBps:0,exitFeeBps:0,managementFeeBps:0,
  metadataHash:new Uint8Array(32).fill(1),seedAmounts:Array(count).fill(1000000n)});
const error = /New basket creation is blocked/;

for (const retired of retiredInventory.keys) {
  test(`retired factory treasury ${retired.publicKey} blocks build and ALT before wallet or setup reads`, async () => {
    let reads = 0, approvals = 0;
    const connection = {getAccountInfo:async(address:PublicKey,commitment:string)=>{
      reads++; assert.equal(address.toBase58(),FACTORY_FIXTURE_ADDRESS.toBase58()); assert.equal(commitment,"finalized");
      return factoryFixture(new PublicKey(retired.publicKey));
    }} as unknown as Connection;
    await assert.rejects(buildCreateBasketTransaction({connection,creator,args:args()}),error);
    await assert.rejects(ensureCreateBasketAlt({connection,creator,args:args(4),sendTransaction:async()=>{approvals++; throw new Error("wallet must not be called");},onAwaitingWallet:()=>{approvals++;}}),error);
    assert.equal(reads,2); assert.equal(approvals,0);
  });
}
for (const kind of ["missing","rpc-failure","wrong-owner","executable","wrong-discriminator","short-layout","wrong-bump","zero-treasury"]) {
  test(`malformed current factory (${kind}) fails closed before transaction preparation`, async () => {
    let account: AccountInfo<Buffer> | null = factoryFixture();
    if (kind === "missing") account=null;
    if (kind === "wrong-owner") account!.owner=key(95);
    if (kind === "executable") account!.executable=true;
    if (kind === "wrong-discriminator") account!.data[0]^=1;
    if (kind === "short-layout") account!.data=account!.data.subarray(0,88);
    if (kind === "wrong-bump") account!.data[88]=(FACTORY_FIXTURE_BUMP+1)%256;
    if (kind === "zero-treasury") PublicKey.default.toBuffer().copy(account!.data,40);
    const connection = {getAccountInfo:async()=>{if(kind === "rpc-failure") throw new Error("RPC unavailable"); return account;}} as unknown as Connection;
    await assert.rejects(buildCreateBasketTransaction({connection,creator,args:args()}),error);
    await assert.rejects(ensureCreateBasketAlt({connection,creator,args:args(4),sendTransaction:async()=>{throw new Error("wallet must not be called");}}),error);
  });
}
test("an authenticated clean treasury continues into the actual two-constituent transaction build", async () => {
  let factoryReads = 0, blockhashReads = 0;
  const connection = {
    getAccountInfo:async(address:PublicKey)=>{assert.ok(address.equals(FACTORY_FIXTURE_ADDRESS)); factoryReads++; return factoryFixture();},
    getLatestBlockhash:async()=>{blockhashReads++; return {blockhash:key(99).toBase58(),lastValidBlockHeight:100};},
  } as unknown as Connection;
  const built = await buildCreateBasketTransaction({connection,creator,args:args()});
  assert.equal(factoryReads,1); assert.equal(blockhashReads,1); assert.equal(built.usedLookupTable,false);
  assert.ok(built.sizeBytes<=1232); assert.equal(built.transaction.message.compiledInstructions.length,3);
});
test("an authenticated clean treasury continues into ALT reuse without a new wallet approval", async () => {
  const createArgs=args(4), wanted=deriveCreateBasketAltAddresses(creator,createArgs);
  const tableKey=AddressLookupTableProgram.createLookupTable({authority:new PublicKey(creator),payer:new PublicKey(creator),recentSlot:100})[1];
  let factoryReads=0,tableReads=0,approvals=0;
  const table = new AddressLookupTableAccount({key:tableKey,state:{deactivationSlot:(1n<<64n)-1n,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,authority:new PublicKey(creator),addresses:wanted}});
  const connection = {
    getAccountInfo:async(address:PublicKey)=>{
      if(address.equals(FACTORY_FIXTURE_ADDRESS)){factoryReads++;return factoryFixture();}
      assert.ok(address.equals(tableKey));
      return {owner:AddressLookupTableProgram.programId,executable:false,lamports:1,data:Buffer.alloc(56)};
    },
    getGenesisHash:async()=>"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
    getSlot:async()=>100,
    getAddressLookupTable:async()=>{tableReads++;return{context:{slot:100},value:table};},
  } as unknown as Connection;
  // A complete table at the canonical deterministic address is reused.
  const result=await ensureCreateBasketAlt({connection,creator,args:createArgs,recentSlot:100,sendTransaction:async()=>{approvals++;throw new Error("wallet should not be needed");}});
  assert.equal(factoryReads,1); assert.ok(tableReads>=1); assert.equal(approvals,0); assert.equal(result.created,false);
});
test("a second current factory read detects treasury retirement between setup and final build", async () => {
  let treasury=key(91),reads=0;
  const connection={getAccountInfo:async()=>{reads++;return factoryFixture(treasury);}} as unknown as Connection;
  await assertSafeCreateBasketFactory(connection);
  treasury=new PublicKey(retiredInventory.keys[0].publicKey);
  await assert.rejects(buildCreateBasketTransaction({connection,creator,args:args()}),error);
  assert.equal(reads,2);
});

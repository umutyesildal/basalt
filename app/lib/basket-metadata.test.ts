import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {hydrateBasketMetadata,publishBasketMetadataWithRetry,publishLocalBasketMetadata,rememberBasketMetadata,verifyBasketMetadataDocument} from "./basket-metadata";
const address='14dbVJmT5Ja9iLnAHETB4N17ukAYMjLsdPDx1hdiCXxx';
const document='{ "name":"My real name", "description":"My real thesis", "coverId":"orbit" }';
const hash=createHash('sha256').update(document).digest('hex');
test('fresh browser receives exact published creator content, without local storage',async()=>{
  assert.deepEqual(await verifyBasketMetadataDocument(document,hash),JSON.parse(document));
  assert.equal(await verifyBasketMetadataDocument(JSON.stringify(JSON.parse(document)),hash),null);
  assert.equal(await verifyBasketMetadataDocument(document,'f'.repeat(64)),null);
  assert.equal(await verifyBasketMetadataDocument('{"name":"'+ 'x'.repeat(65)+'"}',hash),null);
  const row=await hydrateBasketMetadata({pubkey:address,metadata_hash:hash,metadata_document:document,metadata_json:{name:'invented'}});
  assert.deepEqual(row.metadata_json,JSON.parse(document));
});
test('missing or corrupted content never inherits an invented display name',async()=>{
  const row=await hydrateBasketMetadata({pubkey:'11111111111111111111111111111111',metadata_hash:hash,metadata_document:'corrupted',metadata_json:{name:'invented'}});
  assert.equal(row.metadata_json,null);
});
test('publication is deduplicated and byte exact',async()=>{
  rememberBasketMetadata(address,document);
  let calls=0;
  const fetcher=async(path:string,init?:RequestInit)=>{
    calls++;assert.equal(path,`/api/v1/baskets/${address}/metadata`);assert.equal(init?.method,'POST');
    assert.deepEqual(JSON.parse(String(init?.body)),{document});
    return new Response(JSON.stringify({data:{pubkey:address,metadata_hash:hash,metadata_document:document}}),{status:200});
  };
  const results=await Promise.all(Array.from({length:8},()=>publishLocalBasketMetadata({pubkey:address,metadata_hash:hash},fetcher)));
  assert.ok(results.every(Boolean));assert.equal(calls,1);
  assert.equal(await publishLocalBasketMetadata({pubkey:address,metadata_hash:'f'.repeat(64)},fetcher),false);
  assert.equal(calls,1);
});

test('creation retries an unindexed listing, without rebuilding or signing the transaction',async context=>{
  const retryAddress='2iDZBYqZsNumBPs9hfRadXa1SVNc7AP4BhMNiDfug8Ma';
  rememberBasketMetadata(retryAddress,document);
  let now=Date.now(),calls=0,waits=0;
  context.mock.method(Date,'now',()=>now);
  const fetcher=async()=>{
    calls++;
    return calls===1 ? new Response(JSON.stringify({error:{code:'NOT_INDEXED'}}),{status:404}) : new Response(JSON.stringify({data:{pubkey:retryAddress,metadata_document:document}}),{status:200});
  };
  assert.equal(await publishBasketMetadataWithRetry({pubkey:retryAddress,metadata_hash:hash},fetcher,async milliseconds=>{waits++;now+=milliseconds;}),true);
  assert.equal(calls,2);assert.equal(waits,1);
});
test('metadata retries are bounded when the backend remains unavailable',async context=>{
  const retryAddress='HEEb58k3QhwVqghxWTHwD9HmmjCGrpqapyTfoQH1DuKr';
  rememberBasketMetadata(retryAddress,document);
  let now=Date.now(),calls=0;
  context.mock.method(Date,'now',()=>now);
  assert.equal(await publishBasketMetadataWithRetry({pubkey:retryAddress,metadata_hash:hash},async()=>{calls++;throw new Error('offline');},async milliseconds=>{now+=milliseconds;}),false);
  assert.equal(calls,4);
});

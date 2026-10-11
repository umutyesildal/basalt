import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { createHandler } from '../src/api/server';
import { ApiResourceLimits } from '../src/api/resource-limits';
import type { PgLike } from '../src/db/client';
import { metadataHash } from '../src/api/basket-metadata';
import { PROGRAM_NAMESPACES } from '../src/config/programNamespaces';
const address='14dbVJmT5Ja9iLnAHETB4N17ukAYMjLsdPDx1hdiCXxx';
const document='{"name":"Original basket","description":"Creator thesis","coverId":"orbit"}';
const servers:http.Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());})));});
async function start(db:PgLike|null,limits=new ApiResourceLimits()) {
 const server=http.createServer(createHandler({db,resourceLimits:limits,authSecret:'isolated-metadata-test'}));servers.push(server);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return `http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1/baskets/${address}/metadata`;
}
const post=(url:string,body:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
describe('creator metadata HTTP admission',()=>{
 it('accepts the committed bytes and rejects a changed name without updating',async()=>{
  let writes=0;
  const db={query:async(sql:string)=>{if(sql.startsWith('SELECT factory'))return {rows:[{factory:PROGRAM_NAMESPACES[1].factoryConfig,metadata_hash:metadataHash(document),metadata_document:null}]};writes++;return {rows:[{pubkey:address}]};}} as unknown as PgLike;
  const url=await start(db),result=await post(url,{document});
  expect(result.status).toBe(200);expect(result.headers.get('cache-control')).toBe('no-store');
  expect((await result.json()).data.metadata_document).toBe(document);
  expect((await post(url,{document:document.replace('Original','Fake')})).status).toBe(409);expect(writes).toBe(1);
 });
 it('rejects malformed input, extra fields, invalid addresses and query parameters before accessing DB',async()=>{
  let calls=0;const url=await start({query:async()=>{calls++;return {rows:[]};}} as unknown as PgLike);
  for(const body of [null,[],{document:'invalid'},{document:'{"name":""}'},{document,extra:'anything'}]) expect((await post(url,body)).status).toBe(400);
  expect((await post(url+'?x=1',{document})).status).toBe(400);
  expect((await post(url.replace(address,'invalid'),{document})).status).toBe(400);
  expect((await fetch(url)).status).toBe(405);expect(calls).toBe(0);
 });
 it('bounds body bytes and rate admission while leaving public reads available',async()=>{
  let calls=0;const url=await start({query:async()=>{calls++;return {rows:[]};}} as unknown as PgLike,new ApiResourceLimits({ipLimits:{'metadata-create':2}}));
  expect((await post(url,{document:' '.repeat(33000)})).status).toBe(413);
  expect((await post(url,{document})).status).toBe(404);
  expect((await post(url,{document})).status).toBe(429);expect(calls).toBe(1);
  expect((await fetch(new URL('/api/v1/health',url))).status).toBe(200);
 });
 it('honestly reports unavailable storage without publishing a basket',async()=>{
  expect((await post(await start(null),{document})).status).toBe(503);
 });
});

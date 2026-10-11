import {describe,it,expect} from "vitest";
import {parseBasketMetadata,publicBasketMetadata,metadataHash,publishBasketMetadata} from "../src/api/basket-metadata";
describe("basket metadata admission",()=>{
  it.each([null,[],42,'null','[]','{broken','{"name":42}','{"name":""}',JSON.stringify({name:'x'.repeat(65)}),JSON.stringify({name:'ok',description:'x'.repeat(401)}),JSON.stringify({name:'ok',coverId:'https://evil.example/image'}),JSON.stringify({name:'ok',extra:'x'.repeat(16384)})])("bounds inert creator content",async value=>{
    expect(()=>parseBasketMetadata(value)).toThrow();
    await expect(publishBasketMetadata(null,'basket',value)).rejects.toMatchObject({status:400});
  });
  it("never trusts metadata_json without an exact original document",()=>{
    const document='{ "name":"My basket", "description":"My thesis" }';
    expect(publicBasketMetadata({metadata_json:{name:'fake'}})).toEqual({metadata_json:null,metadata_document:null});
    expect(publicBasketMetadata({metadata_document:document,metadata_hash:metadataHash(document),metadata_json:{name:'fake'}}).metadata_json).toEqual(JSON.parse(document));
    expect(publicBasketMetadata({metadata_document:document,metadata_hash:'f'.repeat(64)}).metadata_json).toBeNull();
  });
  it("is unavailable without database access",async()=>{
    await expect(publishBasketMetadata(null,'basket','{"name":"Actual"}')).rejects.toMatchObject({status:503});
  });
});

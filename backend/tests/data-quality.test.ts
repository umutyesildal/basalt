import { describe,it,expect } from "vitest";
import { basketDataQuality } from "../src/api/data-quality";
const now=new Date("2026-10-09T13:00:00Z");
const complete={ts:now,valuation_eligible:true,valuation_status:"complete",current_eligible:true,current_status:"complete"};
describe("public basket data quality",()=>{
 it("unknown or arbitrary internal reasons produce only fixed public messages",()=>{
  const result=basketDataQuality({current_status:"incomplete",current_reason:"postgres://secret@private/query"},now);
  expect(JSON.stringify(result)).not.toMatch(/secret|postgres|private/);
  expect(result.valuation).toMatchObject({eligible:false,reason:"valuation-unavailable"});
 });
 it("pending historical effects do not fabricate prices or erase independently eligible NAV",()=>{
  const result=basketDataQuality({...complete,pending_signatures:108,recovery_required:true},now);
  expect(result.status).toBe("pending");expect(result.valuation.eligible).toBe(true);
  expect(result.recovery).toMatchObject({required:true,pendingSignatures:108});
 });
 it("mock or stale snapshots never become eligible",()=>{
  expect(basketDataQuality({...complete,valuation_status:"mock"},now).valuation.eligible).toBe(false);
  expect(basketDataQuality({...complete,ts:new Date(now.getTime()-16*60000)},now).valuation.eligible).toBe(false);
 });
 it("only current complete evidence is ready",()=>{
  expect(basketDataQuality(complete,now).status).toBe("ready");
  expect(basketDataQuality({},now).status).toBe("unavailable");
 });
});

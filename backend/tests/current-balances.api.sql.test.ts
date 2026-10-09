/** Current holdings may be proven without certifying historical financial claims. */
import {afterAll,beforeAll,beforeEach,describe,it,expect} from 'vitest';
import pg from 'pg';
import {applySchema} from '../src/db/init';
import type {PgLike} from '../src/db/client';
import {currentBalancesForWallet} from '../src/api/current-balances';
import {userPortfolio,userPositionsByWallet} from '../src/api/server';
import {DEVNET_PROGRAMS} from '../src/api/readiness';
const url=process.env.BASKET_RETURNS_TEST_DATABASE_URL;
const schema=`current_balance_api_${process.pid}_${Date.now()}`;
let client:pg.Client;let db:PgLike;let now:Date;
describe.skipIf(!url)('current balance API on actual PostgreSQL',()=>{
 beforeAll(async()=>{client=new pg.Client({connectionString:url});await client.connect();await client.query(`CREATE SCHEMA "${schema}"`);await client.query(`SET search_path TO "${schema}"`);db=client;await applySchema(db);},30000);
 afterAll(async()=>{if(client){await client.query(`DROP SCHEMA "${schema}" CASCADE`);await client.end();}});
 beforeEach(async()=>{await client.query(`DROP SCHEMA "${schema}" CASCADE`);await client.query(`CREATE SCHEMA "${schema}"`);await applySchema(db);now=new Date();
  await client.query(`INSERT INTO baskets(pubkey,factory,creator,treasury,share_mint,nonce,created_at,metadata_hash,num_constituents,constituents,weights_bps,entry_fee_bps,exit_fee_bps,management_fee_bps,last_fee_accrual_ts)
   VALUES('basket','factory','creator','treasury','mint',1,NOW(),'hash',2,ARRAY['a','b'],ARRAY[5000,5000],0,0,0,NOW())`);
  await client.query(`INSERT INTO user_positions("user",basket,share_balance,cost_basis) VALUES('wallet','basket',99,123)`);
  await client.query(`INSERT INTO position_rebuild_required(basket,reason) VALUES('basket','legacy-gap')`);
 });
 async function snapshot(shares='10000000000000001') {await client.query(`INSERT INTO current_balance_snapshots(basket,program_ids,slot,supply,balances,accounts_digest,account_count,observed_at,status)
  VALUES('basket',$1,500,$2,$3,$4,1,$5,'verified')`,[DEVNET_PROGRAMS,shares,JSON.stringify(shares==='0'?[]:[{user:'wallet',shares}]),'a'.repeat(64),now]);}
 it('uses exact finalized raw balances while preserving old positions and recovery guards',async()=>{await snapshot();
  expect((await userPortfolio(db,'wallet')).payload).toMatchObject({count:1,coverage:{indexedBaskets:1,verifiedBaskets:1,complete:true},data:[{share_balance:'10000000000000001',cost_basis:null,estimatedValue:null,projectionStatus:'snapshot-verified',balanceEvidence:{slot:500,historyComplete:false,costBasisKnown:false}}]});
  expect((await userPositionsByWallet(db,'wallet')).payload).toMatchObject({data:[{shareBalance:'10000000000000001',valueUsd:null,costBasis:null,projectionStatus:'snapshot-verified'}]});
  expect((await client.query('SELECT share_balance::text,cost_basis::text FROM user_positions')).rows).toEqual([{share_balance:'99',cost_basis:'123'}]);
  expect((await client.query('SELECT COUNT(*)::int AS n FROM position_rebuild_required')).rows[0].n).toBe(1);
 });
 it('a verified zero balance replaces stale positive projection without deleting evidence',async()=>{await snapshot('0');expect((await userPortfolio(db,'wallet')).payload).toMatchObject({data:[],count:0,coverage:{complete:true}});expect((await client.query('SELECT share_balance::text FROM user_positions')).rows[0].share_balance).toBe('99');});
 it.each(['stale','future','failed','wrong-programs'])('does not count %s snapshots as verified coverage',async mode=>{await snapshot();
  if(mode==='stale')await client.query("UPDATE current_balance_snapshots SET observed_at=NOW()-interval '6 minutes'");
  if(mode==='future')await client.query("UPDATE current_balance_snapshots SET observed_at=NOW()+interval '6 minutes'");
  if(mode==='failed')await client.query("UPDATE current_balance_snapshots SET status='incomplete'");
  if(mode==='wrong-programs')await client.query("UPDATE current_balance_snapshots SET program_ids=ARRAY['a','b','c']");
  const result=await currentBalancesForWallet(db,'wallet');expect(result.coverage).toEqual({indexedBaskets:1,verifiedBaskets:0,complete:false});expect(result.rows).toEqual([]);
 });
 it('does not call unknown coverage an empty wallet',async()=>{const payload=(await userPortfolio(db,'other-wallet')).payload as any;expect(payload.count).toBe(0);expect(payload.coverage.complete).toBe(false);expect(payload.note).toContain('does not establish');});
 it('distinguishes a verified empty wallet from an uncovered basket',async()=>{await snapshot();expect((await userPortfolio(db,'other-wallet')).payload).toMatchObject({count:0,coverage:{complete:true}});});
 it.each([{user:'wallet'}, {user:'wallet',shares:'broken'}, {user:'wallet',shares:'0'}, {user:'wallet',shares:'18446744073709551616'}])('rejects malformed matched holder evidence %j',async holder=>{await snapshot();await client.query('UPDATE current_balance_snapshots SET balances=$1',[JSON.stringify([holder])]);await expect(currentBalancesForWallet(db,'wallet')).rejects.toThrow('Invalid stored finalized share amount');});
 it('rejects duplicate matched owners instead of reporting a verified zero or total',async()=>{await snapshot();await client.query('UPDATE current_balance_snapshots SET balances=$1',[JSON.stringify([{user:'wallet',shares:'1'},{user:'wallet',shares:'2'}])]);await expect(currentBalancesForWallet(db,'wallet')).rejects.toThrow('Duplicate stored finalized holder');});
 it('forbids claiming recovered historical completeness in the snapshot table',async()=>{await snapshot();await expect(client.query('UPDATE current_balance_snapshots SET history_complete=true')).rejects.toThrow();});
});

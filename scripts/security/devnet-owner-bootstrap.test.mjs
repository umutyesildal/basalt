import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { DEVNET_OWNER_POLICY, publicOwnerInputTemplate, validateDevnetOwnerBootstrapRecord, inspectDevnetOwnerSourceInputs, createDevnetOwnerBootstrapPlan, verifyDevnetOwnerNamespaceVacant } from './devnet-owner-bootstrap.mjs';
import { DEVNET_GENESIS, validateCeremonyRecord } from './governance-preflight.mjs';
import { BPF_UPGRADEABLE_LOADER_ID, PROGRAM_IDS } from '../deployment-verifier.mjs';
import { retiredKeys } from './retired-keys.mjs';
const {PublicKey} = createRequire(new URL('../../backend/package.json', import.meta.url))('@solana/web3.js');
const root = fileURLToPath(new URL('../../', import.meta.url)), commit = 'a'.repeat(40);
const copy = value => JSON.parse(JSON.stringify(value));
function accepted() {
  const record = publicOwnerInputTemplate(commit);
  record.releaseTag = 'owner-devnet-TEST'; record.treasury = record.owner;
  record.ownerRoleAcceptance = 'accepted'; record.treasuryAcceptance = 'accepted'; record.ownerAcceptanceReference = 'TEST-owner-review';
  return record;
}

test('shared public policy keeps owner/treasury pending and never invents hardware/multisig approval', () => {
  assert.equal(DEVNET_OWNER_POLICY.treasury, null); assert.equal(DEVNET_OWNER_POLICY.ownerRoleAcceptance, 'pending');
  assert(Object.isFrozen(DEVNET_OWNER_POLICY)); assert(Object.isFrozen(DEVNET_OWNER_POLICY.programIds));
  const record = publicOwnerInputTemplate(commit), report = createDevnetOwnerBootstrapPlan(record, {sourceCommit:commit});
  assert.deepEqual(record.programIds, DEVNET_OWNER_POLICY.programIds);
  assert.equal(report.declaredOwnerAcceptance, false); assert.equal(report.declaredTreasuryAcceptance, false);
  assert(report.missingInputs.includes('treasury')); assert(report.missingInputs.includes('ownerRoleAcceptance'));
  for (const flag of ['executionAuthorized', 'deployable', 'creationReady', 'mainnetApproved', 'multisigApproved', 'ownerControlVerified']) assert.equal(report[flag], false);
  assert.equal(report.governance.timelock, false); assert.equal(report.governance.multisig, false);
  assert.equal(report.legacyNamespace.writesAllowed, false); assert.equal(report.legacyNamespace.historicalRecoveryActivationAllowed, false);
  assert.equal(report.legacyNamespace.redemptionMustRemainAvailable, true);
  assert.equal(report.sourceFeature, 'owner-devnet'); assert.equal(report.sourceHashesAreBuildAttestation, false);
  assert.equal(report.allowedScope.assets, 'verified-project-issued-mocks-only'); assert.equal(report.allowedScope.mockUsdValue, null);
});

test('filled review declarations derive only exact clean PDAs; signatures/build/deployment remain unproven', () => {
  const record = accepted(), plan = createDevnetOwnerBootstrapPlan(record,{sourceCommit:commit});
  assert.deepEqual(plan.missingInputs, []); assert.equal(plan.declaredOwnerAcceptance,true); assert.equal(plan.ownerControlVerified,false);
  assert.equal(plan.status,'requires-source-build-runtime-proof-and-owner-signatures'); assert.equal(plan.executionAuthorized,false);
  for(const [name,id] of Object.entries(record.programIds)) {
    assert.equal(plan.plannedNamespace.programData[name],PublicKey.findProgramAddressSync([new PublicKey(id).toBuffer()],new PublicKey(BPF_UPGRADEABLE_LOADER_ID))[0].toBase58());
    assert.notEqual(id,PROGRAM_IDS[name]);
  }
  assert.equal(plan.plannedNamespace.factoryConfig,PublicKey.findProgramAddressSync([Buffer.from('factory')],new PublicKey(record.programIds.basket_factory))[0].toBase58());
  assert(plan.signingBoundaries.find(boundary=>boundary.action==='checked-loader-handoff').required.includes('proposed-owner-wallet'));
  assert(plan.remainingProof.some(proof=>proof.includes('legacy redemption')));
  assert.throws(()=>createDevnetOwnerBootstrapPlan(record,{sourceCommit:'b'.repeat(40)}),/checkout HEAD/);
  assert.throws(()=>validateCeremonyRecord({...record,expectedCurrentAuthority:'anything'})); // Generic Squads validation stays strict.
});

test('mainnet, false custody/execution claims, arbitrary identities, role collisions and private fields reject', () => {
  const mutations = [
    r=>{r.cluster='mainnet-beta';}, r=>{r.genesisHash=DEVNET_GENESIS.slice(0,-8);},r=>{r.mode='production';},
    r=>{r.governance.multisig=true;},r=>{r.governance.productionApproval=true;},r=>{r.deploymentExecuted=true;},
    r=>{r.governance.hardwareWallet=true;},r=>{r.governance.signers=[r.owner];},r=>{r.ownerRoleAcceptance=true;},
    r=>{r.ownerAcceptanceReference=null;},r=>{r.ownerAcceptanceReference='https://user:password@example.com/ticket';},
    r=>{r.sourceCommit='main';},r=>{r.programIds.basket=PROGRAM_IDS.basket;},r=>{r.owner=DEVNET_OWNER_POLICY.bootstrapAuthority;},
    r=>{r.bootstrapAuthority=r.owner;},r=>{r.treasury=r.bootstrapAuthority;},r=>{r.programIds.basket=r.programIds.whitelist;},
    r=>{r.programIds.basket=r.owner;},r=>{r.treasury='11111111111111111111111111111111';},
    r=>{r.owner='1'+r.owner;},r=>{r.programIds.basket=Array(64).fill(7);},
    r=>{r.secretKey='do-not-print';},r=>{r.programIds.secretKey=Array(64).fill(1);},r=>{r.governance.privateKey='do-not-print';},
  ];
  for(const {publicKey} of retiredKeys) for(const role of ['owner','bootstrapAuthority','treasury']) mutations.push(r=>{r[role]=publicKey;});
  for(const mutate of mutations) {const record=accepted();mutate(record);assert.throws(()=>validateDevnetOwnerBootstrapRecord(record));}
  assert.throws(()=>validateDevnetOwnerBootstrapRecord(Array(64).fill(1)),/public fields/);
  const unreviewed=accepted(); unreviewed.programIds.basket=new PublicKey(Uint8Array.from({length:32},()=>9)).toBase58();
  assert.throws(()=>validateDevnetOwnerBootstrapRecord(unreviewed));
});

test('isolated fixture policy injection is explicit and cannot be supplied in a public record or CLI',()=>{
  const record=accepted(); record.owner=record.treasury=new PublicKey(Uint8Array.from({length:32},()=>9)).toBase58();
  assert.throws(()=>validateDevnetOwnerBootstrapRecord(record));
  const policy={...copy(DEVNET_OWNER_POLICY),owner:record.owner};
  assert.deepEqual(validateDevnetOwnerBootstrapRecord(record,{policy}).missingInputs,[]);
  record.policy=policy; assert.throws(()=>validateDevnetOwnerBootstrapRecord(record,{policy}),/public fields/);
});

test('pending generated policy is useful without role acceptance or source-release claims', () => {
  const validation=validateDevnetOwnerBootstrapRecord(copy(DEVNET_OWNER_POLICY));
  for(const field of ['treasury','sourceCommit','releaseTag','ownerRoleAcceptance','treasuryAcceptance']) assert(validation.missingInputs.includes(field));
  const report=createDevnetOwnerBootstrapPlan(copy(DEVNET_OWNER_POLICY),{sourceCommit:commit});
  assert.equal(report.executionAuthorized,false); assert.equal(report.declaredOwnerAcceptance,false);
});

test('source proof hashes exact files and preserves separate default/owner feature maps', () => {
  const inputs=inspectDevnetOwnerSourceInputs(); assert.equal(inputs.length,17);
  for(const input of inputs) assert.equal(input.sha256,createHash('sha256').update(readFileSync(join(root,input.path))).digest('hex'));
  for(const path of ['Anchor.owner-devnet.toml','backend/src/config/devnetOwnerPolicy.json','programs/basket_factory/Cargo.toml']) assert(inputs.some(input=>input.path===path));
});

test('comment/raw-string identity spoof, feature propagation/default changes and inactive TOML sections fail closed', () => {
  const featureDeclaration=`#[cfg(feature = "owner-devnet")]\ndeclare_id!("${DEVNET_OWNER_POLICY.programIds.whitelist}");`;
  for(const mutate of [
    (path,text)=>path.endsWith('/programs/whitelist/src/lib.rs')?text.replace(featureDeclaration,'/* '+featureDeclaration+' */'):text,
    (path,text)=>path.endsWith('/programs/whitelist/src/lib.rs')?text.replace(featureDeclaration,'#[doc = r#"'+featureDeclaration+'"#]'):text,
    (path,text)=>path.endsWith('/programs/whitelist/src/lib.rs')?text+'\n'+featureDeclaration:text,
    (path,text)=>path.endsWith('/programs/basket_factory/Cargo.toml')?text.replace('"whitelist/owner-devnet", ',''):text,
    (path,text)=>path.endsWith('/programs/basket/Cargo.toml')?text.replace('default = []','default = ["owner-devnet"]'):text,
    (path,text)=>path.endsWith('/programs/whitelist/Cargo.toml')?text.replace('owner-devnet = []','# owner-devnet = []')+'\n[dependencies.owner-devnet]\nowner-devnet = []':text,
    (path,text)=>path.endsWith('/Anchor.owner-devnet.toml')?text.replace(DEVNET_OWNER_POLICY.programIds.basket,PROGRAM_IDS.basket):text,
    (path,text)=>path.endsWith('/programs/whitelist/src/lib.rs')?text.replace('constraint = program_data.upgrade_authority_address == Some(authority.key()) @ WhitelistError::UnauthorizedInitialization','/* constraint = program_data.upgrade_authority_address == Some(authority.key()) @ WhitelistError::UnauthorizedInitialization */'):text,
  ]) assert.throws(()=>inspectDevnetOwnerSourceInputs({root,readFile(path){return mutate(path,readFileSync(path,'utf8'));}}));
});

function rpcFixture(mutation) {
  const calls=[];
  const fetchImpl=async (url,init)=>{
    assert.equal(url,'https://api.devnet.solana.com'); assert(init.signal instanceof AbortSignal);
    const request=JSON.parse(init.body); calls.push(request); assert(['getGenesisHash','getMultipleAccounts'].includes(request.method));
    let result=DEVNET_GENESIS;
    if(request.method==='getMultipleAccounts') {
      assert.deepEqual(request.params[1],{encoding:'base64',commitment:'finalized'}); assert.equal(new Set(request.params[0]).size,8);
      result={context:{slot:123},value:Array(8).fill(null)};
      if(mutation==='occupied') result.value[7]={owner:'not-vacant'};
      if(mutation==='count') result.value.pop(); if(mutation==='slot') result.context.slot=-1;
    } else if(mutation==='genesis') result='mainnet';
    return Response.json({jsonrpc:'2.0',id:mutation==='id'?request.id+1:request.id,result});
  };
  return {calls,fetchImpl};
}

test('vacancy proof needs no owner signature and permits only bounded finalized reads, never deployment approval',async()=>{
  const f=rpcFixture(),proof=await verifyDevnetOwnerNamespaceVacant(copy(DEVNET_OWNER_POLICY),{fetchImpl:f.fetchImpl});
  assert.equal(f.calls.length,2);assert.equal(proof.allAbsent,true);assert.equal(proof.contextSlot,123);
  assert.equal(proof.executionAuthorized,false);assert.equal(proof.ownerControlVerified,false);assert.equal(proof.mainnetApproved,false);
});

test('wrong genesis/id/count/slot and occupied new accounts reject vacancy',async()=>{
  for(const mutation of ['genesis','id','count','slot','occupied']) await assert.rejects(verifyDevnetOwnerNamespaceVacant(accepted(),{fetchImpl:rpcFixture(mutation).fetchImpl}));
});

test('oversized and stalled fetch/body responses remain bounded even when the transport ignores abort',async()=>{
  let cancelled=false;
  await assert.rejects(verifyDevnetOwnerNamespaceVacant(accepted(),{fetchImpl:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(128*1024+1));},cancel(){cancelled=true;}}))}),/exceeds limit/);
  assert.equal(cancelled,true);
  await assert.rejects(verifyDevnetOwnerNamespaceVacant(accepted(),{timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/deadline exceeded/);
  let aborted=false;
  await assert.rejects(verifyDevnetOwnerNamespaceVacant(accepted(),{timeoutMs:10,fetchImpl:async(_url,init)=>{init.signal.addEventListener('abort',()=>{aborted=true;});return new Response(new ReadableStream());}}),/deadline exceeded/);
  assert.equal(aborted,true);
  await assert.rejects(verifyDevnetOwnerNamespaceVacant(accepted(),{timeoutMs:15001,fetchImpl:rpcFixture().fetchImpl}),/bounded/);
});

test('CLI is unsigned/nonzero, uses explicit record mode and never prints rejected secret material',()=>{
  const script=join(root,'scripts/security/devnet-owner-bootstrap.mjs'),dir=mkdtempSync(join(tmpdir(),'owner-policy-'));
  const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
  try {
    const template=run('--template'); assert.equal(template.status,0);assert.equal(JSON.parse(template.stdout).treasury,null);
    const report=run();assert.equal(report.status,2);assert.equal(JSON.parse(report.stdout).executionAuthorized,false);
    const path=join(dir,'public.json');writeFileSync(path,JSON.stringify(copy(DEVNET_OWNER_POLICY)));
    const pending=run('--record',path);assert.equal(pending.status,2);assert.equal(JSON.parse(pending.stdout).declaredOwnerAcceptance,false);
    const invalid=accepted();invalid.secretKey='never-print-this-private-value';writeFileSync(path,JSON.stringify(invalid));
    const rejected=run('--record',path);assert.equal(rejected.status,1);assert.equal(rejected.stdout,'');assert(!rejected.stderr.includes(invalid.secretKey));
    assert.equal(run('--verify-empty').status,1);assert.equal(run('--template','--record',path).status,1);
    const alias=join(dir,'alias.json');symlinkSync(path,alias);assert.equal(run('--record',alias).status,1);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

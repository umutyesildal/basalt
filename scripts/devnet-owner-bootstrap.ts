/** Narrow devnet setup. Default plan never reads a signer, contacts RPC, or writes a file. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { open, lstat, realpath, mkdir, rename, rm, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction, TransactionMessage,
  type AccountInfo, type Context, type SignatureStatus } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, unpackMint, unpackAccount, getScaledUiAmountConfig } from "@solana/spl-token";
import { DEVNET_OWNER_NAMESPACE, DEVNET_GENESIS_HASH, validateNamespaceRegistry, type ProgramNamespace } from "../backend/src/config/programNamespaces.js";
import { DEVNET_MOCK_TOKENS, DEVNET_FAUCET_PROGRAM_ID, DEVNET_FAUCET_CLAIM_RAW, deriveDevnetFaucetAuthority, deriveDevnetFaucetVault } from "../app/lib/devnet-faucet.js";
import { assertFixtureMint } from "./xstocks-devnet/profile.js";
import { validateSbfElf } from "./verifyXStocksDeployment.js";
import { authenticateWhitelistedMint } from "../backend/src/indexer/whitelistSync.js";
import { assertNotRetiredPublicKey } from "./security/retired-keys.mjs";
import { DEVNET_OWNER_POLICY, validateDevnetOwnerBootstrapRecord } from "./security/devnet-owner-bootstrap.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
export const MAX_SPEND_LAMPORTS = 20_000_000;
export const MAX_FEE_LAMPORTS = 100_000;
export const MIN_RESERVE_LAMPORTS = 1_000_000;
export const ROLES = ["whitelist", "basket_factory", "basket"] as const;
type Role = typeof ROLES[number];
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const disc = (kind: "global" | "account", name: string) => createHash("sha256").update(`${kind}:${name}`).digest().subarray(0,8);
const fail = (reason: string): never => { throw new Error(reason); };
function requireThat(value: unknown, reason: string): asserts value { if (!value) fail(reason); }
const key = (value: unknown): PublicKey => {
  requireThat(typeof value === "string", "Invalid public identity");
  const result = new PublicKey(value);
  requireThat(result.toBase58() === value && !result.equals(PublicKey.default), "Invalid public identity");
  assertNotRetiredPublicKey(result,"devnet bootstrap public role");
  return result;
};
const pda = (seed: string, program: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from(seed)],program);
export const programData = (program: PublicKey) => PublicKey.findProgramAddressSync([program.toBuffer()],LOADER)[0];

export interface OwnerManifest {
  version:1; mode:"devnet-owner-bootstrap-preparation"; cluster:"devnet"; genesisHash:string;
  owner:string; treasury:string|null; bootstrapAuthority:string;
  programIds:Record<Role,string>; ownerRoleAcceptance:"pending"|"accepted";
  sourceCommit?:string|null; releaseTag?:string|null; treasuryAcceptance?:"pending"|"accepted"; ownerAcceptanceReference?:string|null;
  governance:{kind:"single-owner-devnet-only";multisig:false;productionApproval:false}; deploymentExecuted:boolean;
}
export interface DeploymentProof {
  version:1; mode:"devnet-owner-deployment-proof"; cluster:"devnet"; genesisHash:string;
  sourceCommit:string; feature:"owner-devnet"; bootstrapAuthority:string; owner:string;
  programs:Record<Role,{programId:string;programData:string;elfSha256:string;elfBytes:number;deployedSlot?:string}>;
}
export interface BootstrapPlan {
  manifest:OwnerManifest; manifestHash:string; namespace:ProgramNamespace; sourceCommit:string;
  blocked:string[]; steps:string[]; maximumSpendLamports:number; instructionCount:7;
}
function exactFields(value:unknown, fields:string[], label:string):asserts value is Record<string,unknown> {
  requireThat(value && typeof value === "object" && !Array.isArray(value),`Invalid ${label}`);
  requireThat(Object.keys(value).sort().join() === [...fields].sort().join(),`Unexpected ${label} fields`);
}
/** The CLI always uses source-pinned public roles; injection exists only for isolated tests. */
export function createBootstrapPlan(value:unknown,sourceCommit:string,internal:{namespaces?:readonly ProgramNamespace[];policy?:OwnerManifest}={}):BootstrapPlan {
  const base=["version","mode","cluster","genesisHash","owner","treasury","bootstrapAuthority","programIds","ownerRoleAcceptance","governance","deploymentExecuted"];
  const optional=["sourceCommit","releaseTag","treasuryAcceptance","ownerAcceptanceReference"];
  requireThat(value && typeof value==="object" && !Array.isArray(value),"Invalid public manifest");
  exactFields(value,[...base,...optional.filter(field=>Object.hasOwn(value,field))],"public manifest");
  requireThat(/^[a-f0-9]{40}$/.test(sourceCommit),"Exact source commit required");
  const validation=validateDevnetOwnerBootstrapRecord(value,{policy:internal.policy??DEVNET_OWNER_POLICY});
  requireThat(value.sourceCommit==null || value.sourceCommit===sourceCommit,"Public review source differs from exact checkout");
  const owner=key(value.owner),bootstrap=key(value.bootstrapAuthority);
  requireThat(PublicKey.isOnCurve(owner.toBytes()) && PublicKey.isOnCurve(bootstrap.toBytes()) && !owner.equals(bootstrap),"Distinct owner and fresh bootstrap signer required");
  if(value.treasury!==null)key(value.treasury);
  const ids=value.programIds as Record<Role,string>;
  exactFields(ids,[...ROLES],"program roles");
  ROLES.forEach(role=>key(ids[role]));
  const namespace=validateNamespaceRegistry(internal.namespaces??[DEVNET_OWNER_NAMESPACE]).find(entry=>entry.id==="devnet-owner-v1" && entry.programs.whitelist===ids.whitelist && entry.programs.factory===ids.basket_factory && entry.programs.basket===ids.basket);
  requireThat(namespace,"Owner program trio is not registered");
  requireThat(!namespace.creation.enabled,"Bootstrap requires creation to remain disabled");
  const manifest=value as unknown as OwnerManifest;
  const blocked=validation.missingInputs.map((field:string)=>`Public review prerequisite pending: ${field}`);
  return {manifest,manifestHash:hash(JSON.stringify(manifest)),namespace,sourceCommit,blocked,
    steps:["init-whitelist","init-factory",...DEVNET_MOCK_TOKENS.map(token=>`admit-${token.symbol}`),"propose-whitelist-owner"],
    maximumSpendLamports:MAX_SPEND_LAMPORTS,instructionCount:7};
}
export function validateDeploymentProof(value:unknown,plan:BootstrapPlan):DeploymentProof {
  exactFields(value,["version","mode","cluster","genesisHash","sourceCommit","feature","bootstrapAuthority","owner","programs"],"deployment proof");
  requireThat(value.version===1 && value.mode==="devnet-owner-deployment-proof" && value.cluster==="devnet" && value.genesisHash===DEVNET_GENESIS_HASH && value.feature==="owner-devnet","Invalid deployment proof mode");
  requireThat(value.sourceCommit===plan.sourceCommit && value.bootstrapAuthority===plan.manifest.bootstrapAuthority && value.owner===plan.manifest.owner,"Deployment proof source/authority mismatch");
  exactFields(value.programs,[...ROLES],"deployed programs");
  for(const role of ROLES){
    const artifact=value.programs[role] as Record<string,unknown>;
    exactFields(artifact,["programId","programData","elfSha256","elfBytes",...(artifact?.deployedSlot===undefined?[]:["deployedSlot"])],"program artifact");
    requireThat(artifact.programId===plan.manifest.programIds[role] && artifact.programData===programData(new PublicKey(artifact.programId)).toBase58(),"Deployment role/PDA mismatch");
    requireThat(typeof artifact.elfSha256==="string" && /^[a-f0-9]{64}$/.test(artifact.elfSha256) && Number.isSafeInteger(artifact.elfBytes) && Number(artifact.elfBytes)>=1_024 && Number(artifact.elfBytes)<=2_000_000,"Invalid ELF size/digest");
    if(artifact.deployedSlot!==undefined)requireThat(typeof artifact.deployedSlot==="string" && /^(0|[1-9]\d*)$/.test(artifact.deployedSlot),"Invalid deployed slot");
  }
  return value as unknown as DeploymentProof;
}
const meta=(pubkey:PublicKey,isWritable=false,isSigner=false)=>({pubkey,isWritable,isSigner});
/** Namespace-parametric exact wire builders; no legacy constants or transfer of tokens. */
export function buildBootstrapInstruction(plan:BootstrapPlan,step:string):TransactionInstruction {
  requireThat(plan.blocked.length===0 && plan.steps.includes(step),"Bootstrap plan is blocked or step unknown");
  const authority=new PublicKey(plan.manifest.bootstrapAuthority),whitelist=new PublicKey(plan.namespace.programs.whitelist),factory=new PublicKey(plan.namespace.programs.factory);
  const config=new PublicKey(plan.namespace.whitelistConfig),factoryConfig=new PublicKey(plan.namespace.factoryConfig);
  if(step==="init-whitelist" || step==="init-factory"){
    const isFactory=step==="init-factory",program=isFactory?factory:whitelist;
    const split=Buffer.alloc(2);split.writeUInt16LE(9000);
    return new TransactionInstruction({programId:program,keys:[meta(isFactory?factoryConfig:config,true),meta(authority,true,true),meta(SystemProgram.programId),meta(program),meta(programData(program))],
      data:isFactory?Buffer.concat([disc("global","init_factory"),new PublicKey(plan.manifest.treasury!).toBuffer(),split]):disc("global","init_config")});
  }
  if(step==="propose-whitelist-owner")return new TransactionInstruction({programId:whitelist,keys:[meta(config,true),meta(authority,false,true)],data:Buffer.concat([disc("global","transfer_authority"),new PublicKey(plan.manifest.owner).toBuffer()])});
  const token=DEVNET_MOCK_TOKENS.find(token=>step===`admit-${token.symbol}`);
  requireThat(token,"Only the four existing faucet mocks may be admitted");
  const source=Buffer.from(`mock:${token.symbol}`),length=Buffer.alloc(4);length.writeUInt32LE(source.length);
  const address=PublicKey.findProgramAddressSync([Buffer.from("mint"),token.mint.toBuffer()],whitelist)[0];
  return new TransactionInstruction({programId:whitelist,keys:[meta(config,true),meta(authority,true,true),meta(token.mint),meta(address,true),meta(SystemProgram.programId)],data:Buffer.concat([disc("global","add_mint"),Buffer.from([token.decimals]),length,source])});
}

type Info=AccountInfo<Buffer>|null;
export interface BootstrapRpc {
  getGenesisHash():Promise<string>;
  getMultipleAccountsInfoAndContext(keys:PublicKey[],config:{commitment:"finalized";minContextSlot?:number}):Promise<{context:Context;value:Info[]}>;
  getBalance(key:PublicKey,commitment:"finalized"):Promise<number>;
  getMinimumBalanceForRentExemption(bytes:number,commitment:"finalized"):Promise<number>;
  getLatestBlockhash(commitment:"finalized"):Promise<{blockhash:string;lastValidBlockHeight:number}>;
  getFeeForMessage(message:VersionedTransaction["message"],commitment:"finalized"):Promise<{value:number|null}>;
  simulateTransaction(tx:VersionedTransaction,config:{sigVerify:true;commitment:"finalized";minContextSlot:number}):Promise<{value:{err:unknown;unitsConsumed?:number}}>
  sendRawTransaction(bytes:Uint8Array,options:{skipPreflight:false;maxRetries:0;preflightCommitment:"finalized";minContextSlot:number}):Promise<string>;
  getSignatureStatuses(signatures:string[],options:{searchTransactionHistory:true}):Promise<{value:Array<SignatureStatus|null>}>;
}
function account(info:Info,owner:PublicKey,executable:boolean):AccountInfo<Buffer>{
  requireThat(info && info.owner.equals(owner) && info.executable===executable,"Account owner/executable mismatch");return info;
}
export function verifyDeployedBytes(programInfo:Info,dataInfo:Info,artifact:DeploymentProof["programs"][Role],authority:string):void {
  const program=account(programInfo,LOADER,true).data,data=account(dataInfo,LOADER,false).data;
  requireThat(program.length===36 && program.readUInt32LE(0)===2 && new PublicKey(program.subarray(4)).toBase58()===artifact.programData,"Invalid canonical program pointer");
  requireThat(data.length>=45+artifact.elfBytes && data.readUInt32LE(0)===3 && data[12]===1 && new PublicKey(data.subarray(13,45)).toBase58()===authority,"Loader authority/layout mismatch");
  if(artifact.deployedSlot!==undefined)requireThat(data.readBigUInt64LE(4).toString()===artifact.deployedSlot,"Loader deployed slot mismatch");
  const elf=data.subarray(45,45+artifact.elfBytes);
  validateSbfElf(elf);
  requireThat(hash(elf)===artifact.elfSha256 && data.subarray(45+artifact.elfBytes).every(byte=>byte===0),"Deployed ELF bytes/padding differ from source-bound artifact");
}
export function verifyFaucetMocks(infos:Info[]):void {
  requireThat(infos.length===9,"Incomplete faucet/mint batch");account(infos[0],LOADER,true);
  for(let i=0;i<4;i++){
    const token=DEVNET_MOCK_TOKENS[i],mintInfo=account(infos[1+i*2],TOKEN_2022_PROGRAM_ID,false),vaultInfo=account(infos[2+i*2],TOKEN_2022_PROGRAM_ID,false);
    const mint=unpackMint(token.mint,mintInfo,TOKEN_2022_PROGRAM_ID);
    requireThat(mint.mintAuthority,"Mock mint authority missing");assertFixtureMint(mint,mint.mintAuthority);
    const scale=getScaledUiAmountConfig(mint);
    requireThat(scale?.multiplier===token.multiplier && scale.newMultiplier===token.multiplier,"Mock multiplier changed");
    const vault=unpackAccount(deriveDevnetFaucetVault(token.mint),vaultInfo,TOKEN_2022_PROGRAM_ID);
    requireThat(vault.isInitialized && !vault.isFrozen && vault.owner.equals(deriveDevnetFaucetAuthority()) && vault.mint.equals(token.mint) && vault.amount>=DEVNET_FAUCET_CLAIM_RAW,"Faucet mock vault is not ready");
  }
}
function readWhitelist(info:Info,plan:BootstrapPlan):{authority:string;pending:string|null;count:number}|null {
  if(!info)return null;
  const data=account(info,new PublicKey(plan.namespace.programs.whitelist),false).data;
  requireThat(data.length===78 && data.subarray(0,8).equals(disc("account","WhitelistConfig")) && [0,1].includes(data[40]),"Invalid whitelist config layout");
  const offset=data[40]===1?73:41;
  const bump=pda("config",new PublicKey(plan.namespace.programs.whitelist))[1];
  requireThat(data[offset+4]===bump,"Invalid whitelist config bump");
  const authority=new PublicKey(data.subarray(8,40)).toBase58(),pending=data[40]===1?new PublicKey(data.subarray(41,73)).toBase58():null,count=data.readUInt32LE(offset);
  requireThat([plan.manifest.bootstrapAuthority,plan.manifest.owner].includes(authority) && (pending===null || pending===plan.manifest.owner) && count<=4,"Unexpected whitelist authority/count");
  return {authority,pending,count};
}
function verifyFactory(info:Info,plan:BootstrapPlan):boolean {
  if(!info)return false;
  const data=account(info,new PublicKey(plan.namespace.programs.factory),false).data;
  requireThat(data.length===89 && data.subarray(0,8).equals(disc("account","FactoryConfig")) && new PublicKey(data.subarray(8,40)).toBase58()===plan.manifest.bootstrapAuthority && new PublicKey(data.subarray(40,72)).toBase58()===plan.manifest.treasury,"Factory authority/treasury/layout mismatch");
  requireThat(data.readUInt16LE(72)===9000 && data.readUInt16LE(74)===300 && data.readUInt16LE(76)===100 && data.readUInt16LE(78)===300 && data.readBigUInt64LE(80)===0n && data[88]===pda("factory",new PublicKey(plan.namespace.programs.factory))[1],"Factory caps/counter/bump mismatch");
  return true;
}
export interface BootstrapState { slot:number; satisfied:Set<string>; missingRentBytes:number[]; whitelistAuthority:string|null; pendingOwner:string|null }
export async function readBootstrapState(rpc:BootstrapRpc,plan:BootstrapPlan,proof:DeploymentProof,minContextSlot=0):Promise<BootstrapState>{
  requireThat(await rpc.getGenesisHash()===DEVNET_GENESIS_HASH,"Refusing non-devnet genesis");
  const artifacts=ROLES.map(role=>proof.programs[role]);
  const admissions=DEVNET_MOCK_TOKENS.map(token=>PublicKey.findProgramAddressSync([Buffer.from("mint"),token.mint.toBuffer()],new PublicKey(plan.namespace.programs.whitelist))[0]);
  const keys=[...artifacts.map(a=>new PublicKey(a.programId)),...artifacts.map(a=>new PublicKey(a.programData)),new PublicKey(plan.namespace.whitelistConfig),new PublicKey(plan.namespace.factoryConfig),...admissions,DEVNET_FAUCET_PROGRAM_ID,...DEVNET_MOCK_TOKENS.flatMap(token=>[token.mint,deriveDevnetFaucetVault(token.mint)])];
  const batch=await rpc.getMultipleAccountsInfoAndContext(keys,{commitment:"finalized",minContextSlot});
  requireThat(Number.isSafeInteger(batch.context.slot) && batch.context.slot>=minContextSlot && batch.value.length===keys.length,"Incomplete/regressing finalized bootstrap state");
  artifacts.forEach((a,i)=>verifyDeployedBytes(batch.value[i],batch.value[i+3],a,plan.manifest.bootstrapAuthority));
  verifyFaucetMocks(batch.value.slice(12));
  const config=readWhitelist(batch.value[6],plan),factory=verifyFactory(batch.value[7],plan),satisfied=new Set<string>(),missingRentBytes:number[]=[];
  if(config)satisfied.add("init-whitelist");else missingRentBytes.push(78);
  if(factory)satisfied.add("init-factory");else missingRentBytes.push(89);
  let count=0;
  DEVNET_MOCK_TOKENS.forEach((token,i)=>{
    const info=batch.value[8+i];
    if(!info){missingRentBytes.push(119);return;}
    const decoded=authenticateWhitelistedMint(admissions[i],info,plan.namespace);
    requireThat(decoded.mint===token.mint.toBase58() && decoded.decimals===8 && decoded.status==="Active" && decoded.priceSource===`mock:${token.symbol}`,"Existing admission differs from fixed mock plan");
    satisfied.add(`admit-${token.symbol}`);count++;
  });
  requireThat((config?.count??0)===count,"Whitelist count differs from the four permitted admissions");
  if(config && (config.pending===plan.manifest.owner || config.authority===plan.manifest.owner)){
    requireThat(count===4 && factory,"Owner handoff preceded complete setup");satisfied.add("propose-whitelist-owner");
  }
  return {slot:batch.context.slot,satisfied,missingRentBytes,whitelistAuthority:config?.authority??null,pendingOwner:config?.pending??null};
}

export interface Receipt {signature:string;wireSha256:string;lastValidBlockHeight:number;status:"prepared"|"finalized";feeLamports:number}
export interface Journal {version:1;manifestHash:string;proofHash:string;sourceCommit:string;bootstrapAuthority:string;initialBalance:number;spentBudget:number;steps:Record<string,Receipt>}
export interface JournalStore {read():Promise<Journal|null>;write(value:Journal):Promise<void>}
export async function executeBootstrap(options:{plan:BootstrapPlan;proof:DeploymentProof;rpc:BootstrapRpc;store:JournalStore;loadSigner:()=>Promise<Keypair>;sleep?:(ms:number)=>Promise<void>;now?:()=>number}):Promise<Journal>{
  const {plan,rpc,store}=options,proof=validateDeploymentProof(options.proof,plan),now=options.now??Date.now,sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  requireThat(plan.blocked.length===0,"Owner acceptance and clean treasury are required before execution");
  const deadline=now()+180_000,checkDeadline=()=>requireThat(now()<deadline,"Bootstrap deadline exhausted; inspect same-signature receipts before retry");
  let state=await readBootstrapState(rpc,plan,proof),balance=await rpc.getBalance(new PublicKey(plan.manifest.bootstrapAuthority),"finalized");
  const proofHash=hash(JSON.stringify(proof));
  let journal=await store.read();
  if(journal){
    requireThat(journal.version===1 && journal.manifestHash===plan.manifestHash && journal.proofHash===proofHash && journal.sourceCommit===plan.sourceCommit && journal.bootstrapAuthority===plan.manifest.bootstrapAuthority,"Private run identity differs from reviewed source/manifest/proof");
    requireThat(Number.isSafeInteger(journal.initialBalance) && Number.isSafeInteger(journal.spentBudget) && journal.spentBudget>=0 && journal.spentBudget<=MAX_SPEND_LAMPORTS && Object.keys(journal.steps).every(step=>plan.steps.includes(step)),"Invalid private budget/step record");
  }else{
    journal={version:1,manifestHash:plan.manifestHash,proofHash,sourceCommit:plan.sourceCommit,bootstrapAuthority:plan.manifest.bootstrapAuthority,initialBalance:balance,spentBudget:0,steps:{}};
    await store.write(journal);
  }
  let rent=0;
  for(const bytes of state.missingRentBytes){const value=await rpc.getMinimumBalanceForRentExemption(bytes,"finalized");requireThat(Number.isSafeInteger(value)&&value>0,"Invalid rent estimate");rent+=value;}
  const remainingSteps=plan.steps.filter(step=>!state.satisfied.has(step));
  requireThat(rent+remainingSteps.length*MAX_FEE_LAMPORTS+journal.spentBudget<=MAX_SPEND_LAMPORTS,"Required rent/fee budget exceeds 0.02 SOL cap");
  requireThat(Number.isSafeInteger(balance) && balance>=rent+remainingSteps.length*MAX_FEE_LAMPORTS+MIN_RESERVE_LAMPORTS && journal.initialBalance-balance<=MAX_SPEND_LAMPORTS,"Insufficient bootstrap balance or spend cap exceeded");
  let signer:Keypair|undefined;
  for(const step of plan.steps){
    checkDeadline();
    const prior=journal.steps[step];
    if(prior){
      requireThat(typeof prior.signature==="string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(prior.signature),"Invalid prior signature receipt");
      const status=(await rpc.getSignatureStatuses([prior.signature],{searchTransactionHistory:true})).value[0];
      requireThat(status?.confirmationStatus==="finalized" && status.err===null,"Prior submission is failed or ambiguous; never replay or replace it");
      requireThat(state.satisfied.has(step),"Finalized receipt does not match current canonical state");
      if(prior.status!=="finalized"){journal.steps[step]={...prior,status:"finalized"};await store.write(journal);}continue;
    }
    if(state.satisfied.has(step))continue;
    requireThat(step==="init-whitelist" || state.whitelistAuthority===plan.manifest.bootstrapAuthority,"Bootstrap signer no longer holds whitelist initialization authority");
    if(!signer){signer=await options.loadSigner();requireThat(signer.publicKey.toBase58()===plan.manifest.bootstrapAuthority,"Fresh bootstrap signer identity mismatch");}
    const ix=buildBootstrapInstruction(plan,step),latest=await rpc.getLatestBlockhash("finalized");
    requireThat(typeof latest.blockhash==="string" && new PublicKey(latest.blockhash).toBase58()===latest.blockhash && Number.isSafeInteger(latest.lastValidBlockHeight) && latest.lastValidBlockHeight>0,"Invalid finalized blockhash evidence");
    const tx=new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,recentBlockhash:latest.blockhash,instructions:[ix]}).compileToV0Message());
    tx.sign([signer]);
    const fee=(await rpc.getFeeForMessage(tx.message,"finalized")).value;
    requireThat(Number.isSafeInteger(fee) && fee!>0 && fee!<=MAX_FEE_LAMPORTS,"Transaction fee estimate is unavailable or exceeds cap");
    const simulation=await rpc.simulateTransaction(tx,{sigVerify:true,commitment:"finalized",minContextSlot:state.slot});
    requireThat(simulation.value.err===null,"Bootstrap simulation failed; no transaction submitted");
    state=await readBootstrapState(rpc,plan,proof,state.slot);
    requireThat(!state.satisfied.has(step),"State advanced after simulation; rerun read-only checks before signing another transaction");
    const raw=tx.serialize(),signature=(await import("bs58")).default.encode(tx.signatures[0]);
    const targetRent=step==="init-whitelist"?78:step==="init-factory"?89:step.startsWith("admit-")?119:0;
    const reserve=targetRent?await rpc.getMinimumBalanceForRentExemption(targetRent,"finalized"):0;
    requireThat(Number.isSafeInteger(reserve) && (targetRent?reserve>0:reserve===0),"Invalid per-step rent estimate");
    requireThat(journal.spentBudget+reserve+fee!<=MAX_SPEND_LAMPORTS,"Per-step cumulative spend cap exceeded");
    journal.spentBudget+=reserve+fee!;
    journal.steps[step]={signature,wireSha256:hash(raw),lastValidBlockHeight:latest.lastValidBlockHeight,status:"prepared",feeLamports:fee!};
    await store.write(journal); // durable signature is recorded BEFORE the only submission attempt
    checkDeadline();
    const returned=await rpc.sendRawTransaction(raw,{skipPreflight:false,maxRetries:0,preflightCommitment:"finalized",minContextSlot:state.slot});
    requireThat(returned===signature,"RPC submission identity mismatch; inspect persisted signature, never resend");
    const confirmDeadline=Math.min(deadline,now()+45_000);
    let finalized=false;
    while(now()<confirmDeadline){
      const status=(await rpc.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
      if(status?.err)fail("Submitted transaction failed; inspect persisted signature, never resend");
      if(status?.confirmationStatus==="finalized"){finalized=true;break;}await sleep(1_000);
    }
    requireThat(finalized,"Submission confirmation is ambiguous; persisted signature must be inspected, never resent");
    state=await readBootstrapState(rpc,plan,proof,state.slot);
    requireThat(state.satisfied.has(step),"Finalized transaction state did not match the reviewed step");
    journal.steps[step].status="finalized";await store.write(journal);
    balance=await rpc.getBalance(signer.publicKey,"finalized");
    requireThat(journal.initialBalance-balance<=MAX_SPEND_LAMPORTS && balance>=MIN_RESERVE_LAMPORTS,"Post-step spend/reserve guard failed");
  }
  requireThat(plan.steps.every(step=>state.satisfied.has(step)),"Incomplete setup; creation remains disabled");
  return journal;
}

async function privateFile(path:string,limit:number):Promise<Buffer>{
  const stat=await lstat(path);requireThat(stat.isFile()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o077)===0&&stat.size<=limit,"Private run file ownership/mode/size invalid");
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const actual=await handle.stat();requireThat(actual.ino===stat.ino&&actual.dev===stat.dev,"Private file changed during open");return await handle.readFile();}finally{await handle.close();}
}
/** Durable private receipt. Atomic rename + fsync precede any authorized submission. */
export async function openPrivateRun(runDir:string):Promise<{store:JournalStore;close:()=>Promise<void>;loadSigner:()=>Promise<Keypair>}>{
  const directory=resolve(runDir),stat=await lstat(directory);
  requireThat(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid?.()&&(stat.mode&0o077)===0&&await realpath(directory)===directory,"Run directory must be owned, real and mode0700");
  requireThat(!directory.startsWith(resolve(ROOT)+"/") && /^basalt-devnet-owner-[a-zA-Z0-9_-]{8,80}$/.test(directory.split("/").at(-1)!),"Use a dedicated private bootstrap directory outside the repository");
  const lock=join(directory,".operator-lock");await mkdir(lock,{mode:0o700});
  const path=join(directory,"bootstrap-receipt.json");
  return {store:{async read(){try{return JSON.parse((await privateFile(path,128_000)).toString("utf8"));}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}},
    async write(value){const temporary=join(directory,`.receipt-${process.pid}-${Date.now()}.tmp`),handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
      await rename(temporary,path);const dir=await open(directory,constants.O_RDONLY);try{await dir.sync();}finally{await dir.close();}}},
    close:()=>rm(lock,{recursive:true}),async loadSigner(){const bytes=JSON.parse((await privateFile(join(directory,"bootstrap.json"),4_096)).toString("utf8"));
      requireThat(Array.isArray(bytes)&&bytes.length===64&&bytes.every(value=>Number.isInteger(value)&&value>=0&&value<=255),"Expected only the fresh 64-byte bootstrap signer");return Keypair.fromSecretKey(Uint8Array.from(bytes));}};
}
function boundedFetch():typeof fetch{
  let requests=0;
  return (async(input,init)=>{
    requireThat(++requests<=200,"Operator request budget exceeded");
    const method=JSON.parse(String(init?.body)).method;
    requireThat(["getGenesisHash","getMultipleAccounts","getBalance","getMinimumBalanceForRentExemption","getLatestBlockhash","getFeeForMessage","simulateTransaction","sendTransaction","getSignatureStatuses"].includes(method),"Unapproved operator RPC method");
    const response=await fetch(input,{...init,redirect:"error",signal:AbortSignal.timeout(12_000)});
    requireThat(response.ok,"Operator RPC unavailable");
    const chunks:Uint8Array[]=[],reader=response.body?.getReader();let size=0;
    requireThat(reader,"Empty operator RPC response");
    try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;requireThat(size<=16*1024*1024,"Operator RPC response exceeds cap");chunks.push(chunk.value);}}finally{await reader.cancel();}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
  }) as typeof fetch;
}
export async function main(args=process.argv.slice(2)):Promise<unknown>{
  const {values}=parseArgs({args,strict:true,options:{manifest:{type:"string"},"deployment-proof":{type:"string"},execute:{type:"boolean",default:false},"run-dir":{type:"string"},"rpc-url":{type:"string"},help:{type:"boolean"}}});
  if(values.help){console.log("Default offline: npx tsx scripts/devnet-owner-bootstrap.ts --manifest <public-planner-record.json>\nPublic record must bind exact sourceCommit/releaseTag and source-pinned owner/bootstrap/trio, accepted ownerRoleAcceptance and treasuryAcceptance, and a public ownerAcceptanceReference. Declarations alone are not wallet-control proof. Explicit later setup: add --execute --deployment-proof <source-bound-public-proof.json> --run-dir <owned0700 basalt-devnet-owner-* outside repo>. Only run-dir/bootstrap.json may supply the fresh bootstrap signer. No airdrop, deployment, owner signature, loader handoff or creation enablement. Receipts persist before one send; ambiguous receipts are never resent. A crash-held .operator-lock requires human process/state inspection before removal.");return;}
  const manifest=JSON.parse(await readFile(values.manifest??join(ROOT,"backend/src/config/devnetOwnerPolicy.json"),"utf8"));
  const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{cwd:ROOT,encoding:"utf8"}).trim(),plan=createBootstrapPlan(manifest,sourceCommit);
  if(!values.execute){const output={mode:"offline-plan",sourceCommit,manifestHash:plan.manifestHash,namespace:plan.namespace.id,owner:manifest.owner,treasury:manifest.treasury,bootstrapAuthority:manifest.bootstrapAuthority,programIds:manifest.programIds,steps:plan.steps,blocked:plan.blocked,maximumSpendLamports:MAX_SPEND_LAMPORTS,executionAuthorized:false,creationEnabled:false};console.log(JSON.stringify(output,null,2));return output;}
  requireThat(values["deployment-proof"]&&values["run-dir"]&&plan.blocked.length===0,"Execute requires accepted public roles, proof and private run directory");
  requireThat(execFileSync("git",["status","--porcelain=v1","--untracked-files=all"],{cwd:ROOT,encoding:"utf8"}).trim()==="","Execution requires the exact clean committed source");
  const proof=validateDeploymentProof(JSON.parse(await readFile(values["deployment-proof"],"utf8")),plan),url=new URL(values["rpc-url"]??"https://api.devnet.solana.com");
  requireThat(url.protocol==="https:"&&!url.username&&!url.password,"HTTPS devnet RPC required");
  const rpc=new Connection(url.href,{commitment:"finalized",disableRetryOnRateLimit:true,fetch:boundedFetch()}),run=await openPrivateRun(values["run-dir"]);
  try{const journal=await executeBootstrap({plan,proof,rpc,store:run.store,loadSigner:run.loadSigner});const receipt={mode:"devnet-owner-setup",sourceCommit,namespace:plan.namespace.id,owner:manifest.owner,treasury:manifest.treasury,steps:journal.steps,whitelistOwnerClaimExecuted:false,loaderHandoffExecuted:false,creationEnabled:false};console.log(JSON.stringify(receipt,null,2));return receipt;}finally{await run.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error("Devnet owner bootstrap stopped. Inspect private receipts and public prerequisites; no automatic resend.");process.exitCode=1;});

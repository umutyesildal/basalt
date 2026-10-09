/**
 * indexer/whitelistSync.ts — on-chain WhitelistedMint account indexer.
 *
 * Each registered whitelist program stores one WhitelistedMint PDA per
 * accepted mint, carrying `price_source` (e.g. "mock:tsla" on devnet,
 * "jupiter:TSLAx" on mainnet) — the label the NAV engine's mock-price fill
 * (workers/mockPriceFill.ts) and Jupiter pricing resolve against. Without this
 * sync the `whitelisted_mints` table stays empty and pricing has no labels.
 *
 * Account layout (programs/whitelist/src/lib.rs `#[account] WhitelistedMint`):
 *   disc(8) | mint(32) | decimals(1) | multiplier_watermark(8) | status(1) |
 *   price_source: String(4 + N) | bump(1)
 *
 * SAFETY: strictly read-only against RPC (AGENTS.md §2 #5). Owner, canonical
 * PDA, bump and metadata authenticate namespace membership. Any invalid account
 * or failed sweep invalidates that namespace until a newer verified refresh.
 */
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import bs58 from "bs58";
import { isPgLike, withTransaction, type PgLike } from "../db/client.js";
import { PROGRAM_NAMESPACES, validateNamespaceRegistry, namespaceForProgram, type ProgramNamespace } from "../config/programNamespaces.js";
import { withRpcBackoff } from "../rpc/backoff.js";

/** sha256("account:WhitelistedMint")[0..8] — Anchor account discriminator. */
export function whitelistedMintDiscriminator(): Buffer {
  return createHash("sha256").update("account:WhitelistedMint").digest().subarray(0, 8);
}

const WHITELISTED_MINT_DISC = whitelistedMintDiscriminator();

/** Fixed part after the discriminator: mint(32)+decimals(1)+watermark(8)+status(1). */
const FIXED_LEN = 32 + 1 + 8 + 1;

export interface DecodedWhitelistedMint {
  mint: string;
  decimals: number;
  /** Raw on-chain status byte (0 = Active, 1 = PausedNewMints). */
  statusRaw: number;
  /** Mapped schema value; undefined makes an authenticated sweep fail closed. */
  status?: "Active" | "PausedNewMints";
  priceSource: string;
}

/** Structural slice of @solana/web3.js Connection used here. */
export interface WhitelistRpc {
  getProgramAccounts(
    programId: PublicKey,
    config?: { filters?: Array<{ memcmp?: { offset: number; bytes: string }; dataSize?: number }>; commitment?: unknown },
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>>;
}

/** Decode one WhitelistedMint account buffer, or null when malformed. */
export function decodeWhitelistedMint(data: Buffer): DecodedWhitelistedMint | null {
  if (!data || data.length < 8 + FIXED_LEN + 4 + 1) return null; // disc+fixed+strLen+min 1-byte bump
  if (!data.subarray(0, 8).equals(WHITELISTED_MINT_DISC)) return null;
  try {
    const mint = new PublicKey(data.subarray(8, 40)).toBase58();
    const decimals = data.readUInt8(40);
    if (decimals > 12 || new PublicKey(mint).equals(PublicKey.default)) return null;
    const statusRaw = data.readUInt8(49);
    const srcLen = data.readUInt32LE(50);
    if (srcLen > 64) return null; // program caps price_source at 64 chars
    const end = 54 + srcLen;
    if (end + 1 > data.length) return null; // truncated string
    const sourceBytes = data.subarray(54, end);
    const priceSource = sourceBytes.toString("utf8");
    if (!Buffer.from(priceSource,"utf8").equals(sourceBytes) || /[\u0000-\u001f\u007f]/.test(priceSource)) return null;
    const decoded: DecodedWhitelistedMint = { mint, decimals, statusRaw, priceSource };
    if (statusRaw === 0) decoded.status = "Active";
    else if (statusRaw === 1) decoded.status = "PausedNewMints";
    return decoded;
  } catch {
    return null;
  }
}

/** Authenticate namespace membership independently of an RPC program filter. */
export function authenticateWhitelistedMint(pubkey: PublicKey, account: AccountInfo<Buffer>, namespace: ProgramNamespace): DecodedWhitelistedMint {
  const owner = new PublicKey(namespace.programs.whitelist);
  if (account.executable || !account.owner.equals(owner)) throw new Error("whitelist-account-owner-invalid");
  const decoded = decodeWhitelistedMint(account.data);
  if (!decoded?.status) throw new Error("whitelist-account-metadata-invalid");
  const [expected,bump] = PublicKey.findProgramAddressSync([Buffer.from("mint"),new PublicKey(decoded.mint).toBuffer()],owner);
  const bumpOffset = 54 + account.data.readUInt32LE(50);
  if (!pubkey.equals(expected) || account.data[bumpOffset] !== bump) throw new Error("whitelist-account-pda-invalid");
  return decoded;
}

async function publishWhitelist(db: PgLike, namespace: ProgramNamespace, attemptedAt: Date,
  rows: Array<{ pubkey: string; decoded: DecodedWhitelistedMint }> | null, reason: string | null): Promise<number> {
  return withTransaction(db,async client=>{
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`whitelist:${namespace.id}`]);
    const prior=(await client.query("SELECT attempted_at FROM namespace_whitelist_state WHERE namespace_id=$1 FOR UPDATE",[namespace.id])).rows[0];
    if(prior && (new Date(prior.attempted_at).getTime()>attemptedAt.getTime() || rows!==null && new Date(prior.attempted_at).getTime()===attemptedAt.getTime())) return 0;
    await client.query(`INSERT INTO namespace_whitelist_state(namespace_id,whitelist_program,attempted_at,observed_at,status,reason)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(namespace_id) DO UPDATE SET whitelist_program=EXCLUDED.whitelist_program,
      attempted_at=EXCLUDED.attempted_at,observed_at=CASE WHEN EXCLUDED.status='complete' THEN EXCLUDED.observed_at ELSE namespace_whitelist_state.observed_at END,
      status=EXCLUDED.status,reason=EXCLUDED.reason`,[namespace.id,namespace.programs.whitelist,attemptedAt,rows===null?null:attemptedAt,rows===null?"incomplete":"complete",reason]);
    await client.query(`UPDATE namespace_whitelisted_mints SET authenticated=false,attempted_at=$2,reason=$3 WHERE namespace_id=$1`,
      [namespace.id,attemptedAt,reason??"not-observed-in-current-sweep"]);
    for(const {pubkey,decoded} of rows??[]) {
      const legacy=namespace.id==="devnet-legacy-v1";
      await client.query(`INSERT INTO whitelisted_mints(mint,decimals,status,price_source) VALUES($1,$2,$3,$4)
        ON CONFLICT(mint) DO UPDATE SET decimals=CASE WHEN $5 THEN EXCLUDED.decimals ELSE whitelisted_mints.decimals END,
        status=CASE WHEN $5 THEN EXCLUDED.status ELSE whitelisted_mints.status END,
        price_source=CASE WHEN $5 THEN EXCLUDED.price_source ELSE whitelisted_mints.price_source END,
        updated_at=CASE WHEN $5 THEN $6 ELSE whitelisted_mints.updated_at END`,
        [decoded.mint,decoded.decimals,legacy?decoded.status:"PausedNewMints",legacy?decoded.priceSource:null,legacy,attemptedAt]);
      await client.query(`INSERT INTO namespace_whitelisted_mints(namespace_id,mint,whitelist_program,account_pubkey,decimals,status,price_source,authenticated,observed_at,attempted_at,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$8,NULL) ON CONFLICT(namespace_id,mint) DO UPDATE SET whitelist_program=EXCLUDED.whitelist_program,
        account_pubkey=EXCLUDED.account_pubkey,decimals=EXCLUDED.decimals,status=EXCLUDED.status,price_source=EXCLUDED.price_source,
        authenticated=true,observed_at=EXCLUDED.observed_at,attempted_at=EXCLUDED.attempted_at,reason=NULL`,
        [namespace.id,decoded.mint,namespace.programs.whitelist,pubkey,decoded.decimals,decoded.status,decoded.priceSource,attemptedAt]);
    }
    return rows?.length??0;
  });
}

/** Only fresh authenticated account bytes publish namespace admission. */
export async function syncWhitelistedMints(rpc: WhitelistRpc,programId: string,db: PgLike|null|undefined,
  options: {namespaces?: readonly ProgramNamespace[]; now?:()=>Date} = {}): Promise<number> {
  if(!isPgLike(db)) return 0;
  const match=namespaceForProgram(programId,validateNamespaceRegistry(options.namespaces??PROGRAM_NAMESPACES));
  if(!match || match.role!=="whitelist") throw new Error("Unregistered whitelist program");
  const attemptedAt=(options.now??(()=>new Date()))();
  let accounts: Awaited<ReturnType<WhitelistRpc["getProgramAccounts"]>>;
  try { accounts=await withRpcBackoff(()=>rpc.getProgramAccounts(new PublicKey(programId),{
    commitment:"finalized",filters:[{memcmp:{offset:0,bytes:bs58.encode(WHITELISTED_MINT_DISC)}}],
  }),{logKey:"whitelistSync:getProgramAccounts"}); }
  catch { await publishWhitelist(db,match.namespace,attemptedAt,null,"whitelist-rpc-unavailable"); throw new Error("whitelist-rpc-unavailable"); }
  if(!Array.isArray(accounts) || accounts.length>1_000) {
    await publishWhitelist(db,match.namespace,attemptedAt,null,"whitelist-account-limit"); throw new Error("whitelist-account-limit");
  }
  const rows:Array<{pubkey:string;decoded:DecodedWhitelistedMint}>=[],seen=new Set<string>();
  try {
    for(const {pubkey,account} of accounts){
      const decoded=authenticateWhitelistedMint(pubkey,account,match.namespace);
      if(seen.has(decoded.mint)) throw new Error("duplicate whitelist mint");
      seen.add(decoded.mint);rows.push({pubkey:pubkey.toBase58(),decoded});
    }
  } catch { await publishWhitelist(db,match.namespace,attemptedAt,null,"whitelist-authentication-failed"); throw new Error("whitelist-authentication-failed"); }
  try { return await publishWhitelist(db,match.namespace,attemptedAt,rows,null); }
  catch {
    await publishWhitelist(db,match.namespace,attemptedAt,null,"whitelist-persist-failed");
    throw new Error("whitelist-persist-failed");
  }
}

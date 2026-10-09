import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PublicKey, type AccountInfo, type Connection } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync } from "../lib/token-2022";
import { PROGRAMS } from "../lib/solana";
import { APP_NAMESPACE_ROUTING, namespacePrograms, type ProgramNamespace } from "../lib/program-namespaces";
import { TEST_NAMESPACE, TEST_ROUTING } from "./namespace-fixture";
import {
  DEVNET_GENESIS_HASH, DEVNET_MOCKS, decodeDevnetBasketAccount,
  readDevnetBasket, listDevnetBaskets, readDevnetWallet, scaledDevnetAmount,
  invalidateDevnetBasketCache, estimateDevnetAccruedSupply,
  hashDevnetBasketMetadata, saveDevnetBasketMetadata, loadDevnetBasketMetadata,
} from "../lib/devnet-baskets";

type Info = AccountInfo<Buffer>;
const wallet = new PublicKey(Buffer.alloc(32, 7));
const creator = new PublicKey(Buffer.alloc(32, 8));
const treasury = new PublicKey(Buffer.alloc(32, 9));
const zero = PublicKey.default;
function info(owner: PublicKey, data: Buffer, lamports = 1): Info { return { owner, data, executable: false, lamports }; }
function disc(name: string): Buffer { return createHash("sha256").update(`account:${name}`).digest().subarray(0, 8); }
function ata(owner: PublicKey, mint: PublicKey): PublicKey { return getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID); }
function mint(authority: PublicKey, decimals: number, supply: bigint, multiplier?: number): Info {
  const data = Buffer.alloc(multiplier === undefined ? 82 : 226);
  data.writeUInt32LE(1, 0); authority.toBuffer().copy(data, 4);
  data.writeBigUInt64LE(supply, 36); data[44] = decimals; data[45] = 1;
  if (multiplier !== undefined) {
    data[165] = 1; data.writeUInt16LE(25, 166); data.writeUInt16LE(56, 168);
    authority.toBuffer().copy(data, 170); data.writeDoubleLE(multiplier, 202);
    data.writeBigUInt64LE(0n, 210); data.writeDoubleLE(multiplier, 218);
  }
  return info(TOKEN_2022_PROGRAM_ID, data);
}
function token(owner: PublicKey, mintKey: PublicKey, amount: bigint): Info {
  const data = Buffer.alloc(165);
  mintKey.toBuffer().copy(data, 0); owner.toBuffer().copy(data, 32); data.writeBigUInt64LE(amount, 64); data[108] = 1;
  return info(TOKEN_2022_PROGRAM_ID, data);
}

function fixture(nonce = 42n, namespace: ProgramNamespace = APP_NAMESPACE_ROUTING.registry[0]) {
  const PROGRAMS = namespacePrograms(namespace);
  const [factory, factoryBump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], PROGRAMS.factory);
  const nonceBytes = Buffer.alloc(8); nonceBytes.writeBigUInt64LE(nonce);
  const [basket, basketBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonceBytes], PROGRAMS.factory);
  const [share] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), basket.toBuffer()], PROGRAMS.factory);
  const [authority, authorityBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), basket.toBuffer()], PROGRAMS.basket);
  const b = Buffer.alloc(888); disc("Basket").copy(b);
  factory.toBuffer().copy(b, 8); creator.toBuffer().copy(b, 40); treasury.toBuffer().copy(b, 72); share.toBuffer().copy(b, 104);
  b.writeBigUInt64LE(nonce, 136); b.writeBigInt64LE(1_700_000_000n, 144); b.writeBigInt64LE(1_700_000_000n, 152);
  Buffer.alloc(32, 1).copy(b, 160); b[192] = 4;
  DEVNET_MOCKS.forEach((mock, i) => { new PublicKey(mock.mint).toBuffer().copy(b, 193 + 32 * i); b.writeUInt16LE(2500, 833 + 2 * i); });
  b.writeUInt16LE(100, 873); b.writeUInt16LE(50, 875); b.writeUInt16LE(200, 877); b[879] = basketBump; b[880] = authorityBump;
  const f = Buffer.alloc(89); disc("FactoryConfig").copy(f); creator.toBuffer().copy(f, 8); treasury.toBuffer().copy(f, 40);
  f.writeUInt16LE(9000, 72); f.writeUInt16LE(300, 74); f.writeUInt16LE(100, 76); f.writeUInt16LE(300, 78); f[88] = factoryBump;
  const accounts = new Map<string, Info>([[basket.toBase58(), info(PROGRAMS.basket, b)], [factory.toBase58(), info(PROGRAMS.factory, f)],
    [share.toBase58(), mint(authority, 6, 10_000_000n)], [wallet.toBase58(), info(new PublicKey("11111111111111111111111111111111"), Buffer.alloc(0), 2_000_000_000)],
    [ata(wallet, share).toBase58(), token(wallet, share, 900_719_925_474_099_3n)]]);
  DEVNET_MOCKS.forEach((mock, i) => {
    const m = new PublicKey(mock.mint);
    const [whitelist, bump] = PublicKey.findProgramAddressSync([Buffer.from("mint"), m.toBuffer()], PROGRAMS.whitelist);
    const w = Buffer.alloc(123); disc("WhitelistedMint").copy(w); m.toBuffer().copy(w, 8); w[40] = 8; w[49] = i === 1 ? 1 : 0;
    const priceSource = Buffer.from(`mock:bstest${i}`); w.writeUInt32LE(priceSource.length, 50); priceSource.copy(w, 54); w[54 + priceSource.length] = bump;
    accounts.set(m.toBase58(), mint(creator, 8, 1_000_000_000_000_000n, mock.multiplier));
    accounts.set(whitelist.toBase58(), info(PROGRAMS.whitelist, w));
    accounts.set(ata(authority, m).toBase58(), token(authority, m, 900_719_925_474_099_3n + BigInt(i)));
    if (i !== 3) accounts.set(ata(wallet, m).toBase58(), token(wallet, m, 100_000_000_000n));
  });
  const calls = { genesis: 0, account: 0, batch: 0, program: 0 };
  const rpc = {
    getGenesisHash: async () => { calls.genesis += 1; return DEVNET_GENESIS_HASH; },
    getAccountInfo: async (key: PublicKey) => { calls.account += 1; return accounts.get(key.toBase58()) ?? null; },
    getMultipleAccountsInfo: async (keys: PublicKey[]) => { calls.batch += 1; return keys.map((key) => accounts.get(key.toBase58()) ?? null); },
    getProgramAccounts: async () => { calls.program += 1; return [{ pubkey: basket, account: accounts.get(basket.toBase58())! }]; },
  } as unknown as Pick<Connection, "getGenesisHash" | "getAccountInfo" | "getMultipleAccountsInfo" | "getProgramAccounts">;
  return { accounts, calls, rpc, basket, share, factory, authority, b };
}

test("fixed mock identities match the public fixture and omit invented market prices", () => {
  assert.deepEqual(DEVNET_MOCKS.map((m) => [m.symbol, m.decimals, m.multiplier]), [["BSTESTA", 8, 1], ["BSTESTB", 8, 1.25], ["BSTESTC", 8, 2], ["BSTESTD", 8, 10]]);
  assert.equal(new Set(DEVNET_MOCKS.map((m) => m.mint)).size, 4);
  for (const mock of DEVNET_MOCKS) assert.equal("priceUsd" in mock, false);
});

test("immutable decoder preserves u64 nonce and checks real factory/creator/share/vault PDA derivations", () => {
  const f = fixture(18_446_744_073_709_551_615n);
  const decoded = decodeDevnetBasketAccount(f.basket, f.accounts.get(f.basket.toBase58())!);
  assert.equal(decoded.detail.nonce, "18446744073709551615"); assert.equal(decoded.detail.share_mint, f.share.toBase58());
  assert.equal(decoded.vaultAuthority.toBase58(), f.authority.toBase58()); assert.deepEqual(decoded.detail.weights_bps, [2500, 2500, 2500, 2500]);
  assert.equal(decoded.managementFeeRemainder, 0n);
});

test("immutable decoder refuses substituted owner, discriminator, PDA, share mint and bumps", () => {
  const f = fixture(), original = f.accounts.get(f.basket.toBase58())!;
  assert.throws(() => decodeDevnetBasketAccount(f.basket, { ...original, owner: PROGRAMS.factory }), /owner/);
  assert.throws(() => decodeDevnetBasketAccount(wallet, original), /PDA/);
  assert.throws(() => decodeDevnetBasketAccount(f.basket, { ...original, data: original.data.subarray(0, 885) }), /layout/);
  for (const offset of [0, 104, 879, 880]) {
    const bad = Buffer.from(f.b); bad[offset] ^= 1;
    assert.throws(() => decodeDevnetBasketAccount(f.basket, { ...original, data: bad }), /discriminator|PDA/);
  }
});

test("immutable decoder refuses invalid composition, fees, metadata and remainder", () => {
  const f = fixture(), original = f.accounts.get(f.basket.toBase58())!;
  const mutations = [
    (b: Buffer) => { b[192] = 1; }, (b: Buffer) => { b.writeUInt16LE(2499, 833); },
    (b: Buffer) => { b.copy(b, 225, 193, 225); }, (b: Buffer) => { wallet.toBuffer().copy(b, 193); },
    (b: Buffer) => { b.writeUInt16LE(301, 873); }, (b: Buffer) => { b.fill(0, 160, 192); },
    (b: Buffer) => { b.writeUIntLE(315_360_000_000, 881, 5); },
  ];
  for (const mutate of mutations) { const bad = Buffer.from(f.b); mutate(bad); assert.throws(() => decodeDevnetBasketAccount(f.basket, { ...original, data: bad })); }
});

test("scaled display keeps raw quantities above Number precision exact and handles exponent notation", () => {
  assert.equal(scaledDevnetAmount(9_007_199_254_740_993n, 1.25, 8), "112589990.6842624125");
  assert.equal(scaledDevnetAmount(1n, 2, 8), "0.00000002");
  assert.equal(scaledDevnetAmount(100n, 1e-7, 8), "0.0000000000001");
  assert.equal(scaledDevnetAmount(1n, 1e20, 8), "1000000000000");
  assert.equal(scaledDevnetAmount(0n, 10, 8), "0");
  for (const multiplier of [0, -1, NaN, Infinity]) assert.throws(() => scaledDevnetAmount(1n, multiplier, 8));
});

test("wrong cluster fails before fixture account reads", async () => {
  const f = fixture(); f.rpc.getGenesisHash = async () => "mainnet";
  await assert.rejects(readDevnetBasket(f.rpc, f.basket, wallet), /Solana devnet/);
  assert.equal(f.calls.account, 0); assert.equal(f.calls.batch, 0);
});

test("fresh read batches actual raw supply and holdings, permits whitelist pause, and coalesces inflight requests", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([readDevnetBasket(f.rpc, f.basket, wallet), readDevnetBasket(f.rpc, f.basket, wallet)]);
  assert.equal(a.supply, "10000000"); assert.equal(a.shareBalance, "9007199254740993");
  assert.equal(a.detail.nav, null); assert.equal(a.detail.drift, null); assert.equal(a.detail.metadata_json, null);
  assert.equal(a.detail.holdings[0].raw_amount, "9007199254740993"); assert.equal(a.detail.holdings[1].scaled_amount, "112589990.684262425");
  assert.deepEqual(a.whitelistStatuses, ["Active", "PausedNewMints", "Active", "Active"]);
  assert.deepEqual(a.walletBalances[3], { mint: DEVNET_MOCKS[3].mint, rawAmount: "0", exists: false });
  assert.deepEqual(b, a); assert.deepEqual(f.calls, { genesis: 1, account: 1, batch: 1, program: 0 });
  await readDevnetBasket(f.rpc, f.basket, wallet); assert.equal(f.calls.batch, 1);
  invalidateDevnetBasketCache(f.rpc);
  await readDevnetBasket(f.rpc, f.basket, wallet); assert.equal(f.calls.batch, 2);
});

test("a fee checkpoint between discovery and batching uses the new checkpoint alongside current supply", async () => {
  const f = fixture();
  const previous = f.rpc.getMultipleAccountsInfo.bind(f.rpc);
  f.rpc.getMultipleAccountsInfo = async (keys, commitment) => {
    f.b.writeBigInt64LE(1_700_000_060n, 152); f.b.writeUIntLE(99, 881, 5);
    return previous(keys, commitment);
  };
  const snapshot = await readDevnetBasket(f.rpc, f.basket);
  assert.equal(snapshot.detail.last_fee_accrual_ts, "1700000060");
  assert.equal(snapshot.managementFeeRemainder, "99");
});

test("substituted and uninitialized wallets fail, while frozen balances remain visible", async () => {
  for (const kind of ["substituted", "uninitialized", "frozen"]) {
    const f = fixture(), m = new PublicKey(DEVNET_MOCKS[0].mint);
    const account = token(kind === "substituted" ? creator : wallet, m, 1n);
    if (kind !== "substituted") account.data[108] = kind === "frozen" ? 2 : 0;
    f.accounts.set(ata(wallet, m).toBase58(), account);
    if (kind === "frozen") assert.equal((await readDevnetBasket(f.rpc, f.basket, wallet)).walletBalances[0].rawAmount, "1");
    else await assert.rejects(readDevnetBasket(f.rpc, f.basket, wallet), /token account identity/);
  }
});

test("wrong whitelist mint identity and invalid mint multiplier fail closed", async () => {
  for (const bad of ["whitelist", "multiplier"]) {
    const f = fixture(), m = new PublicKey(DEVNET_MOCKS[0].mint);
    if (bad === "whitelist") {
      const pda = PublicKey.findProgramAddressSync([Buffer.from("mint"), m.toBuffer()], PROGRAMS.whitelist)[0];
      wallet.toBuffer().copy(f.accounts.get(pda.toBase58())!.data, 8);
    } else f.accounts.get(m.toBase58())!.data.writeDoubleLE(NaN, 218);
    if (bad === "whitelist") assert.equal((await readDevnetBasket(f.rpc, f.basket)).whitelistStatuses[0], "Unavailable");
    else await assert.rejects(readDevnetBasket(f.rpc, f.basket), /multiplier/);
  }
});

test("wallet prerequisites read SOL, all four current mint multipliers and missing ATAs in one batch", async () => {
  const f = fixture(), m = new PublicKey(DEVNET_MOCKS[2].mint);
  f.accounts.get(m.toBase58())!.data.writeDoubleLE(4, 218);
  const state = await readDevnetWallet(f.rpc, wallet);
  assert.equal(state.solBalance, 2_000_000_000); assert.equal(state.mintFacts[2].multiplier, 4);
  assert.equal(state.walletBalances[0].rawAmount, "100000000000"); assert.equal(state.walletBalances[3].exists, false);
  assert.deepEqual(f.calls, { genesis: 1, account: 0, batch: 1, program: 0 });
});

test("effective scheduled multipliers use the signed timestamp including activation second", async () => {
  const original = Date.now;
  try {
    const activation = 1_800_000_000n;
    for (const [timestamp, effective, expected] of [[activation - 1n, activation, 1], [activation, activation, 4], [activation, -1n, 4]] as const) {
      Date.now = () => Number(timestamp) * 1_000;
      const f = fixture(), m = new PublicKey(DEVNET_MOCKS[0].mint), data = f.accounts.get(m.toBase58())!.data;
      data.writeBigInt64LE(effective, 210); data.writeDoubleLE(4, 218);
      assert.equal((await readDevnetWallet(f.rpc, wallet)).mintFacts[0].multiplier, expected);
    }
  } finally { Date.now = original; }
});

test("discovery excludes malformed and unrelated baskets instead of using mock catalog data", async () => {
  const f = fixture();
  f.rpc.getProgramAccounts = (async () => [{ pubkey: wallet, account: info(PROGRAMS.basket, Buffer.alloc(888)) }, { pubkey: f.basket, account: f.accounts.get(f.basket.toBase58())! }]) as unknown as typeof f.rpc.getProgramAccounts;
  const baskets = await listDevnetBaskets(f.rpc, { wallet });
  assert.equal(baskets.length, 1); assert.equal(baskets[0].detail.pubkey, f.basket.toBase58());
  assert.equal(baskets[0].detail.source, "devnet-rpc");
});

test("accrual estimate reuses carried dust and does not accrue for earlier clocks or zero-rate baskets", async () => {
  const f = fixture(), snapshot = await readDevnetBasket(f.rpc, f.basket);
  const last = BigInt(snapshot.detail.last_fee_accrual_ts!);
  assert.equal(estimateDevnetAccruedSupply(snapshot, last + 2_592_000n), 10_016_438n);
  assert.equal(estimateDevnetAccruedSupply(snapshot, last - 1n), 10_000_000n);
  const dust = { ...snapshot, supply: "1", managementFeeRemainder: "315359999800", detail: { ...snapshot.detail, management_fee_bps: 200 } };
  assert.equal(estimateDevnetAccruedSupply(dust, last + 1n), 2n);
  assert.equal(estimateDevnetAccruedSupply({ ...dust, detail: { ...dust.detail, management_fee_bps: 0 } }, last + 1n), 1n);
});

test("local browser metadata is displayed only after byte-exact onchain hash verification", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window"), storage = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { setItem: (k: string, v: string) => storage.set(k, v), getItem: (k: string) => storage.get(k) ?? null } } });
  try {
    const f = fixture(), text = JSON.stringify({ name: "My devnet basket", thesis: "Four mock assets" }), hash = await hashDevnetBasketMetadata(text);
    await saveDevnetBasketMetadata(f.basket, text, hash);
    assert.deepEqual(await loadDevnetBasketMetadata(f.basket, hash), JSON.parse(text));
    assert.equal(await loadDevnetBasketMetadata(f.basket, "f".repeat(64)), null);
    await assert.rejects(saveDevnetBasketMetadata(f.basket, text + " ", hash), /onchain hash/);
    storage.set([...storage.keys()][0], JSON.stringify({ name: "Tampered title" }));
    assert.equal(await loadDevnetBasketMetadata(f.basket, hash), null);
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});

test("verified metadata survives denied browser storage without blocking create", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { setItem: () => { throw new Error("Quota exceeded"); }, getItem: () => { throw new Error("Storage denied"); } } } });
  try {
    const f = fixture(123n), metadata = { name: "n".repeat(64), description: "d".repeat(400) }, text = JSON.stringify(metadata), hash = await hashDevnetBasketMetadata(text);
    await saveDevnetBasketMetadata(f.basket, text, hash);
    assert.deepEqual(await loadDevnetBasketMetadata(f.basket, hash), metadata);
    await assert.rejects(hashDevnetBasketMetadata(JSON.stringify({ name: "n".repeat(65) })), /name/);
    await assert.rejects(hashDevnetBasketMetadata(JSON.stringify({ description: "d".repeat(401) })), /description/);
  } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
});


test("registered namespace discovery separates identical mock tokens and their admission status", async () => {
  const legacy = fixture(42n), clean = fixture(42n, TEST_NAMESPACE), accounts = new Map([...legacy.accounts, ...clean.accounts]);
  const cleanWhitelist = PublicKey.findProgramAddressSync([Buffer.from("mint"), new PublicKey(DEVNET_MOCKS[0].mint).toBuffer()], namespacePrograms(TEST_NAMESPACE).whitelist)[0];
  accounts.get(cleanWhitelist.toBase58())!.data[49] = 1;
  const queries: string[] = [];
  const rpc = { ...legacy.rpc,
    getAccountInfo: async (address: PublicKey) => accounts.get(address.toBase58()) ?? null,
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(address => accounts.get(address.toBase58()) ?? null),
    getProgramAccounts: async (program: PublicKey) => {
      queries.push(program.toBase58());
      // Include a cross-namespace RPC substitution; discovery must bind replies to the queried owner.
      return [legacy, clean].map(f => ({pubkey:f.basket, account:accounts.get(f.basket.toBase58())!}));
    },
  } as unknown as typeof legacy.rpc;
  const list = await listDevnetBaskets(rpc, {routing:TEST_ROUTING});
  assert.deepEqual(queries, TEST_ROUTING.registry.map(n => n.programs.basket));
  assert.equal(list.length, 2);
  assert.equal(list.find(s => s.detail.pubkey === legacy.basket.toBase58())!.whitelistStatuses[0], "Active");
  assert.equal(list.find(s => s.detail.pubkey === clean.basket.toBase58())!.whitelistStatuses[0], "PausedNewMints");
  assert.notEqual(list[0].vaultAuthority, list[1].vaultAuthority);
  assert.ok(list.every(s => s.detail.nav === null));
  const legacyOnly = await listDevnetBaskets(rpc);
  assert.equal(legacyOnly.length, 1); assert.equal(legacyOnly[0].detail.factory, legacy.factory.toBase58());
  assert.equal(queries.length, 3); // Registry-specific list caches do not cross.
});

test("missing whitelist admission remains unavailable for mint while legacy raw withdrawal data stays readable", async () => {
  const f = fixture(), mint = new PublicKey(DEVNET_MOCKS[0].mint);
  f.accounts.delete(PublicKey.findProgramAddressSync([Buffer.from("mint"), mint.toBuffer()], PROGRAMS.whitelist)[0].toBase58());
  const snapshot = await readDevnetBasket(f.rpc, f.basket, wallet);
  assert.equal(snapshot.whitelistStatuses[0], "Unavailable");
  assert.equal(snapshot.shareBalance, "9007199254740993"); assert.equal(snapshot.detail.holdings.length, 4);
});

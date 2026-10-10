import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey, type Connection } from "@solana/web3.js";
import retiredKeys from "../../scripts/security/retired-keys.json";
import { PROGRAM_NAMESPACES } from "../../backend/src/config/programNamespaces";
import { APP_NAMESPACE_ROUTING, createNamespaceRouting, namespacePrograms } from "./program-namespaces";
import { authenticateBasketAccount, assertBasketCoreKeysOnChain } from "./basket-account-security";
import { buildCreateBasketInstruction, deriveCreateBasketPdas, type CreateBasketArgs } from "./create-basket";
import { assertSafeCreateBasketFactory } from "./create-basket-security";
import { buildMintInKind, buildRedeemInKind, buildAccrueManagementFee, parseBasketCoreKeys, deriveMintRedeemAltAddresses, ensureMintRedeemAlt, ensureCreateBasketAlt, buildCreateBasketTransaction } from "./transactions";
import { routedBasketFixture, TEST_NAMESPACE, TEST_ROUTING } from "../tests/namespace-fixture";

const args: CreateBasketArgs = { nonce: 42, constituents: [10, 11].map(n => new PublicKey(Buffer.alloc(32, n)).toBase58()), weightsBps: [5000, 5000], entryFeeBps: 0, exitFeeBps: 0, managementFeeBps: 0, metadataHash: new Uint8Array(32).fill(1), seedAmounts: [1n, 1n] };
const rpcFor = (fixture: ReturnType<typeof routedBasketFixture>) => ({
  getGenesisHash: async () => fixture.namespace.genesisHash,
  getAccountInfo: async (address: PublicKey) => fixture.accounts.get(address.toBase58()) ?? null,
  getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(address => fixture.accounts.get(address.toBase58()) ?? null),
} as unknown as Connection);

test("an explicitly closed registry disables every creation path before RPC or wallet preparation", async () => {
  const closed = createNamespaceRouting([PROGRAM_NAMESPACES[0]], null);
  const legacy = routedBasketFixture(); let calls = 0;
  const connection = new Proxy({}, { get: () => () => { calls++; throw new Error("No preparation permitted"); } }) as Connection;
  assert.equal(APP_NAMESPACE_ROUTING.forFactory(legacy.keys.factory.toBase58()).id, "devnet-legacy-v1");
  assert.throws(() => deriveCreateBasketPdas(legacy.keys.creator.toBase58(), args, closed), /no reviewed creation namespace/);
  assert.throws(() => buildCreateBasketInstruction(legacy.keys.creator.toBase58(), args, closed), /no reviewed creation namespace/);
  await assert.rejects(assertSafeCreateBasketFactory(connection, closed), /no reviewed creation namespace/);
  await assert.rejects(buildCreateBasketTransaction({connection, creator: legacy.keys.creator.toBase58(), args, routing: closed}), /no reviewed creation namespace/);
  await assert.rejects(ensureCreateBasketAlt({connection, creator: legacy.keys.creator.toBase58(), args, routing: closed, sendTransaction: async () => {calls++; return "never";}}), /no reviewed creation namespace/);
  assert.equal(calls, 0);
});


test("production creates only in the pinned owner namespace with the same instruction as isolated reviewed routing", async () => {
  const owner = APP_NAMESPACE_ROUTING.creation();
  assert.equal(owner.id, "devnet-owner-v1");
  const f = routedBasketFixture({namespace:owner, treasury:new PublicKey(owner.creation.treasury!)});
  const isolated = createNamespaceRouting([owner], owner.id);
  assert.equal((await assertSafeCreateBasketFactory(rpcFor(f))).id, owner.id);
  const pda = deriveCreateBasketPdas(f.keys.creator.toBase58(), args);
  assert.equal(pda.factory.toBase58(), owner.factoryConfig);
  assert.equal(pda.basket.toBase58(), f.keys.basket.toBase58());
  assert.equal(pda.shareMint.toBase58(), f.keys.shareMint.toBase58());
  const actual = buildCreateBasketInstruction(f.keys.creator.toBase58(), args);
  const proven = buildCreateBasketInstruction(f.keys.creator.toBase58(), args, isolated);
  assert.equal(actual.programId.toBase58(), owner.programs.factory);
  assert.equal(actual.keys[9].pubkey.toBase58(), owner.programs.basket);
  assert.deepEqual(actual.data, proven.data);
  assert.deepEqual(actual.keys, proven.keys);
  const [admission] = PublicKey.findProgramAddressSync([Buffer.from("mint"), new PublicKey(args.constituents[0]).toBuffer()], new PublicKey(owner.programs.whitelist));
  assert(actual.keys[10].pubkey.equals(admission));
  for (const built of [buildMintInKind({keys:f.keys, amounts:[1n,1n], vaultBalances:[1n,1n]}), buildRedeemInKind({keys:f.keys, sharesToBurn:1n, vaultBalances:[1n,1n]})]) {
    assert.equal(built.instructions[0].programId.toBase58(), owner.programs.basket);
  }
  f.accounts.get(f.keys.factory.toBase58())!.data[40] ^= 1;
  await assert.rejects(assertSafeCreateBasketFactory(rpcFor(f)), /blocked/);
});

test("same creator, nonce and assets produce isolated factory, basket, share, vault and whitelist addresses", () => {
  const legacy = routedBasketFixture(), clean = routedBasketFixture({namespace: TEST_NAMESPACE});
  for (const field of ["factory", "basket", "shareMint"] as const) assert.notEqual(legacy.keys[field].toBase58(), clean.keys[field].toBase58());
  assert.notEqual(legacy.vault.toBase58(), clean.vault.toBase58());
  const pda = deriveCreateBasketPdas(clean.keys.creator.toBase58(), args, TEST_ROUTING);
  assert.equal(pda.basket.toBase58(), clean.keys.basket.toBase58());
  const create = buildCreateBasketInstruction(clean.keys.creator.toBase58(), args, TEST_ROUTING);
  assert.equal(create.programId.toBase58(), TEST_NAMESPACE.programs.factory);
  assert.equal(create.keys[9].pubkey.toBase58(), TEST_NAMESPACE.programs.basket);
  assert.ok(create.keys[10].pubkey.equals(pda.whitelistedMints[0]));
  const tables = [legacy, clean].map(f => deriveMintRedeemAltAddresses(f.keys, TEST_ROUTING));
  assert.notDeepEqual(tables[0].map(String), tables[1].map(String));
  assert.ok(tables[1].some(k => k.equals(pda.whitelistedMints[0])));
  assert.ok(!tables[0].some(k => k.equals(pda.whitelistedMints[0])));
});

for (const namespace of [PROGRAM_NAMESPACES[0], TEST_NAMESPACE]) {
  test(`${namespace.id}: mint, redeem and crank target the basket role of the resolved factory`, () => {
    const f = routedBasketFixture({namespace}), programs = namespacePrograms(namespace);
    const minted = buildMintInKind({keys:f.keys, amounts:[1n,1n], vaultBalances:[1n,1n]}, TEST_ROUTING);
    const redeemed = buildRedeemInKind({keys:f.keys, sharesToBurn:1n, vaultBalances:[1n,1n]}, TEST_ROUTING);
    const accrued = buildAccrueManagementFee(f.keys, TEST_ROUTING);
    for (const built of [minted, redeemed, accrued]) assert.ok(built.instructions[0].programId.equals(programs.basket));
    assert.equal(redeemed.expectedAccounts.length, 18); // 12 named plus 3 per constituent
    assert.ok(!redeemed.expectedAccounts.some(a => /whitelist|oracle/.test(a.label)));
    assert.equal(minted.expectedAccounts.filter(a => a.label.startsWith("whitelisted_mint")).length, 2);
    assert.ok(redeemed.expectedAccounts.find(a => a.label === "vault_authority")!.pubkey.equals(f.vault));
  });
}

test("legacy redemption remains authenticated with retired treasury and without any whitelist or price account", async () => {
  const f = routedBasketFixture({treasury:new PublicKey(retiredKeys.keys[0].publicKey)});
  await assertBasketCoreKeysOnChain(rpcFor(f), f.keys);
  assert.ok(buildRedeemInKind({keys:f.keys, sharesToBurn:1n, vaultBalances:[1n,1n]}).instructions[0].programId.equals(new PublicKey(PROGRAM_NAMESPACES[0].programs.basket)));
});

test("unregistered factories and cross-namespace share mints fail before setup or signing", async () => {
  const a = routedBasketFixture(), b = routedBasketFixture({namespace: TEST_NAMESPACE}); let calls = 0;
  assert.throws(() => buildRedeemInKind({keys:{...a.keys, shareMint:b.keys.shareMint}, sharesToBurn:1n, vaultBalances:[1n,1n]}, TEST_ROUTING), /share mint/);
  const unknown = {...a.keys, factory:new PublicKey(Buffer.alloc(32, 99))};
  assert.throws(() => buildAccrueManagementFee(unknown), /not registered/);
  await assert.rejects(ensureMintRedeemAlt({connection:new Proxy({}, {get:()=>()=>{calls++;}}) as Connection, keys:unknown, sendTransaction:async()=>{calls++; return "never";}}), /not registered/);
  assert.equal(calls, 0);
});

test("registered program-role swaps, foreign factory and tampered PDA bumps are rejected by raw account authentication", () => {
  const a = routedBasketFixture(), b = routedBasketFixture({namespace: TEST_NAMESPACE});
  const account = a.accounts.get(a.keys.basket.toBase58())!;
  for (const owner of [new PublicKey(PROGRAM_NAMESPACES[0].programs.factory), new PublicKey(TEST_NAMESPACE.programs.basket)]) assert.throws(() => authenticateBasketAccount(a.keys.basket, {...account, owner}, TEST_ROUTING));
  for (const offset of [8, 104, 879, 880]) { const data = Buffer.from(account.data); data[offset] ^= 1; assert.throws(() => authenticateBasketAccount(a.keys.basket, {...account, data}, TEST_ROUTING)); }
  assert.throws(() => authenticateBasketAccount(b.keys.basket, account, TEST_ROUTING));
  assert.throws(() => createNamespaceRouting([PROGRAM_NAMESPACES[0], {...TEST_NAMESPACE, programs:{...TEST_NAMESPACE.programs, whitelist:PROGRAM_NAMESPACES[0].programs.basket}}]));
});

for (const kind of ["chain", "immutable-creator", "factory-treasury", "share-authority", "share-extension", "share-init", "share-freeze", "vault-owner", "vault-mint", "missing-vault"]) {
  test(`fresh wallet preparation rejects ${kind} substitution`, async () => {
    const f = routedBasketFixture({namespace:TEST_NAMESPACE}), rpc = rpcFor(f);
    let keys = f.keys;
    if (kind === "chain") rpc.getGenesisHash = async () => "mainnet";
    if (kind === "immutable-creator") keys = {...keys, creator:new PublicKey(Buffer.alloc(32, 98))};
    if (kind === "factory-treasury") f.accounts.get(f.keys.factory.toBase58())!.data[40] ^= 1;
    if (kind === "share-authority") f.accounts.get(f.keys.shareMint.toBase58())!.data[4] ^= 1;
    if (kind === "share-extension") {
      const account = f.accounts.get(f.keys.shareMint.toBase58())!, data = Buffer.alloc(170); account.data.copy(data); data[165] = 1; data.writeUInt16LE(1, 166); account.data = data;
    }
    if (kind === "share-init") f.accounts.get(f.keys.shareMint.toBase58())!.data[45] = 2;
    if (kind === "share-freeze") f.accounts.get(f.keys.shareMint.toBase58())!.data.writeUInt32LE(1, 46);
    const vault = [...f.accounts.keys()][3];
    if (kind === "vault-owner") f.accounts.get(vault)!.data[32] ^= 1;
    if (kind === "vault-mint") f.accounts.get(vault)!.data[0] ^= 1;
    if (kind === "missing-vault") f.accounts.delete(vault);
    await assert.rejects(assertBasketCoreKeysOnChain(rpc, keys, TEST_ROUTING), /namespace/);
  });
}


test("malformed and unregistered API details cannot open wallet reviews", () => {
  const f = routedBasketFixture();
  const detail = {pubkey:f.keys.basket.toBase58(), factory:f.keys.factory.toBase58(), creator:f.keys.creator.toBase58(), treasury:f.keys.treasury.toBase58(), share_mint:f.keys.shareMint.toBase58(), constituents:f.keys.constituents};
  assert.ok(parseBasketCoreKeys(detail, f.keys.user));
  assert.equal(parseBasketCoreKeys({...detail, factory:TEST_NAMESPACE.factoryConfig}, f.keys.user), null);
  assert.equal(parseBasketCoreKeys({...detail, share_mint:"malformed"}, f.keys.user), null);
});


test("Basket serialized layout requires all886 bytes while allocation padding is optional", () => {
  const f = routedBasketFixture(), account = f.accounts.get(f.keys.basket.toBase58())!;
  assert.throws(() => authenticateBasketAccount(f.keys.basket, {...account, data:account.data.subarray(0, 885)}), /layout/);
  for (const length of [886, 887, 888]) assert.equal(authenticateBasketAccount(f.keys.basket, {...account, data:account.data.subarray(0, length)}).factory.toBase58(), f.keys.factory.toBase58());
});

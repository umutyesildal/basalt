import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  BasketStateDecodeError,
  decodeBasketState,
  decodeFactoryTreasuryState,
  type BasketStateDecodeReason,
} from "../src/indexer/basketState";
import { MANAGEMENT_FEE_DENOMINATOR } from "../src/workers/feeMath";

const programs = {
  factory: new PublicKey("3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF"),
  basket: new PublicKey("6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k"),
};
const key = (byte: number) => new PublicKey(Buffer.alloc(32, byte));
const disc = (name: string) => createHash("sha256").update(`account:${name}`).digest().subarray(0, 8);
const [factory, factoryBump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], programs.factory);
const creator = key(201), treasury = key(202);
const CREATED = 1_725_148_800n;

/** Hand-built authoritative Rust layout, independent of the decoder. */
function basketFixture(options: { count?: number; nonce?: bigint; created?: bigint; lastAccrual?: bigint } = {}) {
  const count = options.count ?? 2;
  const nonce = options.nonce ?? 7n;
  const created = options.created ?? CREATED;
  const lastAccrual = options.lastAccrual ?? created + 123n;
  const nonceSeed = Buffer.alloc(8);
  nonceSeed.writeBigUInt64LE(nonce);
  const [address, basketBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("basket"), factory.toBuffer(), creator.toBuffer(), nonceSeed], programs.factory,
  );
  const [shareMint] = PublicKey.findProgramAddressSync([Buffer.from("share_mint"), address.toBuffer()], programs.factory);
  const [vaultAuthority, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from("basket"), address.toBuffer()], programs.basket);
  const data = Buffer.alloc(888);
  disc("Basket").copy(data, 0);
  factory.toBuffer().copy(data, 8);
  creator.toBuffer().copy(data, 40);
  treasury.toBuffer().copy(data, 72);
  shareMint.toBuffer().copy(data, 104);
  data.writeBigUInt64LE(nonce, 136);
  data.writeBigInt64LE(created, 144);
  data.writeBigInt64LE(lastAccrual, 152);
  Buffer.alloc(32, 7).copy(data, 160);
  data[192] = count;
  const constituents = Array.from({ length: count }, (_, i) => key(i + 1).toBase58());
  for (let i = 0; i < count; i++) {
    key(i + 1).toBuffer().copy(data, 193 + i * 32);
    data.writeUInt16LE(Math.floor(10_000 / count) + (i === 0 ? 10_000 % count : 0), 833 + i * 2);
  }
  data.writeUInt16LE(300, 873);
  data.writeUInt16LE(100, 875);
  data.writeUInt16LE(300, 877);
  data[879] = basketBump;
  data[880] = vaultBump;
  return { address: address.toBase58(), account: { owner: programs.basket, data }, shareMint, vaultAuthority, constituents };
}

function factoryFixture() {
  const data = Buffer.alloc(89);
  disc("FactoryConfig").copy(data, 0);
  key(200).toBuffer().copy(data, 8);
  treasury.toBuffer().copy(data, 40);
  data.writeUInt16LE(9000, 72);
  data.writeUInt16LE(300, 74);
  data.writeUInt16LE(100, 76);
  data.writeUInt16LE(300, 78);
  data.writeBigUInt64LE(99n, 80);
  data[88] = factoryBump;
  return { address: factory.toBase58(), account: { owner: programs.factory, data } };
}

function expectReason(action: () => unknown, reason: BasketStateDecodeReason) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(BasketStateDecodeError);
    expect((error as BasketStateDecodeError).reason).toBe(reason);
    return;
  }
  throw new Error(`Expected rejection with ${reason}`);
}

describe("basket state recovery — current immutable account", () => {
  it("returns exact immutable fields and both actual chain timestamps", () => {
    const fixture = basketFixture();
    expect(decodeBasketState(fixture.address, fixture.account, programs)).toEqual({
      pubkey: fixture.address, factory: factory.toBase58(), creator: creator.toBase58(),
      treasury: treasury.toBase58(), shareMint: fixture.shareMint.toBase58(), nonce: "7",
      createdAt: new Date("2024-09-01T00:00:00.000Z"), metadataHash: "07".repeat(32),
      numConstituents: 2, constituents: fixture.constituents, weightsBps: [5000, 5000],
      entryFeeBps: 300, exitFeeBps: 100, managementFeeBps: 300,
      lastFeeAccrualTs: new Date("2024-09-01T00:02:03.000Z"),
      managementFeeRemainder: "0", vaultAuthority: fixture.vaultAuthority.toBase58(),
    });
  });

  it("accepts all twenty assets beyond the frontend four-mock pack", () => {
    const fixture = basketFixture({ count: 20 });
    const state = decodeBasketState(fixture.address, fixture.account, programs);
    expect(state.numConstituents).toBe(20);
    expect(state.constituents).toEqual(fixture.constituents);
    expect(state.weightsBps).toEqual(Array(20).fill(500));
  });

  it("accepts exactly 886 serialized bytes and ignores allocation padding", () => {
    const fixture = basketFixture();
    fixture.account.data[886] = 255;
    fixture.account.data[887] = 255;
    const padded = decodeBasketState(fixture.address, fixture.account, programs);
    expect(decodeBasketState(fixture.address, { ...fixture.account, data: fixture.account.data.subarray(0, 886) }, programs)).toEqual(padded);
    expectReason(() => decodeBasketState(fixture.address, { ...fixture.account, data: fixture.account.data.subarray(0, 885) }, programs), "truncated-account");
  });

  it.each([9_007_199_254_740_993n, 9_223_372_036_854_775_807n])("keeps supported nonce %s exact above Number precision", (nonce) => {
    const fixture = basketFixture({ nonce });
    expect(decodeBasketState(fixture.address, fixture.account, programs).nonce).toBe(nonce.toString());
  });

  it.each([9_223_372_036_854_775_808n, 18_446_744_073_709_551_615n])("explicitly refuses nonce %s outside signed PostgreSQL BIGINT", (nonce) => {
    const fixture = basketFixture({ nonce });
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "unsupported-nonce-postgres-bigint");
  });

  it("validates configured owners and rejects executable state", () => {
    const fixture = basketFixture();
    expectReason(() => decodeBasketState(fixture.address, { ...fixture.account, owner: programs.factory }, programs), "invalid-owner");
    expectReason(() => decodeBasketState(fixture.address, { ...fixture.account, executable: true }, programs), "executable-account");
    expectReason(() => decodeBasketState("not an address", fixture.account, programs), "invalid-address");
  });

  it.each([
    ["invalid-discriminator", (data: Buffer) => disc("FactoryConfig").copy(data, 0)],
    ["invalid-factory-pda", (data: Buffer) => key(99).toBuffer().copy(data, 8)],
    ["invalid-basket-pda", (data: Buffer) => key(99).toBuffer().copy(data, 40)],
    ["invalid-share-mint-pda", (data: Buffer) => key(99).toBuffer().copy(data, 104)],
    ["invalid-basket-bump", (data: Buffer) => { data[879] ^= 1; }],
    ["invalid-vault-bump", (data: Buffer) => { data[880] ^= 1; }],
  ] as const)("rejects substituted identity: %s", (reason, mutate) => {
    const fixture = basketFixture();
    mutate(fixture.account.data);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), reason);
  });

  it("rejects a different account address and a wrong configured factory program", () => {
    const fixture = basketFixture();
    expectReason(() => decodeBasketState(key(99).toBase58(), fixture.account, programs), "invalid-basket-pda");
    expectReason(() => decodeBasketState(fixture.address, fixture.account, { ...programs, factory: key(99) }), "invalid-factory-pda");
  });

  it.each([0, 1, 21, 255])("rejects constituent count %s", (count) => {
    const fixture = basketFixture();
    fixture.account.data[192] = count;
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-constituent-count");
  });

  it("rejects duplicate or zero constituent addresses", () => {
    const fixture = basketFixture();
    key(1).toBuffer().copy(fixture.account.data, 225);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-constituents");
    PublicKey.default.toBuffer().copy(fixture.account.data, 225);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-constituents");
  });

  it.each([[0, 10_000], [5000, 4999], [10_000, 10_000]])("rejects weights %s/%s", (first, second) => {
    const fixture = basketFixture();
    fixture.account.data.writeUInt16LE(first, 833);
    fixture.account.data.writeUInt16LE(second, 835);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-weights");
  });

  it.each([[873, 301], [875, 101], [877, 301]])("rejects fee above cap at byte %s", (offset, fee) => {
    const fixture = basketFixture();
    fixture.account.data.writeUInt16LE(fee, offset);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-fees");
  });

  it("rejects empty metadata", () => {
    const fixture = basketFixture();
    fixture.account.data.fill(0, 160, 192);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-metadata");
  });

  it.each([
    { created: -1n, lastAccrual: 0n },
    { created: CREATED, lastAccrual: CREATED - 1n },
    { created: CREATED, lastAccrual: 8_640_000_000_001n },
    { created: 9_223_372_036_854_775_807n, lastAccrual: 9_223_372_036_854_775_807n },
  ])("rejects unsupported or reversed timestamps: %s", (timestamps) => {
    const fixture = basketFixture(timestamps);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-timestamps");
  });

  it("accepts the largest canonical fee remainder and rejects the denominator", () => {
    const fixture = basketFixture();
    fixture.account.data.writeUIntLE(Number(MANAGEMENT_FEE_DENOMINATOR - 1n), 881, 5);
    expect(decodeBasketState(fixture.address, fixture.account, programs).managementFeeRemainder).toBe((MANAGEMENT_FEE_DENOMINATOR - 1n).toString());
    fixture.account.data.writeUIntLE(Number(MANAGEMENT_FEE_DENOMINATOR), 881, 5);
    expectReason(() => decodeBasketState(fixture.address, fixture.account, programs), "invalid-management-fee-remainder");
  });
});

describe("factory treasury recovery — canonical configured account", () => {
  it("reads treasury at its actual ABI offset with the fixed policy", () => {
    const fixture = factoryFixture();
    expect(decodeFactoryTreasuryState(fixture.address, fixture.account, programs.factory)).toBe(treasury.toBase58());
  });

  it("rejects wrong owner, executable state, short data and invalid address", () => {
    const fixture = factoryFixture();
    expectReason(() => decodeFactoryTreasuryState(fixture.address, { ...fixture.account, owner: programs.basket }, programs.factory), "invalid-owner");
    expectReason(() => decodeFactoryTreasuryState(fixture.address, { ...fixture.account, executable: true }, programs.factory), "executable-account");
    expectReason(() => decodeFactoryTreasuryState(fixture.address, { ...fixture.account, data: fixture.account.data.subarray(0, 88) }, programs.factory), "truncated-account");
    expectReason(() => decodeFactoryTreasuryState("not an address", fixture.account, programs.factory), "invalid-address");
  });

  it("rejects a matching layout under a different discriminator or PDA", () => {
    const fixture = factoryFixture();
    expectReason(() => decodeFactoryTreasuryState(key(99).toBase58(), fixture.account, programs.factory), "invalid-factory-pda");
    disc("Basket").copy(fixture.account.data, 0);
    expectReason(() => decodeFactoryTreasuryState(fixture.address, fixture.account, programs.factory), "invalid-discriminator");
  });

  it("rejects a corrupted factory bump", () => {
    const fixture = factoryFixture();
    fixture.account.data[88] ^= 1;
    expectReason(() => decodeFactoryTreasuryState(fixture.address, fixture.account, programs.factory), "invalid-factory-bump");
  });

  it.each([[72, 8999], [74, 301], [76, 101], [78, 301]])("rejects a substituted split or cap at byte %s", (offset, value) => {
    const fixture = factoryFixture();
    fixture.account.data.writeUInt16LE(value, offset);
    expectReason(() => decodeFactoryTreasuryState(fixture.address, fixture.account, programs.factory), "invalid-factory-policy");
  });
});

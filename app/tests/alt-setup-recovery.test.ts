import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  AddressLookupTableAccount, AddressLookupTableInstruction, AddressLookupTableProgram,
  PublicKey, TransactionInstruction, type Connection, type VersionedTransaction,
} from "@solana/web3.js";
import {
  deriveCreateBasketAltAddresses, deriveMintRedeemAltAddresses, ensureCreateBasketAlt,
  ensureMintRedeemAlt, type BasketCoreKeys, type WalletSendTransaction,
} from "../lib/transactions";
import { PROGRAMS } from "../lib/solana";
import type { CreateBasketArgs } from "../lib/create-basket";
import { FACTORY_FIXTURE_ADDRESS, factoryFixture } from "./factory-fixture";

const GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const SIGNATURE = "2".repeat(87);
const ACTIVE = (1n << 64n) - 1n;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});
function browserStorage(denied = false) {
  const values = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => { if (denied) throw new Error("Storage denied"); return values.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (denied) throw new Error("Storage denied"); values.set(key, value); },
    removeItem: (key: string) => { if (denied) throw new Error("Storage denied"); values.delete(key); },
  };
  Object.defineProperty(globalThis, "window", { value: { localStorage }, configurable: true });
  return values;
}
let fixtureCount = 0;
function key(number: number) { const bytes = Buffer.alloc(32); bytes.writeUInt32LE(number, 0); return new PublicKey(bytes); }
function fixture() {
  const id = ++fixtureCount * 100;
  const keys: BasketCoreKeys = { user: key(id), creator: key(id + 1), treasury: key(id + 2), basket: key(id + 3),
    factory: key(id + 4), shareMint: key(id + 5), constituents: [6, 7, 8, 9].map(i => key(id + i).toBase58()) };
  const tables = new Map<string, AddressLookupTableAccount>();
  const f = {
    keys, tables, genesis: GENESIS, slot: 123_000 + id, slotReads: 0, sends: 0, rejectSend: 0,
    confirmations: 0, rejectConfirm: 0, status: null as null | { err: unknown; confirmationStatus: "confirmed"; slot: number; confirmations: number },
    blockHeight: 10, owner: AddressLookupTableProgram.programId,
    landed: [] as string[][],
  };
  const rpc = {
    getGenesisHash: async () => f.genesis,
    getSlot: async () => { f.slotReads += 1; return f.slot; },
    getAccountInfo: async (address: PublicKey) => address.equals(FACTORY_FIXTURE_ADDRESS) ? factoryFixture(f.keys.treasury)
      : tables.has(address.toBase58()) ? { owner: f.owner, executable: false, lamports: 1, data: Buffer.alloc(56) } : null,
    getAddressLookupTable: async (address: PublicKey) => ({ context: { slot: f.slot }, value: tables.get(address.toBase58()) ?? null }),
    getLatestBlockhash: async () => ({ blockhash: key(1).toBase58(), lastValidBlockHeight: 1_000 }),
    confirmTransaction: async () => {
      f.confirmations += 1;
      if (f.rejectConfirm === f.confirmations) throw new Error("Setup confirmation interrupted");
      return { context: { slot: f.slot }, value: { err: null } };
    },
    getSignatureStatuses: async () => ({ context: { slot: f.slot }, value: [f.status] }),
    getBlockHeight: async () => f.blockHeight,
  } as unknown as Connection;
  const send: WalletSendTransaction = async <T extends VersionedTransaction>(tx: T) => {
    f.sends += 1;
    if (f.rejectSend === f.sends) throw new Error("User rejected the wallet request");
    const instructions = tx.message.compiledInstructions.map(ix => new TransactionInstruction({
      programId: tx.message.staticAccountKeys[ix.programIdIndex], data: Buffer.from(ix.data),
      keys: ix.accountKeyIndexes.map(index => ({ pubkey: tx.message.staticAccountKeys[index], isSigner: false, isWritable: true })),
    })).filter(ix => ix.programId.equals(AddressLookupTableProgram.programId));
    const kinds: string[] = [];
    for (const ix of instructions) {
      const kind = AddressLookupTableInstruction.decodeInstructionType(ix); kinds.push(kind);
      if (kind === "CreateLookupTable") {
        const args = AddressLookupTableInstruction.decodeCreateLookupTable(ix);
        const address = ix.keys[0].pubkey;
        tables.set(address.toBase58(), new AddressLookupTableAccount({ key: address,
          state: { authority: args.authority, deactivationSlot: ACTIVE, lastExtendedSlot: f.slot,
            lastExtendedSlotStartIndex: 0, addresses: [] } }));
      } else if (kind === "ExtendLookupTable") {
        const args = AddressLookupTableInstruction.decodeExtendLookupTable(ix);
        const table = tables.get(args.lookupTable.toBase58()); assert.ok(table);
        table.state.addresses.push(...args.addresses);
      }
    }
    f.landed.push(kinds);
    f.status = { err: null, confirmationStatus: "confirmed", slot: f.slot, confirmations: 1 };
    return SIGNATURE;
  };
  return Object.assign(f, { rpc, send });
}
function cacheKey(kind: "create" | "mint-redeem", genesis: string, wallet: PublicKey, addresses: PublicKey[]) {
  const input = [kind, genesis, PROGRAMS.whitelist, PROGRAMS.factory, PROGRAMS.basket, wallet, ...addresses].map(String).join(":");
  return `basalt:alt:v2:${createHash("sha256").update(input).digest("hex")}`;
}
function tableAddress(wallet: PublicKey, slot: number) {
  return AddressLookupTableProgram.createLookupTable({ authority: wallet, payer: wallet, recentSlot: slot })[1];
}
function seedPersisted(f: ReturnType<typeof fixture>, values: Map<string, string>, addresses = deriveMintRedeemAltAddresses(f.keys), creation = true) {
  const name = cacheKey("mint-redeem", f.genesis, f.keys.user, addresses);
  values.set(name, JSON.stringify({ recentSlot: f.slot, ...(creation ? { creation: { signature: SIGNATURE, lastValidBlockHeight: 1_000 } } : {}) }));
  return name;
}
function seedTable(f: ReturnType<typeof fixture>, addresses = deriveMintRedeemAltAddresses(f.keys)) {
  const address = tableAddress(f.keys.user, f.slot);
  const table = new AddressLookupTableAccount({ key: address, state: { authority: f.keys.user, deactivationSlot: ACTIVE,
    lastExtendedSlot: f.slot, lastExtendedSlotStartIndex: 0, addresses: [...addresses] } });
  f.tables.set(address.toBase58(), table);
  return table;
}
function ensure(f: ReturnType<typeof fixture>) { return ensureMintRedeemAlt({ connection: f.rpc, keys: f.keys, sendTransaction: f.send }); }

test("a failed later extension resumes the first confirmed table and signs only the missing extension", async () => {
  const values = browserStorage(), f = fixture(); f.rejectSend = 2;
  await assert.rejects(ensure(f), /rejected/);
  assert.equal(f.tables.size, 1); assert.equal(values.size, 1);
  const first = [...f.tables.keys()][0];
  const record = JSON.parse([...values.values()][0]); assert.equal(record.creation.signature, SIGNATURE);
  f.rejectSend = 0; f.slot += 500;
  const result = await ensure(f);
  assert.equal(result.lookupTableAddress.toBase58(), first); assert.equal(result.created, false);
  assert.equal(result.approvals, 1); assert.equal(f.tables.size, 1); assert.equal(f.slotReads, 1);
  assert.deepEqual(f.landed.at(-1), ["ExtendLookupTable"]);
});

test("a lost create confirmation keeps its public receipt and resumes without another create", async () => {
  const values = browserStorage(), f = fixture(); f.rejectConfirm = 1;
  await assert.rejects(ensure(f), /confirmation interrupted/);
  assert.equal(values.size, 1); assert.equal(f.tables.size, 1);
  f.rejectConfirm = 0; f.slot += 100;
  const result = await ensure(f);
  assert.equal(result.created, false); assert.equal(f.tables.size, 1); assert.equal(f.slotReads, 1);
  assert.deepEqual(f.landed.at(-1), ["ExtendLookupTable"]);
});

test("a persisted, fully covered active wallet table is restored without an in-memory receipt with no setup approval", async () => {
  const values = browserStorage(), f = fixture(); seedPersisted(f, values); const table = seedTable(f);
  f.slot += 500;
  const result = await ensure(f);
  assert.equal(result.lookupTableAddress.toBase58(), table.key.toBase58()); assert.equal(result.approvals, 0);
  assert.equal(f.sends, 0); assert.equal(f.slotReads, 0);
});

test("persisted partial coverage extends only the addresses absent from the current chain table", async () => {
  const values = browserStorage(), f = fixture(); seedPersisted(f, values);
  const wanted = deriveMintRedeemAltAddresses(f.keys), table = seedTable(f, wanted.slice(0, 20));
  const result = await ensure(f);
  assert.equal(result.created, false); assert.equal(result.extended, wanted.length - 20);
  assert.deepEqual(f.landed, [["ExtendLookupTable"]]); assert.equal(table.state.addresses.length, wanted.length);
});

test("browser storage denial still preserves interrupted setup in this tab", async () => {
  browserStorage(true); const f = fixture(); f.rejectSend = 2;
  await assert.rejects(ensure(f), /rejected/); const address = [...f.tables.keys()][0];
  f.rejectSend = 0; f.slot += 100;
  const result = await ensure(f);
  assert.equal(result.lookupTableAddress.toBase58(), address); assert.equal(f.tables.size, 1); assert.equal(f.slotReads, 1);
});

for (const status of [null, { err: null, confirmationStatus: "confirmed" as const, slot: 1, confirmations: 1 }]) {
  test(`a missing saved table with ${status ? "confirmed" : "pending"} creation never triggers another approval`, async () => {
    const values = browserStorage(), f = fixture(), name = seedPersisted(f, values); f.status = status;
    await assert.rejects(ensure(f), /still becoming available/);
    assert.equal(f.sends, 0); assert.equal(f.slotReads, 0); assert.ok(values.has(name));
  });
}

test("an absent expired submission is cleared only after signature and block-height checks", async () => {
  const values = browserStorage(), f = fixture(), name = seedPersisted(f, values); f.blockHeight = 1_001;
  await assert.rejects(ensure(f), /expired/); assert.equal(f.sends, 0); assert.equal(values.has(name), false);
  const result = await ensure(f); assert.equal(result.created, true); assert.equal(f.slotReads, 1);
});

test("an absent failed submission is cleared without trying to sign in the failing call", async () => {
  const values = browserStorage(), f = fixture(), name = seedPersisted(f, values);
  f.status = { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed", slot: 1, confirmations: 1 };
  await assert.rejects(ensure(f), /transaction failed/); assert.equal(f.sends, 0); assert.equal(values.has(name), false);
});

for (const invalid of ["owner", "authority", "deactivated", "frozen", "address", "layout"] as const) {
  test(`a persisted table with invalid ${invalid} is rejected before wallet signing`, async () => {
    const values = browserStorage(), f = fixture(), name = seedPersisted(f, values), table = seedTable(f);
    if (invalid === "owner") f.owner = PROGRAMS.basket;
    if (invalid === "authority") table.state.authority = key(91);
    if (invalid === "deactivated") table.state.deactivationSlot = 10n;
    if (invalid === "frozen") table.state.authority = undefined;
    if (invalid === "address") table.key = key(92);
    if (invalid === "layout") table.state.lastExtendedSlot = NaN;
    await assert.rejects(ensure(f), /invalid|inactive/); assert.equal(f.sends, 0); assert.equal(values.has(name), false);
  });
}

test("a missing receipt without a submitted signature is rejected instead of silently creating a replacement", async () => {
  const values = browserStorage(), f = fixture(), name = seedPersisted(f, values, undefined, false);
  await assert.rejects(ensure(f), /saved wallet setup is unavailable/); assert.equal(f.sends, 0); assert.equal(values.has(name), false);
});

test("malformed browser records cannot supply a derivation slot", async () => {
  const values = browserStorage(), f = fixture(), name = cacheKey("mint-redeem", f.genesis, f.keys.user, deriveMintRedeemAltAddresses(f.keys));
  values.set(name, JSON.stringify({ recentSlot: "9999", creation: { signature: "bad", lastValidBlockHeight: -1 } }));
  const result = await ensure(f); assert.equal(result.recentSlot, f.slot); assert.equal(f.slotReads, 1); assert.equal(result.created, true);
});

test("receipts cannot cross a chain genesis boundary", async () => {
  const values = browserStorage(), f = fixture(); seedPersisted(f, values); const oldSlot = f.slot;
  f.genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"; f.slot += 500;
  const result = await ensure(f); assert.equal(result.recentSlot, f.slot); assert.notEqual(result.recentSlot, oldSlot); assert.equal(f.slotReads, 1);
});

test("receipts cannot cross the wallet or exact basket account set", async () => {
  const values = browserStorage(), f = fixture(); seedPersisted(f, values); f.keys.user = key(991); f.keys.basket = key(992); f.slot += 500;
  const result = await ensure(f); assert.equal(result.recentSlot, f.slot); assert.equal(f.slotReads, 1); assert.equal(result.created, true);
});

test("creator setup also resumes a persisted table after an interrupted extension", async () => {
  const values = browserStorage(), f = fixture();
  const args: CreateBasketArgs = { nonce: 37, constituents: f.keys.constituents, weightsBps: [2500, 2500, 2500, 2500],
    entryFeeBps: 0, exitFeeBps: 0, managementFeeBps: 200, metadataHash: new Uint8Array(32).fill(1), seedAmounts: [2_500_000_000n, 2_500_000_000n, 2_500_000_000n, 2_500_000_000n] };
  const ensureCreator = () => ensureCreateBasketAlt({ connection: f.rpc, creator: f.keys.user.toBase58(), args, sendTransaction: f.send });
  f.rejectSend = 2; await assert.rejects(ensureCreator(), /rejected/);
  assert.equal(values.size, 1); const address = [...f.tables.keys()][0]; f.rejectSend = 0;
  const result = await ensureCreator(); assert.equal(result.lookupTableAddress.toBase58(), address); assert.equal(result.created, false);
  const wanted = deriveCreateBasketAltAddresses(f.keys.user.toBase58(), args);
  assert.equal(f.tables.get(address)?.state.addresses.length, wanted.length);
});

for (const status of [null, { err: null, confirmationStatus: "confirmed" as const, slot: 1, confirmations: 1 }]) {
  test(`a ${status ? "confirmed but unreadable" : "pending"} saved extension cannot trigger another extension approval`, async () => {
    const values = browserStorage(), f = fixture(), name = seedPersisted(f, values);
    const wanted = deriveMintRedeemAltAddresses(f.keys), table = seedTable(f, wanted.slice(0, 20));
    const receipt = JSON.parse(values.get(name)!);
    values.set(name, JSON.stringify({ ...receipt, pending: { signature: "3".repeat(87), lastValidBlockHeight: 1_000,
      expectedAddresses: wanted.slice(0, 25).map(address => address.toBase58()) } }));
    f.status = status;
    await assert.rejects(ensure(f), /still confirming|still becoming available/);
    assert.equal(f.sends, 0); assert.ok(JSON.parse(values.get(name)!).pending);
    f.status = { err: null, confirmationStatus: "confirmed", slot: 1, confirmations: 1 };
    table.state.addresses.push(...wanted.slice(20, 25));
    const result = await ensure(f);
    assert.equal(result.created, false); assert.equal(result.extended, wanted.length - 25); assert.equal(f.tables.size, 1);
    assert.deepEqual(f.landed, [["ExtendLookupTable"]]); assert.equal(JSON.parse(values.get(name)!).pending, undefined);
  });
}

test("an expired saved extension clears its submission without losing the confirmed table receipt", async () => {
  const values = browserStorage(), f = fixture(), name = seedPersisted(f, values), wanted = deriveMintRedeemAltAddresses(f.keys);
  seedTable(f, wanted.slice(0, 20));
  const receipt = JSON.parse(values.get(name)!);
  values.set(name, JSON.stringify({ ...receipt, pending: { signature: "3".repeat(87), lastValidBlockHeight: 1_000,
    expectedAddresses: wanted.map(address => address.toBase58()) } }));
  f.blockHeight = 1_001;
  await assert.rejects(ensure(f), /expired/); assert.equal(f.sends, 0);
  const remaining = JSON.parse(values.get(name)!); assert.equal(remaining.pending, undefined); assert.deepEqual(remaining.creation, receipt.creation);
  const result = await ensure(f); assert.equal(result.created, false); assert.equal(result.approvals, 1); assert.equal(f.tables.size, 1);
});


test("a fresh process resumes the serialized receipt after create succeeds and the next extension is rejected", async () => {
  const values = browserStorage(), f = fixture(); f.rejectSend = 2;
  await assert.rejects(ensure(f), /rejected/);
  const original = [...f.tables.values()][0];
  const payload = { storage: [...values], wallet: f.keys.user.toBase58(), creator: f.keys.creator.toBase58(),
    treasury: f.keys.treasury.toBase58(), factory: f.keys.factory.toBase58(), basket: f.keys.basket.toBase58(),
    shareMint: f.keys.shareMint.toBase58(), constituents: f.keys.constituents, address: original.key.toBase58(),
    addresses: original.state.addresses.map(address => address.toBase58()), slot: f.slot };
  const script = `
    import assert from "node:assert/strict";
    import { AddressLookupTableAccount, AddressLookupTableInstruction, AddressLookupTableProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
    import * as transactionsModule from "./lib/transactions.ts";
    const { ensureMintRedeemAlt } = transactionsModule.default ?? transactionsModule;
    const payload = ${JSON.stringify(payload)};
    const values = new Map(payload.storage);
    globalThis.window = { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } };
    const user = new PublicKey(payload.wallet);
    const table = new AddressLookupTableAccount({ key: new PublicKey(payload.address), state: { authority: user,
      deactivationSlot: (1n << 64n) - 1n, lastExtendedSlot: payload.slot, lastExtendedSlotStartIndex: 0,
      addresses: payload.addresses.map(address => new PublicKey(address)) } });
    let sends = 0;
    const rpc = { getGenesisHash: async () => "${GENESIS}", getSlot: async () => { throw new Error("Unexpected fresh slot"); },
      getAccountInfo: async () => ({ owner: AddressLookupTableProgram.programId, executable: false, data: Buffer.alloc(56), lamports: 1 }),
      getAddressLookupTable: async () => ({ context: { slot: payload.slot }, value: table }),
      getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1000 }),
      confirmTransaction: async () => ({ context: { slot: payload.slot }, value: { err: null } }) };
    const send = async tx => {
      sends += 1;
      for (const compiled of tx.message.compiledInstructions) {
        const ix = new TransactionInstruction({ programId: tx.message.staticAccountKeys[compiled.programIdIndex], data: Buffer.from(compiled.data),
          keys: compiled.accountKeyIndexes.map(index => ({ pubkey: tx.message.staticAccountKeys[index], isSigner: false, isWritable: true })) });
        if (!ix.programId.equals(AddressLookupTableProgram.programId)) continue;
        assert.equal(AddressLookupTableInstruction.decodeInstructionType(ix), "ExtendLookupTable");
        const args = AddressLookupTableInstruction.decodeExtendLookupTable(ix); table.state.addresses.push(...args.addresses);
      }
      return "${SIGNATURE}";
    };
    const keys = { user, creator: new PublicKey(payload.creator), treasury: new PublicKey(payload.treasury), factory: new PublicKey(payload.factory),
      basket: new PublicKey(payload.basket), shareMint: new PublicKey(payload.shareMint), constituents: payload.constituents };
    const result = await ensureMintRedeemAlt({ connection: rpc, keys, sendTransaction: send });
    console.log(JSON.stringify({ created: result.created, approvals: result.approvals, address: result.lookupTableAddress.toBase58(), sends }));
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, TSX_TSCONFIG_PATH: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) },
    timeout: 10_000, encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { created: false, approvals: 1, address: original.key.toBase58(), sends: 1 });
});

import { describe, expect, it, vi } from "vitest";
import { PublicKey, SystemProgram, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { AccountState, TOKEN_2022_PROGRAM_ID, ExtensionType, getMintLen, type Mint } from "@solana/spl-token";
import { initializeConfidentialMint, buildFixtureMint, fixtureSizes, fixtureMetadata, fixtureMutations, FIXED_EXTENSIONS, FIXTURE_EXTENSIONS, assertFixtureMint } from "../../scripts/xstocks-devnet/profile";
import { getRunDir, RUNS_ROOT } from "../../scripts/xstocks-devnet/runtime";
import { main } from "../../scripts/setupXStockDevnet";
import wireFixture from "./fixtures/confidential-mint-initialize.json";
const mint = new PublicKey(Buffer.alloc(32, 41)), authority = new PublicKey(Buffer.from(wireFixture.authorityHex, "hex"));

describe("explicit issuer-profile devnet fixture preparation", () => {
  it("matches the independently recorded SPL confidential-mint wire schema without enabling confidential account balances", () => {
    const ix = initializeConfidentialMint(mint, authority);
    expect(ix.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(ix.data.toString("hex")).toBe(wireFixture.instructionHex);
    expect(ix.data).toHaveLength(67);
    expect(ix.keys).toEqual([{ pubkey: mint, isSigner: false, isWritable: true }]);
  });
  it("allocates fixed extensions first and funds room for variable metadata, with initialization atomic and packet-size safe", () => {
    const sizes = fixtureSizes(mint, authority, "A");
    expect(sizes.initial).toBe(509); expect(sizes.final).toBe(675);
    expect(FIXED_EXTENSIONS).not.toContain(ExtensionType.TokenMetadata);
    expect(FIXTURE_EXTENSIONS).toEqual([18, 12, 6, 25, 26, 4, 14, 19]);
    expect(getMintLen(FIXED_EXTENSIONS)).toBe(sizes.initial);
    const instructions = buildFixtureMint(mint, authority, "A", 4_000_000, 2);
    const create = SystemProgram.programId.equals(instructions[0].programId);
    expect(create).toBe(true);
    expect(instructions.slice(1).every(ix => ix.programId.equals(TOKEN_2022_PROGRAM_ID))).toBe(true);
    // Fixed extensions precede InitializeMint2 (20), metadata follows the initialized mint.
    expect(instructions.slice(1, 9).map(ix => ix.data[0])).toEqual([39, 35, 28, 43, 44, 27, 36, 20]);
    const tx = new Transaction({ feePayer: authority, recentBlockhash: PublicKey.default.toBase58() }).add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...instructions);
    expect(tx.compileMessage().header.numRequiredSignatures).toBe(2);
    expect(tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length).toBeLessThanOrEqual(1232);
  });
  it("labels fixtures distinctly from official xStocks and refuses unknown fixture names", () => {
    expect(fixtureMetadata(mint, authority, "B")).toMatchObject({ symbol: "BSTESTB", name: "Basalt devnet fixture B" });
    expect(() => fixtureMetadata(mint, authority, "AAPLx")).toThrow();
  });
  it("starts initialized, unpaused, with no active hook and exposes separate reversible mutation instructions", () => {
    const init = buildFixtureMint(mint, authority, "A", 4_000_000);
    expect([...init[3].data]).toEqual([28, 0, AccountState.Initialized]);
    expect(init[7].data.subarray(34).equals(Buffer.alloc(32))).toBe(true);
    expect([...fixtureMutations.pause(mint, authority).data]).toEqual([44, 1]);
    expect([...fixtureMutations.resume(mint, authority).data]).toEqual([44, 2]);
    expect(fixtureMutations.hook(mint, authority, null).data.subarray(2).equals(Buffer.alloc(32))).toBe(true);
    expect([...fixtureMutations.defaultState(mint, authority, AccountState.Frozen).data]).toEqual([28, 1, 2]);
  });
  it("validates the full modern readback profile, including SDK metadata and raw confidential configuration", () => {
    const scale = Buffer.alloc(56); authority.toBuffer().copy(scale); scale.writeDoubleLE(2, 32); scale.writeBigInt64LE(0n, 40); scale.writeDoubleLE(2, 48);
    const entries: [number, Buffer][] = [
      [18, Buffer.concat([authority.toBuffer(), mint.toBuffer()])], [12, authority.toBuffer()], [6, Buffer.from([1])],
      [25, scale], [26, Buffer.concat([authority.toBuffer(), Buffer.from([0])])],
      [4, Buffer.concat([authority.toBuffer(), Buffer.from([0]), Buffer.alloc(32)])],
      [14, Buffer.concat([authority.toBuffer(), Buffer.alloc(32)])], [19, Buffer.alloc(1)],
    ];
    function tlv() { return Buffer.concat(entries.map(([type, bytes]) => { const head = Buffer.alloc(4); head.writeUInt16LE(type); head.writeUInt16LE(bytes.length, 2); return Buffer.concat([head, bytes]); })); }
    const info = { address: mint, mintAuthority: authority, freezeAuthority: authority, supply: 1000n, decimals: 8, isInitialized: true, tlvData: tlv() } satisfies Mint;
    expect(() => assertFixtureMint(info, authority)).not.toThrow();
    entries.find(([type]) => type === 26)![1][32] = 1;
    expect(() => assertFixtureMint({ ...info, tlvData: tlv() }, authority)).toThrow("disabled");
    entries.find(([type]) => type === 26)![1][32] = 0;
    authority.toBuffer().copy(entries.find(([type]) => type === 14)![1], 32);
    expect(() => assertFixtureMint({ ...info, tlvData: tlv() }, authority)).toThrow("mismatch");
  });
  it.each(["../historic", "/tmp/other", "test/escape", "", "test name"])("refuses a run path outside the isolated cache", id => expect(() => getRunDir(id)).toThrow());
  it("keeps read-only preparation entirely offline, without reading any payer file or creating fixtures", async () => {
    const fetch = vi.fn(() => { throw new Error("Read-only plan made a network request"); });
    vi.stubGlobal("fetch", fetch); const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const plan = await main(["--run-id", "offline-plan", "--payer", "/nonexistent/private-key.json"]);
      expect(plan).toMatchObject({ mode: "plan", cluster: "devnet", stateDirectory: `${RUNS_ROOT}/offline-plan`, decimals: 8 });
      expect(fetch).not.toHaveBeenCalled();
    } finally { log.mockRestore(); vi.unstubAllGlobals(); }
  });
});

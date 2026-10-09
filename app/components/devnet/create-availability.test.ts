import { describe, expect, it } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { namespacePrograms } from "../../lib/program-namespaces";
import { TEST_NAMESPACE, TEST_ROUTING } from "../../tests/namespace-fixture";
const PROGRAMS = namespacePrograms(TEST_NAMESPACE);
import retiredInventory from "../../../scripts/security/retired-keys.json";
import { checkCreateAvailability, withAvailableCreateFactory, CREATE_UNAVAILABLE_NOTICE, CreateFactoryUnavailableError } from "./create-availability";

const cleanTreasury = new PublicKey(TEST_NAMESPACE.creation.treasury!);
function fixture() {
  const [factory, bump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], PROGRAMS.factory);
  const data = Buffer.alloc(89); data.set([29,197,255,232,22,128,67,26]); cleanTreasury.toBuffer().copy(data, 40); data[88] = bump;
  data.writeUInt16LE(9000,72); data.writeUInt16LE(300,74); data.writeUInt16LE(100,76); data.writeUInt16LE(300,78);
  const info = { data, owner: PROGRAMS.factory, executable: false, lamports: 1, rentEpoch: 0 };
  let calls = 0;
  const connection = { getGenesisHash: async () => TEST_NAMESPACE.genesisHash, getAccountInfo: async (address: PublicKey, commitment: unknown) => {
    calls += 1; expect(address.equals(factory)).toBe(true); expect(commitment).toBe("finalized"); return info;
  } } as unknown as Pick<Connection, "getAccountInfo" | "getGenesisHash">;
  return { data, info, connection, calls: () => calls };
}

describe("early devnet creation availability", () => {
  it("production stays unavailable with no selected creation namespace before RPC or wallet-free preparation", async () => {
    const f = fixture(); let prepared = false;
    expect(await checkCreateAvailability(f.connection)).toBe("unavailable");
    await expect(withAvailableCreateFactory(f.connection, async () => { prepared = true; })).rejects.toThrow(CREATE_UNAVAILABLE_NOTICE);
    expect(f.calls()).toBe(0); expect(prepared).toBe(false);
  });

  it("checks the current factory before wallet-free availability and rechecks every preparation", async () => {
    const f = fixture(); expect(await checkCreateAvailability(f.connection, TEST_ROUTING)).toBe("ready");
    let preparations = 0;
    expect(await withAvailableCreateFactory(f.connection, async () => { preparations += 1; return "prepared"; }, TEST_ROUTING)).toBe("prepared");
    expect(f.calls()).toBe(2); expect(preparations).toBe(1);
    new PublicKey(retiredInventory.keys[0].publicKey).toBuffer().copy(f.data, 40);
    await expect(withAvailableCreateFactory(f.connection, async () => { preparations += 1; }, TEST_ROUTING)).rejects.toBeInstanceOf(CreateFactoryUnavailableError);
    expect(f.calls()).toBe(3); expect(preparations).toBe(1);
  });

  it("all retired treasuries stop deposit/ALT/wallet preparation and explain existing redemption", async () => {
    for (const { publicKey } of retiredInventory.keys) {
      const f = fixture(); new PublicKey(publicKey).toBuffer().copy(f.data, 40);
      expect(await checkCreateAvailability(f.connection, TEST_ROUTING)).toBe("unavailable");
      let prepared = false;
      await expect(withAvailableCreateFactory(f.connection, async () => { prepared = true; }, TEST_ROUTING)).rejects.toThrow(CREATE_UNAVAILABLE_NOTICE);
      expect(prepared).toBe(false);
    }
    expect(CREATE_UNAVAILABLE_NOTICE).toContain("Existing baskets can still be redeemed");
  });

  it("RPC failure, missing and malformed factories cannot become early ready state", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => { f.info.owner = PROGRAMS.basket; },
      (f: ReturnType<typeof fixture>) => { f.info.executable = true; },
      (f: ReturnType<typeof fixture>) => { f.data[88] ^= 1; },
      (f: ReturnType<typeof fixture>) => { f.data[0] ^= 1; },
    ]) {
      const f = fixture(); mutate(f); expect(await checkCreateAvailability(f.connection, TEST_ROUTING)).toBe("unavailable");
    }
    for (const result of ["missing", "failed"]) {
      const connection = { getGenesisHash: async () => TEST_NAMESPACE.genesisHash, getAccountInfo: async () => { if (result === "failed") throw new Error("provider unavailable"); return null; } } as unknown as Pick<Connection, "getAccountInfo" | "getGenesisHash">;
      expect(await checkCreateAvailability(connection, TEST_ROUTING)).toBe("unavailable");
    }
  });

  it("does not misclassify unrelated preparation failures as factory unavailability", async () => {
    const f = fixture(), failure = new Error("wallet changed");
    await expect(withAvailableCreateFactory(f.connection, async () => { throw failure; }, TEST_ROUTING)).rejects.toBe(failure);
  });
});

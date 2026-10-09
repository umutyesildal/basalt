import { describe, expect, it } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import { PROGRAMS } from "../../lib/solana";
import retiredInventory from "../../../scripts/security/retired-keys.json";
import { checkCreateAvailability, withAvailableCreateFactory, CREATE_UNAVAILABLE_NOTICE, CreateFactoryUnavailableError } from "./create-availability";

const cleanTreasury = new PublicKey(Uint8Array.from({ length: 32 }, () => 12));
function fixture() {
  const [factory, bump] = PublicKey.findProgramAddressSync([Buffer.from("factory")], PROGRAMS.factory);
  const data = Buffer.alloc(89); data.set([29,197,255,232,22,128,67,26]); cleanTreasury.toBuffer().copy(data, 40); data[88] = bump;
  const info = { data, owner: PROGRAMS.factory, executable: false, lamports: 1, rentEpoch: 0 };
  let calls = 0;
  const connection = { getAccountInfo: async (address: PublicKey, commitment: unknown) => {
    calls += 1; expect(address.equals(factory)).toBe(true); expect(commitment).toBe("finalized"); return info;
  } } as unknown as Pick<Connection, "getAccountInfo">;
  return { data, info, connection, calls: () => calls };
}

describe("early devnet creation availability", () => {
  it("checks the current factory before wallet-free availability and rechecks every preparation", async () => {
    const f = fixture(); expect(await checkCreateAvailability(f.connection)).toBe("ready");
    let preparations = 0;
    expect(await withAvailableCreateFactory(f.connection, async () => { preparations += 1; return "prepared"; })).toBe("prepared");
    expect(f.calls()).toBe(2); expect(preparations).toBe(1);
    new PublicKey(retiredInventory.keys[0].publicKey).toBuffer().copy(f.data, 40);
    await expect(withAvailableCreateFactory(f.connection, async () => { preparations += 1; })).rejects.toBeInstanceOf(CreateFactoryUnavailableError);
    expect(f.calls()).toBe(3); expect(preparations).toBe(1);
  });

  it("all retired treasuries stop deposit/ALT/wallet preparation and explain existing redemption", async () => {
    for (const { publicKey } of retiredInventory.keys) {
      const f = fixture(); new PublicKey(publicKey).toBuffer().copy(f.data, 40);
      expect(await checkCreateAvailability(f.connection)).toBe("unavailable");
      let prepared = false;
      await expect(withAvailableCreateFactory(f.connection, async () => { prepared = true; })).rejects.toThrow(CREATE_UNAVAILABLE_NOTICE);
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
      const f = fixture(); mutate(f); expect(await checkCreateAvailability(f.connection)).toBe("unavailable");
    }
    for (const result of ["missing", "failed"]) {
      const connection = { getAccountInfo: async () => { if (result === "failed") throw new Error("provider unavailable"); return null; } } as unknown as Pick<Connection, "getAccountInfo">;
      expect(await checkCreateAvailability(connection)).toBe("unavailable");
    }
  });

  it("does not misclassify unrelated preparation failures as factory unavailability", async () => {
    const f = fixture(), failure = new Error("wallet changed");
    await expect(withAvailableCreateFactory(f.connection, async () => { throw failure; })).rejects.toBe(failure);
  });
});

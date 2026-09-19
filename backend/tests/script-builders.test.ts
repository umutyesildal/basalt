import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

import {
  CREATOR_FEE_SPLIT_BPS,
  FACTORY_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  deriveFactoryConfig,
  ixInitFactory,
  sighash,
} from "../../scripts/lib.ts";

describe("ixInitFactory V0 wire compatibility", () => {
  it("keeps the discriminator + treasury + u16 split layout", () => {
    const authority = new PublicKey(new Uint8Array(32).fill(7));
    const treasury = new PublicKey(new Uint8Array(32).fill(8));
    const ix = ixInitFactory(authority, treasury);

    expect(ix.programId).toEqual(FACTORY_PROGRAM_ID);
    expect(ix.keys).toEqual([
      { pubkey: deriveFactoryConfig(), isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ]);
    expect(ix.data.length).toBe(8 + 32 + 2);
    expect(ix.data.subarray(0, 8)).toEqual(sighash("init_factory"));
    expect(ix.data.subarray(8, 40)).toEqual(treasury.toBuffer());
    expect(ix.data.readUInt16LE(40)).toBe(CREATOR_FEE_SPLIT_BPS);
    expect(ix.data.readUInt16LE(40)).toBe(9000);
  });

  it("keeps the legacy argument source-compatible but rejects overrides", () => {
    const authority = new PublicKey(new Uint8Array(32).fill(7));
    const treasury = new PublicKey(new Uint8Array(32).fill(8));

    expect(ixInitFactory(authority, treasury, 9000).data).toEqual(
      ixInitFactory(authority, treasury).data,
    );
    expect(() => ixInitFactory(authority, treasury, 5000)).toThrow(RangeError);
  });
});

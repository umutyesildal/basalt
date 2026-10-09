import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  ExtensionType,
  ScaledUiAmountConfigLayout,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  deriveVaultAuthority,
  getVaultAtas,
  fetchMintFacts,
  fetchMultiplier,
  parseScaledUiMultiplierFromMintData,
  syncHoldings,
  type SolanaRpc,
} from "../src/indexer/holdingsSync";

// AAPLx mint extension values verified from Solana mainnet on 2026-10-03.
const previous = 1.0026642075893797;
const activated = 1.0032690125398187;
const activation = 1_786_149_000n;
const mint = new PublicKey("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp");
const account = (data: Buffer): AccountInfo<Buffer> => ({
  data, owner: TOKEN_2022_PROGRAM_ID, executable: false, lamports: 1,
});

function mintData(old = previous, next = activated, at = activation): Buffer {
  const data = Buffer.alloc(166 + 4 + ScaledUiAmountConfigLayout.span);
  data[44] = 8;
  data[45] = 1;
  data[165] = 1;
  data.writeUInt16LE(ExtensionType.ScaledUiAmountConfig, 166);
  data.writeUInt16LE(ScaledUiAmountConfigLayout.span, 168);
  ScaledUiAmountConfigLayout.encode({
    authority: PublicKey.default,
    multiplier: old,
    newMultiplier: next,
    newMultiplierEffectiveTimestamp: at,
  }, data, 170);
  return data;
}

const clockAt = (seconds: bigint, milliseconds = 0) => () =>
  new Date(Number(seconds) * 1_000 + milliseconds);

afterEach(() => vi.useRealTimers());

describe("scheduled xStocks multiplier", () => {
  it("keeps the previous multiplier through the millisecond before activation", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(), clockAt(activation - 1n, 999)))
      .toBe(previous);
  });

  it("activates the new multiplier at the exact timestamp", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(), clockAt(activation)))
      .toBe(activated);
  });

  it("continues using the effective value when the stored previous value remains old", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(), () => new Date("2026-10-03T00:00:00Z")))
      .toBe(activated);
  });

  it("handles an immediate activation and a reverse split", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(4, 2, 0n), clockAt(activation)))
      .toBe(2);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid active multiplier %s instead of returning the obsolete one",
    (invalid) => {
      expect(parseScaledUiMultiplierFromMintData(mintData(previous, invalid), clockAt(activation)))
        .toBeNull();
    },
  );

  it("does not apply invalid future data before its activation", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(previous, 0), clockAt(activation - 1n)))
      .toBe(previous);
  });

  it("returns null for an invalid clock", () => {
    expect(parseScaledUiMultiplierFromMintData(mintData(), () => new Date(Number.NaN)))
      .toBeNull();
  });

  it("propagates the active value through mint facts and holdings without changing raw tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
    const vault = new PublicKey(Buffer.alloc(32, 2));
    const ata = getVaultAtas(vault, [mint])[0];
    const tokenData = Buffer.alloc(165);
    mint.toBuffer().copy(tokenData, 0);
    deriveVaultAuthority(vault).toBuffer().copy(tokenData, 32);
    tokenData.writeBigUInt64LE(100_000_000n, 64);
    tokenData[108] = 1;
    const rpc: SolanaRpc = {
      async getAccountInfo() { return account(mintData()); },
      async getMultipleAccountsInfo() { return [account(tokenData)]; },
    };
    expect(await fetchMintFacts(rpc, mint)).toEqual({ multiplier: activated, decimals: 8 });
    expect(await fetchMultiplier(rpc, mint)).toBe(activated);
    const [holding] = await syncHoldings(rpc, vault, [ata], [mint]);
    expect(holding.raw).toBe(100_000_000n);
    expect(holding.rawAmount).toBe("100000000");
    expect(holding.multiplier).toBe(activated);
    expect(holding.scaledAmount).toBe("1.003269013");
    expect(holding.scaled).toBeCloseTo(1.003269013, 9);
  });
});

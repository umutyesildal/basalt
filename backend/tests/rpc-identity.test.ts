import { describe, it, expect } from "vitest";
import { readIndexerGenesisHash } from "../src/indexer/rpcIdentity";
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const reply = () => ({ jsonrpc: "2.0", id: 1, result: genesis });
describe("bounded startup RPC identity", () => {
  it("sends only an unsigned genesis read, disables redirects and enforces a deadline", async () => {
    let calls=0;
    const mock: typeof fetch = async (input, init) => {
      calls++; expect(input).toBe("https://rpc.example"); expect(JSON.parse(String(init?.body))).toEqual({ jsonrpc: "2.0", id: 1, method: "getGenesisHash", params: [] });
      expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify(reply()));
    };
    expect(await readIndexerGenesisHash("https://rpc.example", mock)).toBe(genesis); expect(calls).toBe(1);
  });
  it.each([{ id: 2 }, { jsonrpc: "1.0" }, { result: null }, { result: "0".repeat(44) }, { error: { message: "private provider detail" } }])("rejects invalid identity envelope %j", async update => {
    await expect(readIndexerGenesisHash("https://rpc.example", async () => new Response(JSON.stringify({ ...reply(), ...update })))).rejects.toThrow("Invalid RPC identity");
  });
  it("rejects oversized, unsuccessful and malformed replies", async () => {
    await expect(readIndexerGenesisHash("https://rpc.example", async () => new Response("x".repeat(16_385)))).rejects.toThrow("too large");
    await expect(readIndexerGenesisHash("https://rpc.example", async () => new Response("private detail", { status: 429 }))).rejects.toThrow("RPC identity unavailable");
    await expect(readIndexerGenesisHash("https://rpc.example", async () => new Response("invalid"))).rejects.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { extractAttributedProgramDataLogs } from "../src/indexer/events";

const factory = new PublicKey(Buffer.alloc(32, 7)).toBase58();
const basket = new PublicKey(Buffer.alloc(32, 8)).toBase58();
const foreign = new PublicKey(Buffer.alloc(32, 9)).toBase58();
const payload = Buffer.from("event bytes");
const data = `Program data: ${payload.toString("base64")}`;

describe("Anchor runtime event attribution", () => {
  it("attributes nested events and restores the parent after success", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, data,
      `Program ${basket} invoke [2]`, data, `Program ${basket} success`, data, `Program ${factory} success`, data]);
    expect(rows.map(row => row.programId)).toEqual([factory, basket, factory]);
    expect(rows.every(row => row.payload.equals(payload))).toBe(true);
  });

  it("preserves a foreign nested emitter even when its event bytes match", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${basket} invoke [1]`, `Program ${foreign} invoke [2]`, data,
      `Program ${foreign} success`, data, `Program ${basket} success`]);
    expect(rows.map(row => row.programId)).toEqual([foreign, basket]);
  });

  it("rejects unattributed bytes and spoofed invocation/data text from user logs", () => {
    const rows = extractAttributedProgramDataLogs([data, `Program log: Program ${factory} invoke [1]`, data,
      `Program ${foreign} invoke [1]`, `Program log: Program ${basket} invoke [2]`,
      `Program log: ${data}`, data, `Program ${foreign} success`]);
    expect(rows.map(row => row.programId)).toEqual([foreign]);
  });

  it("clears ambiguous depth/completion stacks and recovers at the next root", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, `Program ${basket} invoke [3]`, data,
      `Program ${factory} success`, data, `Program ${basket} invoke [1]`, `Program ${foreign} success`, data,
      `Program ${factory} invoke [1]`, data, `Program ${factory} success`]);
    expect(rows.map(row => row.programId)).toEqual([factory]);
  });

  it("failed CPI completion returns to the parent and malformed base64 is ignored", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, `Program ${foreign} invoke [2]`,
      `Program ${foreign} failed: custom program error: 0x1`, "Program data: not-base64!!", "Program data: AA=A",
      "Program data: ", data, `Program ${factory} success`]);
    expect(rows.map(row => row.programId)).toEqual([factory]);
  });

  it("discards a trusted CPI's rolled-back events when its caller catches failure", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, data,
      `Program ${basket} invoke [2]`, data, `Program ${basket} failed: custom program error: 0x1`,
      data, `Program ${factory} success`]);
    expect(rows.map(row => row.programId)).toEqual([factory, factory]);
  });

  it("discards successful child events when their parent invocation later fails", () => {
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, `Program ${basket} invoke [2]`, data,
      `Program ${foreign} invoke [3]`, data, `Program ${foreign} success`, `Program ${basket} success`,
      `Program ${factory} failed: custom program error: 0x1`]);
    expect(rows).toEqual([]);
  });

  it("never commits truncated or malformed invocation frames", () => {
    expect(extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, data,
      `Program ${basket} invoke [2]`, data, `Program ${basket} success`])).toEqual([]);
    expect(extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, data,
      `Program ${basket} invoke [3]`, `Program ${factory} success`])).toEqual([]);
    const rows = extractAttributedProgramDataLogs([`Program ${factory} invoke [1]`, data,
      `Program ${basket} invoke [1]`, data, `Program ${basket} success`]);
    expect(rows.map(row => row.programId)).toEqual([basket]);
  });
});

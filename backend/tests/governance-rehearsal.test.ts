import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  assertLoopbackRpc,
  assertNoFinalCommand,
  parseExecutableAccount,
  parseProgramShow,
  validateAuthorityTransition,
  validateRehearsalArgs,
} from "../../scripts/governance-rehearsal.mjs";

const operator = "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS";
const governance = "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF";
const programData = "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k";

describe("governance rehearsal guardrails", () => {
  it.each([
    "http://127.0.0.1:8899",
    "http://localhost:8899",
    "https://[::1]:8899",
  ])("accepts loopback RPC %s", (url) => {
    expect(assertLoopbackRpc(url).hostname).toBeTruthy();
  });

  it.each([
    "https://api.devnet.solana.com",
    "https://api.mainnet-beta.solana.com",
    "http://192.168.1.10:8899",
    "http://127.0.0.1.example.com:8899",
    "http://127.0.0.1:8899/rpc",
    "http://127.0.0.1:8899/?cluster=devnet",
    "ftp://localhost:8899",
    "http://user:password@localhost:8899",
  ])("rejects non-loopback or unsafe RPC %s", (url) => {
    expect(() => assertLoopbackRpc(url)).toThrow();
  });

  it("requires explicit artifact and program keypair paths", () => {
    expect(() =>
      validateRehearsalArgs({
        rpcUrl: "http://127.0.0.1:8899",
        programSo: "",
        programKeypair: "program.json",
      }),
    ).toThrow("explicit .so path");
    expect(() =>
      validateRehearsalArgs({
        rpcUrl: "http://127.0.0.1:8899",
        programSo: "program.so",
        programKeypair: "",
      }),
    ).toThrow("explicit .json path");
  });

  it("parses authority evidence and requires executable program accounts", () => {
    expect(
      parseProgramShow({ authority: operator, programdataAddress: programData }),
    ).toEqual({ authority: operator, programDataAddress: programData });
    expect(parseExecutableAccount({ account: { executable: true } })).toBe(true);
    expect(() => parseExecutableAccount({ account: { executable: false } })).toThrow(
      "not executable",
    );
  });

  it("enforces the complete transfer, rejection, and rollback state machine", () => {
    expect(
      validateAuthorityTransition({
        operator,
        governance,
        before: { authority: operator, programDataAddress: programData },
        transferred: { authority: governance, programDataAddress: programData },
        oldOperatorRejected: true,
        rolledBack: { authority: operator, programDataAddress: programData },
      }),
    ).toBe(true);
    expect(() =>
      validateAuthorityTransition({
        operator,
        governance,
        before: { authority: operator, programDataAddress: programData },
        transferred: { authority: governance, programDataAddress: programData },
        oldOperatorRejected: false,
        rolledBack: { authority: operator, programDataAddress: programData },
      }),
    ).toThrow("former operator");
  });

  it("forbids irreversible finalization and keeps it out of the shell commands", () => {
    expect(() => assertNoFinalCommand(["solana", "program", "set-upgrade-authority", "--final"])).toThrow(
      "finalization",
    );
    const script = readFileSync(
      fileURLToPath(new URL("../../scripts/rehearse-governance-localnet.sh", import.meta.url)),
      "utf8",
    );
    expect(script).not.toContain("--final");
    expect(script).toContain('kill -0 "$VALIDATOR_PID"');
    expect(script).toContain("export COPYFILE_DISABLE=1");
    expect(script).toContain('solana airdrop 20 "$OPERATOR_PUBKEY"');
    expect(script).toContain('solana airdrop 20 "$GOVERNANCE_PUBKEY"');
  });
});

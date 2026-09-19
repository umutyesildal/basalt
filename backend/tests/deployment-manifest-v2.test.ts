import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const generator = fileURLToPath(
  new URL("../../scripts/generate-deployment-manifest.mjs", import.meta.url),
);

const authority = "FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS";
const multisig = "3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF";
const signerA = "6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k";
const signerB = "9u5eEx1CLQd68ZTdcDKy3BqqT6FKGR3CvrApmdgb5btg";
const signerC = "7xo7uw13B4DnfwAMGQ9MC5qkX2zD2rUp94j4UBQ61eSE";

function generate(args: string[] = []) {
  const stdout = execFileSync(
    process.execPath,
    [generator, "--no-elf", "--generated-at", "2026-09-19T00:00:00.000Z", ...args],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

describe("deployment manifest v2 governance evidence", () => {
  it("uses honest unknown and not-run defaults", () => {
    const manifest = generate();

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.deployment.status).toBe("not-attested");
    expect(manifest.deployment.upgradeAuthority).toBeNull();
    expect(manifest.deployment.governance).toEqual({
      authorityModel: "unknown",
      authoritySource: "unknown",
      authorityVerifiedAt: null,
      multisigAddress: null,
      threshold: null,
      signerCount: null,
      signers: [],
      timelock: {
        status: "unknown",
        delaySeconds: null,
        announcementPeriodSeconds: null,
        policyUrl: null,
      },
      transferRehearsal: {
        status: "not-run",
        transaction: null,
        verifiedAt: null,
      },
    });
    expect(manifest.programs.basket.authoritySource).toBe("unknown");
    expect(manifest.programs.basket.authorityVerifiedAt).toBeNull();
  });

  it("labels single-key input as operator-declared rather than verified", () => {
    const manifest = generate([
      "--authority-model",
      "single-key",
      "--upgrade-authority",
      authority,
      "--deployed-slot",
      "123",
    ]);

    expect(manifest.deployment.status).toBe("attested-inputs");
    expect(manifest.deployment.governance.authorityModel).toBe("single-key");
    expect(manifest.deployment.governance.authoritySource).toBe("operator-declaration");
    expect(manifest.deployment.governance.authorityVerifiedAt).toBeNull();
    expect(manifest.programs.whitelist.authoritySource).toBe("operator-declaration");
  });

  it("records a complete declared multisig policy without turning it into RPC proof", () => {
    const manifest = generate([
      "--authority-model",
      "multisig",
      "--upgrade-authority",
      authority,
      "--multisig-address",
      multisig,
      "--threshold",
      "2",
      "--signer-count",
      "3",
      "--signer",
      `Protocol Maintainer=${signerA}`,
      "--signer",
      `Security Lead=${signerB}`,
      "--signer",
      `Operations Lead=${signerC}`,
      "--timelock-status",
      "configured",
      "--timelock-delay-seconds",
      "172800",
      "--announcement-seconds",
      "172800",
      "--governance-policy-url",
      "https://example.com/governance",
    ]);

    expect(manifest.deployment.status).toBe("attested-inputs");
    expect(manifest.deployment.governance).toMatchObject({
      authorityModel: "multisig",
      authoritySource: "operator-declaration",
      multisigAddress: multisig,
      threshold: 2,
      signerCount: 3,
      timelock: {
        status: "configured",
        delaySeconds: 172800,
        announcementPeriodSeconds: 172800,
      },
    });
    expect(manifest.deployment.governance.signers).toHaveLength(3);
    expect(manifest.deployment.governance.authorityVerifiedAt).toBeNull();
  });

  it("rejects unsafe threshold and offline RPC-verification claims", () => {
    const unsafeThreshold = spawnSync(
      process.execPath,
      [
        generator,
        "--no-elf",
        "--authority-model",
        "multisig",
        "--upgrade-authority",
        authority,
        "--multisig-address",
        multisig,
        "--threshold",
        "3",
        "--signer-count",
        "3",
        "--signer",
        `Protocol=${signerA}`,
        "--signer",
        `Security=${signerB}`,
        "--signer",
        `Operations=${signerC}`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(unsafeThreshold.status).not.toBe(0);
    expect(unsafeThreshold.stderr).toContain("threshold must be lower than signer count");

    const fakeRpcProof = spawnSync(
      process.execPath,
      [generator, "--no-elf", "--authority-source", "rpc"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    expect(fakeRpcProof.status).not.toBe(0);
    expect(fakeRpcProof.stderr).toContain("cannot claim RPC verification");
  });

  it("keeps the template and schema on version 2", () => {
    const schema = JSON.parse(
      readFileSync(`${repoRoot}/deploy/deployment-manifest.schema.json`, "utf8"),
    );
    const template = JSON.parse(
      readFileSync(`${repoRoot}/deploy/deployment-manifest.template.json`, "utf8"),
    );

    expect(schema.properties.schemaVersion.const).toBe(2);
    expect(template.schemaVersion).toBe(2);
    expect(template.deployment.governance.authorityModel).toBe("unknown");
    expect(template.programs.basket.authoritySource).toBe("unknown");
  });
});

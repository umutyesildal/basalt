import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { PROGRAM_NAMESPACES, DEVNET_OWNER_NAMESPACE } from "../../backend/src/config/programNamespaces";
import { createNamespaceRouting } from "./program-namespaces";
import { buildAccrueManagementFee, deriveAta, deriveShareMint, deriveVaultAuthority, type BasketCoreKeys } from "./transactions";
import { TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "./token-2022";

const roles = ["basket", "share_mint", "payer", "vault_authority", "creator", "creator_share_ata", "treasury", "treasury_share_ata", "token_program", "associated_token_program", "system_program"];
test("fee crank matches the actual Anchor AccrueFee ABI without a user-share account", () => {
  const source = readFileSync(new URL("../../programs/basket/src/lib.rs", import.meta.url), "utf8");
  const context = source.split("pub struct AccrueFee<'info> {")[1].split("\n}\n")[0];
  assert.deepEqual([...context.matchAll(/pub (\w+):/g)].map(match => match[1]), roles);
  for (const namespace of [PROGRAM_NAMESPACES[0], DEVNET_OWNER_NAMESPACE]) {
    const routing = createNamespaceRouting([namespace]), basket = Keypair.generate().publicKey;
    const keys: BasketCoreKeys = { basket, factory: new PublicKey(namespace.factoryConfig), shareMint: deriveShareMint(basket, new PublicKey(namespace.programs.factory))[0],
      creator: Keypair.generate().publicKey, treasury: Keypair.generate().publicKey, user: Keypair.generate().publicKey, constituents: [] };
    const result = buildAccrueManagementFee(keys, routing), instruction = result.instructions[0];
    assert.equal(instruction.programId.toBase58(), namespace.programs.basket);
    assert.deepEqual(result.expectedAccounts.map(account => account.label), roles);
    assert.deepEqual(instruction.keys.map(account => account.pubkey.toBase58()), [keys.basket, keys.shareMint, keys.user,
      deriveVaultAuthority(keys.basket, new PublicKey(namespace.programs.basket))[0], keys.creator, deriveAta(keys.creator, keys.shareMint),
      keys.treasury, deriveAta(keys.treasury, keys.shareMint), TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, SystemProgram.programId].map(String));
    assert.deepEqual(instruction.keys.map(account => account.isSigner), roles.map(role => role === "payer"));
    assert.deepEqual(instruction.keys.map(account => account.isWritable), roles.map(role => ["basket", "share_mint", "payer", "creator_share_ata", "treasury_share_ata"].includes(role)));
    assert(!instruction.keys.some(account => account.pubkey.equals(deriveAta(keys.user, keys.shareMint))));
  }
});

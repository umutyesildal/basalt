/** Project-issued devnet fixtures, never official xStocks. No network or signer access. */
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import {
  AccountState, ExtensionType, TOKEN_2022_PROGRAM_ID, TYPE_SIZE, LENGTH_SIZE,
  createInitializeMetadataPointerInstruction, createInitializePermanentDelegateInstruction,
  createInitializeDefaultAccountStateInstruction, createInitializeScaledUiAmountConfigInstruction,
  createInitializePausableConfigInstruction, createInitializeTransferHookInstruction,
  createInitializeMint2Instruction, getMintLen, getExtensionTypes, getExtensionData,
  getDefaultAccountState, getScaledUiAmountConfig, getPausableConfig, getTransferHook,
  getMetadataPointerState, getPermanentDelegate, type Mint,
  createPauseInstruction, createResumeInstruction, createUpdateTransferHookInstruction,
  createUpdateMultiplierDataInstruction, createUpdateDefaultAccountStateInstruction,
} from "@solana/spl-token";
import { createInitializeInstruction, pack } from "@solana/spl-token-metadata";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const FIXTURE_DECIMALS = 8;
export const FIXTURE_PROFILE = "xstocks-eight-extension-devnet-mock-v1";
export const FIXTURE_EXTENSIONS = [18, 12, 6, 25, 26, 4, 14, 19] as const;
export const FIXED_EXTENSIONS = FIXTURE_EXTENSIONS.filter(id => id !== ExtensionType.TokenMetadata) as ExtensionType[];

/**
 * Official SPL wire schema: outer TokenInstruction::ConfidentialTransferExtension=27,
 * inner InitializeMint=0, OptionalNonZeroPubkey(32), PodBool(1), optional ElGamal key(32).
 * https://github.com/solana-program/token-2022/blob/main/interface/src/extension/confidential_transfer/instruction.rs
 * The JS0.4.15 client has no constructor for this instruction. We configure no confidential
 * token account balances or proofs; the extension's presence mirrors the observed mint profile.
 */
export function initializeConfidentialMint(mint: PublicKey, authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN_2022_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([Buffer.from([27, 0]), authority.toBuffer(), Buffer.from([0]), Buffer.alloc(32)]),
  });
}
export function fixtureMetadata(mint: PublicKey, authority: PublicKey, letter: string) {
  if (!/^[A-D]$/.test(letter)) throw new Error("Fixture letter must be A-D");
  return { mint, updateAuthority: authority, name: `Basalt devnet fixture ${letter}`, symbol: `BSTEST${letter}`,
    uri: `https://example.invalid/basalt/devnet/fixture-${letter.toLowerCase()}.json`, additionalMetadata: [] };
}
export function fixtureSizes(mint: PublicKey, authority: PublicKey, letter: string) {
  const metadata = fixtureMetadata(mint, authority, letter);
  const initial = getMintLen(FIXED_EXTENSIONS);
  return { initial, final: initial + TYPE_SIZE + LENGTH_SIZE + pack(metadata).length, metadata };
}
export function buildFixtureMint(mint: PublicKey, authority: PublicKey, letter: string, rentLamports: number, multiplier = 1) {
  if (!Number.isSafeInteger(rentLamports) || rentLamports <= 0 || !Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Invalid fixture rent or multiplier");
  const size = fixtureSizes(mint, authority, letter);
  return [
    SystemProgram.createAccount({ fromPubkey: authority, newAccountPubkey: mint, space: size.initial, lamports: rentLamports, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMetadataPointerInstruction(mint, authority, mint, TOKEN_2022_PROGRAM_ID),
    createInitializePermanentDelegateInstruction(mint, authority, TOKEN_2022_PROGRAM_ID),
    createInitializeDefaultAccountStateInstruction(mint, AccountState.Initialized, TOKEN_2022_PROGRAM_ID),
    createInitializeScaledUiAmountConfigInstruction(mint, authority, multiplier, TOKEN_2022_PROGRAM_ID),
    createInitializePausableConfigInstruction(mint, authority, TOKEN_2022_PROGRAM_ID),
    initializeConfidentialMint(mint, authority),
    // All-zero OptionalNonZeroPubkey means no active hook, not a call to SystemProgram.
    createInitializeTransferHookInstruction(mint, authority, PublicKey.default, TOKEN_2022_PROGRAM_ID),
    createInitializeMint2Instruction(mint, FIXTURE_DECIMALS, authority, authority, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({ programId: TOKEN_2022_PROGRAM_ID, metadata: mint, mint, mintAuthority: authority,
      updateAuthority: authority, name: size.metadata.name, symbol: size.metadata.symbol, uri: size.metadata.uri }),
  ];
}
export function assertFixtureMint(mint: Mint, authority: PublicKey): void {
  const types = getExtensionTypes(mint.tlvData).sort((a, b) => a - b);
  if (types.join() !== [...FIXTURE_EXTENSIONS].sort((a, b) => a - b).join()) throw new Error("Fixture extension profile mismatch");
  if (!mint.isInitialized || mint.decimals !== FIXTURE_DECIMALS || !mint.mintAuthority?.equals(authority) || !mint.freezeAuthority?.equals(authority)) throw new Error("Fixture base mint mismatch");
  if (getDefaultAccountState(mint)?.state !== AccountState.Initialized || getPausableConfig(mint)?.paused !== false) throw new Error("Fixture transfers are disabled");
  const hook = getTransferHook(mint), scale = getScaledUiAmountConfig(mint), pointer = getMetadataPointerState(mint);
  if (!hook?.authority.equals(authority) || !hook.programId.equals(PublicKey.default) || !pointer?.authority?.equals(authority) || !pointer.metadataAddress?.equals(mint.address)
    || !getPermanentDelegate(mint)?.delegate.equals(authority) || !scale?.authority?.equals(authority) || !Number.isFinite(scale.multiplier) || scale.multiplier <= 0) throw new Error("Fixture authority or multiplier mismatch");
  const confidential = getExtensionData(ExtensionType.ConfidentialTransferMint, mint.tlvData);
  if (!confidential || confidential.length !== 65 || !confidential.subarray(0, 32).equals(authority.toBuffer()) || confidential[32] !== 0 || !confidential.subarray(33).equals(Buffer.alloc(32))) throw new Error("Fixture confidential mint configuration mismatch");
}
/** Instructions for explicit negative tests. These functions do not sign or send. */
export const fixtureMutations = {
  pause: (mint: PublicKey, authority: PublicKey) => createPauseInstruction(mint, authority, [], TOKEN_2022_PROGRAM_ID),
  resume: (mint: PublicKey, authority: PublicKey) => createResumeInstruction(mint, authority, [], TOKEN_2022_PROGRAM_ID),
  hook: (mint: PublicKey, authority: PublicKey, program: PublicKey | null) => createUpdateTransferHookInstruction(mint, authority, program ?? PublicKey.default, [], TOKEN_2022_PROGRAM_ID),
  multiplier: (mint: PublicKey, authority: PublicKey, value: number, at: bigint) => createUpdateMultiplierDataInstruction(mint, authority, value, at, [], TOKEN_2022_PROGRAM_ID),
  defaultState: (mint: PublicKey, authority: PublicKey, state: AccountState) => createUpdateDefaultAccountStateInstruction(mint, state, authority, [], TOKEN_2022_PROGRAM_ID),
};

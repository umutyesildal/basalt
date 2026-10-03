/** Project-issued devnet mocks only. Wallet signs; this module never signs or sends. */
import { Buffer } from "buffer";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, unpackAccount } from "./token-2022";

export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const DEVNET_FAUCET_PROGRAM_ID = new PublicKey("2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf");
export const DEVNET_FAUCET_CLAIM_RAW = 100_000_000_000n;
export const DEVNET_MOCK_TOKENS = [
  { letter: "A", symbol: "BSTESTA", name: "Basalt devnet fixture A", mint: new PublicKey("CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ"), decimals: 8, multiplier: 1 },
  { letter: "B", symbol: "BSTESTB", name: "Basalt devnet fixture B", mint: new PublicKey("EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab"), decimals: 8, multiplier: 1.25 },
  { letter: "C", symbol: "BSTESTC", name: "Basalt devnet fixture C", mint: new PublicKey("5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA"), decimals: 8, multiplier: 2 },
  { letter: "D", symbol: "BSTESTD", name: "Basalt devnet fixture D", mint: new PublicKey("8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq"), decimals: 8, multiplier: 10 },
] as const;
export function deriveDevnetFaucetAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("faucet")], DEVNET_FAUCET_PROGRAM_ID)[0];
}
export function deriveDevnetFaucetClaim(wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("claim"), wallet.toBuffer()], DEVNET_FAUCET_PROGRAM_ID)[0];
}
export function deriveDevnetFaucetVault(mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, deriveDevnetFaucetAuthority(), true, TOKEN_2022_PROGRAM_ID);
}
/** Exact program account order: wallet, claim, authority, System, Token-2022, then A-D triplets. */
export function buildDevnetFaucetClaim(wallet: PublicKey): TransactionInstruction[] {
  const atas = DEVNET_MOCK_TOKENS.map(({ mint }) => getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID));
  return [
    ...DEVNET_MOCK_TOKENS.map(({ mint }, i) => createAssociatedTokenAccountIdempotentInstruction(wallet, atas[i], wallet, mint, TOKEN_2022_PROGRAM_ID)),
    new TransactionInstruction({ programId: DEVNET_FAUCET_PROGRAM_ID, data: Buffer.from([0]), keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: deriveDevnetFaucetClaim(wallet), isSigner: false, isWritable: true },
      { pubkey: deriveDevnetFaucetAuthority(), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ...DEVNET_MOCK_TOKENS.flatMap(({ mint }, i) => [
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: deriveDevnetFaucetVault(mint), isSigner: false, isWritable: true },
        { pubkey: atas[i], isSigner: false, isWritable: true },
      ]),
    ] }),
  ];
}
/** Must run before presenting a claim for wallet signing, including after reconnects. */
export async function assertDevnetFaucetReady(connection: Connection): Promise<void> {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Test tokens are available on Solana devnet only.");
  const accounts = await connection.getMultipleAccountsInfo([DEVNET_FAUCET_PROGRAM_ID, ...DEVNET_MOCK_TOKENS.map(({ mint }) => deriveDevnetFaucetVault(mint))], "confirmed");
  if (!accounts[0]?.executable) throw new Error("The devnet test-token faucet is not deployed yet.");
  const authority = deriveDevnetFaucetAuthority();
  DEVNET_MOCK_TOKENS.forEach(({ mint }, i) => {
    const info = accounts[i + 1];
    if (!info) throw new Error("The devnet test-token faucet is not funded yet.");
    const vault = unpackAccount(deriveDevnetFaucetVault(mint), info, TOKEN_2022_PROGRAM_ID);
    if (!vault.owner.equals(authority) || !vault.mint.equals(mint) || vault.isFrozen || vault.amount < DEVNET_FAUCET_CLAIM_RAW) throw new Error("The devnet test-token faucet is unavailable.");
  });
}
export async function readDevnetFaucetClaimed(connection: Connection, wallet: PublicKey): Promise<boolean> {
  if (await connection.getGenesisHash() !== DEVNET_GENESIS_HASH) throw new Error("Test tokens are available on Solana devnet only.");
  const account = await connection.getAccountInfo(deriveDevnetFaucetClaim(wallet), "confirmed");
  if (!account || account.owner.equals(SystemProgram.programId) && account.data.length === 0) return false;
  if (!account.owner.equals(DEVNET_FAUCET_PROGRAM_ID) || account.data.length !== 1 || account.data[0] !== 1) throw new Error("The test-token claim record could not be verified.");
  return true;
}

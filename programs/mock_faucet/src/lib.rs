//! Fixed project-issued devnet mock faucet. No mint, admin or withdrawal path.
//! Clients MUST check the devnet genesis hash: that hash is not an onchain sysvar.
//! Token identities and program identity are fixed to this devnet deployment.
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    pubkey, pubkey::Pubkey,
    rent::Rent, system_instruction, system_program,
    sysvar::Sysvar,
};

solana_program::declare_id!("2GBfjd9jPKLoqNXdX7GDN9MHRKwzwXbHk65xQVf9HAcf");
#[cfg(not(feature = "no-entrypoint"))]
solana_program::entrypoint!(process_instruction);

pub const TOKEN_2022: Pubkey = pubkey!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
pub const ASSOCIATED_TOKEN: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const MINTS: [Pubkey; 4] = [
    pubkey!("CrjoC7fq5XAbdej5zjinKNGXVqo8E8qCmh8XSiu2QViQ"),
    pubkey!("EpH2swtxW2rCuFg2o2ukD5Qw5Xv3toaug1M3mbcB4hab"),
    pubkey!("5G1hMSqs2nWKaFQt737FTxwnruPgeQqQWZ2FRoqxvehA"),
    pubkey!("8W2hrfJPPrXEBjs5gDgpVZcs8HsELeHkBaqSjnUvgJUq"),
];
pub const DECIMALS: u8 = 8;
pub const CLAIM_RAW: u64 = 100_000_000_000; // RAW ONLY: 1,000 * 10^8 per mint.
pub const CLAIM_LEN: usize = 1;
pub const ALREADY_CLAIMED: u32 = 0;

fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_2022.as_ref(), mint.as_ref()], &ASSOCIATED_TOKEN).0
}
fn validate_token_account(data: &[u8], mint: &Pubkey, authority: &Pubkey) -> ProgramResult {
    // Token-2022 retains the 165-byte SPL account prefix. Its own CPI validates TLVs.
    if data.len() < 165 || data[..32] != mint.to_bytes() || data[32..64] != authority.to_bytes() || data[108] != 1 {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}
fn transfer_checked(source: &Pubkey, mint: &Pubkey, destination: &Pubkey, authority: &Pubkey) -> Instruction {
    // Official TokenInstruction::TransferChecked wire format; token program pinned.
    let mut data = vec![12];
    data.extend_from_slice(&CLAIM_RAW.to_le_bytes());
    data.push(DECIMALS);
    Instruction { program_id: TOKEN_2022, accounts: vec![
        AccountMeta::new(*source, false), AccountMeta::new_readonly(*mint, false),
        AccountMeta::new(*destination, false), AccountMeta::new_readonly(*authority, true),
    ], data }
}

/// Claim accounts: signer/payer, claim PDA, faucet authority PDA, System, Token-2022,
/// then four ordered [mint, faucet ATA, wallet ATA] triplets. Only data [0] is accepted.
pub fn process_instruction(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    if program_id != &id() { return Err(ProgramError::IncorrectProgramId); }
    if data != [0] || accounts.len() != 17 { return Err(ProgramError::InvalidInstructionData); }
    let mut iter = accounts.iter();
    let user = next_account_info(&mut iter)?;
    let claim = next_account_info(&mut iter)?;
    let authority = next_account_info(&mut iter)?;
    let system = next_account_info(&mut iter)?;
    let token = next_account_info(&mut iter)?;
    if !user.is_signer { return Err(ProgramError::MissingRequiredSignature); }
    if !user.is_writable || !claim.is_writable { return Err(ProgramError::InvalidAccountData); }
    if system.key != &system_program::id() || token.key != &TOKEN_2022 || !system.executable || !token.executable {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (expected_authority, authority_bump) = Pubkey::find_program_address(&[b"faucet"], program_id);
    let (expected_claim, claim_bump) = Pubkey::find_program_address(&[b"claim", user.key.as_ref()], program_id);
    if authority.key != &expected_authority || claim.key != &expected_claim { return Err(ProgramError::InvalidSeeds); }
    if claim.owner == program_id { return Err(ProgramError::Custom(ALREADY_CLAIMED)); }
    if claim.owner != &system_program::id() || !claim.data_is_empty() { return Err(ProgramError::IllegalOwner); }

    // Validate all destinations and funded sources before allocating or transferring.
    for (i, mint) in MINTS.iter().enumerate() {
        let mint_account = &accounts[5 + i * 3];
        let source = &accounts[6 + i * 3];
        let destination = &accounts[7 + i * 3];
        if mint_account.key != mint || mint_account.owner != &TOKEN_2022 || source.owner != &TOKEN_2022 || destination.owner != &TOKEN_2022 {
            return Err(ProgramError::IncorrectProgramId);
        }
        if !source.is_writable || !destination.is_writable || source.key != &ata(authority.key, mint) || destination.key != &ata(user.key, mint) {
            return Err(ProgramError::InvalidAccountData);
        }
        let mint_data = mint_account.try_borrow_data()?;
        if mint_data.len() < 82 || mint_data[44] != DECIMALS || mint_data[45] != 1 { return Err(ProgramError::InvalidAccountData); }
        let source_data = source.try_borrow_data()?;
        validate_token_account(&source_data, mint, authority.key)?;
        let amount = u64::from_le_bytes(source_data[64..72].try_into().map_err(|_| ProgramError::InvalidAccountData)?);
        if amount < CLAIM_RAW { return Err(ProgramError::InsufficientFunds); }
        validate_token_account(&destination.try_borrow_data()?, mint, user.key)?;
    }

    let claim_seeds: &[&[u8]] = &[b"claim", user.key.as_ref(), &[claim_bump]];
    let rent = Rent::get()?.minimum_balance(CLAIM_LEN);
    if claim.lamports() == 0 {
        invoke_signed(&system_instruction::create_account(user.key, claim.key, rent, CLAIM_LEN as u64, program_id),
            &[user.clone(), claim.clone(), system.clone()], &[claim_seeds])?;
    } else {
        // A dust transfer to an unclaimed PDA must not lock out its wallet.
        let top_up = rent.saturating_sub(claim.lamports());
        if top_up > 0 { invoke(&system_instruction::transfer(user.key, claim.key, top_up), &[user.clone(), claim.clone(), system.clone()])?; }
        invoke_signed(&system_instruction::allocate(claim.key, CLAIM_LEN as u64), &[claim.clone(), system.clone()], &[claim_seeds])?;
        invoke_signed(&system_instruction::assign(claim.key, program_id), &[claim.clone(), system.clone()], &[claim_seeds])?;
    }
    claim.try_borrow_mut_data()?[0] = 1;
    let authority_seeds: &[&[u8]] = &[b"faucet", &[authority_bump]];
    for i in 0..4 {
        let mint = &accounts[5 + i * 3];
        let source = &accounts[6 + i * 3];
        let destination = &accounts[7 + i * 3];
        invoke_signed(&transfer_checked(source.key, mint.key, destination.key, authority.key),
            &[source.clone(), mint.clone(), destination.clone(), authority.clone(), token.clone()], &[authority_seeds])?;
    }
    Ok(()) // Any failed CPI rolls back all four transfers and the claim marker.
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transfer_wire_pins_raw_amount_and_program() {
        let ix = transfer_checked(&MINTS[0], &MINTS[1], &MINTS[2], &MINTS[3]);
        assert_eq!(ix.program_id, TOKEN_2022);
        assert_eq!(ix.data, [vec![12], CLAIM_RAW.to_le_bytes().to_vec(), vec![8]].concat());
        assert!(ix.accounts[3].is_signer);
        assert!(!ix.accounts[1].is_writable);
    }
    #[test]
    fn account_substitution_and_freeze_are_rejected() {
        let owner = Pubkey::new_unique();
        let mut data = vec![0; 165];
        data[..32].copy_from_slice(MINTS[0].as_ref()); data[32..64].copy_from_slice(owner.as_ref()); data[108] = 1;
        assert!(validate_token_account(&data, &MINTS[0], &owner).is_ok());
        assert_eq!(validate_token_account(&data, &MINTS[1], &owner), Err(ProgramError::InvalidAccountData));
        assert_eq!(validate_token_account(&data, &MINTS[0], &Pubkey::new_unique()), Err(ProgramError::InvalidAccountData));
        data[108] = 2;
        assert_eq!(validate_token_account(&data, &MINTS[0], &owner), Err(ProgramError::InvalidAccountData));
        assert_eq!(validate_token_account(&data[..164], &MINTS[0], &owner), Err(ProgramError::InvalidAccountData));
    }
    #[test]
    fn rejects_alternate_program_data_and_account_count() {
        assert_eq!(process_instruction(&Pubkey::new_unique(), &[], &[0]), Err(ProgramError::IncorrectProgramId));
        assert_eq!(process_instruction(&id(), &[], &[1]), Err(ProgramError::InvalidInstructionData));
        assert_eq!(process_instruction(&id(), &[], &[0]), Err(ProgramError::InvalidInstructionData));
    }
    #[test]
    fn vaults_and_claims_are_distinct_and_token2022_specific() {
        let authority = Pubkey::find_program_address(&[b"faucet"], &id()).0;
        let vaults = MINTS.map(|mint| ata(&authority, &mint));
        for i in 0..4 { for j in 0..i { assert_ne!(vaults[i], vaults[j]); } }
        let a = Pubkey::new_unique(); let b = Pubkey::new_unique();
        assert_ne!(Pubkey::find_program_address(&[b"claim", a.as_ref()], &id()).0, Pubkey::find_program_address(&[b"claim", b.as_ref()], &id()).0);
    }
    struct FixtureAccount { key: Pubkey, owner: Pubkey, lamports: u64, data: Vec<u8>, signer: bool, writable: bool, executable: bool }
    fn fixture_accounts() -> Vec<FixtureAccount> {
        let user = Pubkey::new_unique();
        let authority = Pubkey::find_program_address(&[b"faucet"], &id()).0;
        let claim = Pubkey::find_program_address(&[b"claim", user.as_ref()], &id()).0;
        let base = |key, owner, signer, writable, executable, data| FixtureAccount { key, owner, lamports: 0, data, signer, writable, executable };
        let mut rows = vec![
            base(user, system_program::id(), true, true, false, vec![]),
            base(claim, system_program::id(), false, true, false, vec![]),
            base(authority, system_program::id(), false, false, false, vec![]),
            base(system_program::id(), Pubkey::new_unique(), false, false, true, vec![]),
            base(TOKEN_2022, Pubkey::new_unique(), false, false, true, vec![]),
        ];
        for mint in MINTS {
            let mut mint_data = vec![0; 82]; mint_data[44] = DECIMALS; mint_data[45] = 1;
            rows.push(base(mint, TOKEN_2022, false, false, false, mint_data));
            for owner in [authority, user] {
                let mut token = vec![0; 165]; token[..32].copy_from_slice(mint.as_ref());
                token[32..64].copy_from_slice(owner.as_ref()); token[108] = 1;
                token[64..72].copy_from_slice(&CLAIM_RAW.to_le_bytes());
                rows.push(base(ata(&owner, &mint), TOKEN_2022, false, true, false, token));
            }
        }
        rows
    }
    fn process_fixture(rows: &mut [FixtureAccount]) -> ProgramResult {
        let accounts = rows.iter_mut().map(|r| AccountInfo::new(&r.key, r.signer, r.writable, &mut r.lamports, &mut r.data, &r.owner, r.executable, 0)).collect::<Vec<_>>();
        process_instruction(&id(), &accounts, &[0])
    }
    #[test]
    fn signer_and_derived_authorities_are_required() {
        let mut rows = fixture_accounts(); rows[0].signer = false;
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::MissingRequiredSignature));
        for index in [1, 2] {
            let mut rows = fixture_accounts(); rows[index].key = Pubkey::new_unique();
            assert_eq!(process_fixture(&mut rows), Err(ProgramError::InvalidSeeds));
        }
    }
    #[test]
    fn financial_accounts_must_be_writable_and_owned_by_token2022() {
        for index in [0, 1, 6, 7] {
            let mut rows = fixture_accounts(); rows[index].writable = false;
            assert_eq!(process_fixture(&mut rows), Err(ProgramError::InvalidAccountData));
        }
        for index in [5, 6, 7] {
            let mut rows = fixture_accounts(); rows[index].owner = system_program::id();
            assert_eq!(process_fixture(&mut rows), Err(ProgramError::IncorrectProgramId));
        }
        let mut rows = fixture_accounts(); rows[4].key = Pubkey::new_unique();
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::IncorrectProgramId));
        let mut rows = fixture_accounts(); rows[5].key = MINTS[1];
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::IncorrectProgramId));
    }
    #[test]
    fn claim_marker_cannot_be_reused_or_substituted() {
        let mut rows = fixture_accounts(); rows[1].owner = id(); rows[1].data = vec![1];
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::Custom(ALREADY_CLAIMED)));
        let mut rows = fixture_accounts(); rows[1].owner = TOKEN_2022;
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::IllegalOwner));
        let mut rows = fixture_accounts(); rows[1].data = vec![0];
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::IllegalOwner));
        let mut rows = fixture_accounts(); rows[6].data[64..72].copy_from_slice(&(CLAIM_RAW - 1).to_le_bytes());
        assert_eq!(process_fixture(&mut rows), Err(ProgramError::InsufficientFunds));
    }
    #[test]
    fn valid_empty_and_prefunded_claim_pass_validation_before_rent_syscall() {
        // Host default syscall stubs have no Rent sysvar; both valid paths reach
        // that same syscall. Actual prefunded allocation is covered by devnet proof.
        for lamports in [0, 1, u64::MAX] {
            let mut rows = fixture_accounts(); rows[1].lamports = lamports;
            assert_eq!(process_fixture(&mut rows), Err(ProgramError::UnsupportedSysvar));
        }
    }

}

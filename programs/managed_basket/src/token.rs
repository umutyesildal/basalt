use anchor_lang::{prelude::*, solana_program::program_pack::Pack};
use anchor_spl::{
    associated_token::get_associated_token_address_with_program_id,
    token_2022::spl_token_2022::{
        extension::{BaseStateWithExtensions, StateWithExtensions},
        state::{Account as Token2022Account, Mint as Token2022Mint},
    },
    token_interface::TokenAccount,
};

use crate::state::ManagedBasketError;

pub fn validate_token_2022_program(program_id: &Pubkey) -> Result<()> {
    require_keys_eq!(
        *program_id,
        anchor_spl::token_2022::ID,
        ManagedBasketError::InvalidTokenProgram
    );
    Ok(())
}

/// Admit only extension-free Token-2022 mints in this prototype. This rejects
/// transfer fees/hooks, scaled UI amounts and any other extension whose transfer
/// or accounting semantics have not been integrated and tested here.
pub fn validate_supported_mint_extensions(mint: &AccountInfo) -> Result<()> {
    require_keys_eq!(
        *mint.owner,
        anchor_spl::token_2022::ID,
        ManagedBasketError::InvalidTokenProgram
    );
    let data = mint.try_borrow_data()?;
    let parsed = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(ManagedBasketError::UnsupportedMintExtension))?;
    let extensions = parsed
        .get_extension_types()
        .map_err(|_| error!(ManagedBasketError::UnsupportedMintExtension))?;
    require!(
        extensions.is_empty() && data.len() == Token2022Mint::LEN,
        ManagedBasketError::UnsupportedMintExtension
    );
    require!(
        parsed.base.freeze_authority.is_none(),
        ManagedBasketError::FreezeAuthorityPresent
    );
    Ok(())
}

pub fn assert_token_account(
    account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
    token_program: &Pubkey,
) -> Result<u64> {
    require_keys_eq!(
        *account.owner,
        *token_program,
        ManagedBasketError::InvalidTokenProgram
    );
    let data = account.try_borrow_data()?;
    let parsed = StateWithExtensions::<Token2022Account>::unpack(&data)
        .map_err(|_| error!(ManagedBasketError::InvalidTokenAccount))?;
    require_keys_eq!(
        parsed.base.mint,
        *expected_mint,
        ManagedBasketError::InvalidTokenAccountMint
    );
    require_keys_eq!(
        parsed.base.owner,
        *expected_owner,
        ManagedBasketError::InvalidTokenOwner
    );
    Ok(parsed.base.amount)
}

pub fn assert_canonical_ata(
    account: &AccountInfo,
    authority: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
) -> Result<u64> {
    let expected = get_associated_token_address_with_program_id(authority, mint, token_program);
    require_keys_eq!(
        *account.key,
        expected,
        ManagedBasketError::InvalidTokenAccount
    );
    assert_token_account(account, mint, authority, token_program)
}

pub fn read_token_amount(account: &AccountInfo) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let parsed = StateWithExtensions::<Token2022Account>::unpack(&data)
        .map_err(|_| error!(ManagedBasketError::InvalidTokenAccount))?;
    Ok(parsed.base.amount)
}

pub fn read_mint_supply(mint: &AccountInfo) -> Result<u64> {
    let data = mint.try_borrow_data()?;
    let parsed = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(ManagedBasketError::InvalidMint))?;
    Ok(parsed.base.supply)
}

pub fn assert_mint(
    mint: &AccountInfo,
    expected_mint: &Pubkey,
    decimals: u8,
    mint_authority: Option<Pubkey>,
) -> Result<u64> {
    require_keys_eq!(*mint.key, *expected_mint, ManagedBasketError::InvalidMint);
    require_keys_eq!(
        *mint.owner,
        anchor_spl::token_2022::ID,
        ManagedBasketError::InvalidTokenProgram
    );
    let data = mint.try_borrow_data()?;
    let parsed = StateWithExtensions::<Token2022Mint>::unpack(&data)
        .map_err(|_| error!(ManagedBasketError::InvalidMint))?;
    require!(
        parsed.base.decimals == decimals,
        ManagedBasketError::InvalidMint
    );
    require!(
        parsed.base.mint_authority == mint_authority.into(),
        ManagedBasketError::InvalidMint
    );
    Ok(parsed.base.supply)
}

pub fn interface_token_account_matches(
    account: &TokenAccount,
    expected_mint: &Pubkey,
    expected_owner: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        account.mint,
        *expected_mint,
        ManagedBasketError::InvalidTokenAccountMint
    );
    require_keys_eq!(
        account.owner,
        *expected_owner,
        ManagedBasketError::InvalidTokenOwner
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mint_account_info<'a>(
        mint_authority: Option<Pubkey>,
        freeze_authority: Option<Pubkey>,
        key: &'a Pubkey,
        owner: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
    ) -> AccountInfo<'a> {
        let mint = Token2022Mint {
            mint_authority: mint_authority.into(),
            supply: 0,
            decimals: 6,
            is_initialized: true,
            freeze_authority: freeze_authority.into(),
        };
        Token2022Mint::pack(mint, data).unwrap();
        AccountInfo::new(key, false, false, lamports, data, owner, false, 0)
    }

    #[test]
    fn rejects_plain_token_2022_mint_with_freeze_authority() {
        let mint_key = Pubkey::new_unique();
        let owner = anchor_spl::token_2022::ID;
        let freeze_key = Pubkey::new_unique();
        let mut lamports = 1;
        let mut data = vec![0; Token2022Mint::LEN];
        let account = mint_account_info(
            None,
            Some(freeze_key),
            &mint_key,
            &owner,
            &mut lamports,
            &mut data,
        );
        assert_eq!(
            validate_supported_mint_extensions(&account),
            Err(error!(ManagedBasketError::FreezeAuthorityPresent))
        );
    }

    #[test]
    fn admits_plain_token_2022_mint_without_freeze_authority() {
        let mint_key = Pubkey::new_unique();
        let owner = anchor_spl::token_2022::ID;
        let mut lamports = 1;
        let mut data = vec![0; Token2022Mint::LEN];
        let account = mint_account_info(None, None, &mint_key, &owner, &mut lamports, &mut data);
        assert!(validate_supported_mint_extensions(&account).is_ok());
    }
}

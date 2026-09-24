use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken, Create},
    token_2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    math::{gross_shares, redeem_amounts},
    state::{
        ManagedBasket, ManagedBasketError, ManagedSharesMinted, ManagedSharesRedeemed,
        SHARE_DECIMALS, VAULT_AUTHORITY_SEED,
    },
    token::{
        assert_canonical_ata, assert_mint, read_mint_supply, read_token_amount,
        validate_supported_mint_extensions, validate_token_2022_program,
    },
};

pub fn mint_handler(ctx: Context<MintInKind>, deposits_raw: [u64; 2]) -> Result<()> {
    validate_token_2022_program(&ctx.accounts.token_program.key())?;
    let basket = &ctx.accounts.basket;
    let user_key = ctx.accounts.user.key();
    let token_program = ctx.accounts.token_program.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    validate_constituent_pair(
        basket,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
        &ctx.accounts.vault_a,
        &ctx.accounts.vault_b,
        &vault_authority,
        &token_program,
        true,
    )?;
    assert_canonical_ata(
        &ctx.accounts.user_source_a.to_account_info(),
        &user_key,
        &basket.constituent_mints[0],
        &token_program,
    )?;
    assert_canonical_ata(
        &ctx.accounts.user_source_b.to_account_info(),
        &user_key,
        &basket.constituent_mints[1],
        &token_program,
    )?;
    let supply = assert_mint(
        &ctx.accounts.share_mint.to_account_info(),
        &basket.share_mint,
        SHARE_DECIMALS,
        Some(vault_authority),
    )?;
    let vault_balances = [
        read_token_amount(&ctx.accounts.vault_a.to_account_info())?,
        read_token_amount(&ctx.accounts.vault_b.to_account_info())?,
    ];
    // Compute from current live raw balances before any transfer. Off-ratio
    // deposits fail before reaching either vault; division rounds shares down.
    let shares = gross_shares(deposits_raw, vault_balances, supply)?;

    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.user.to_account_info(),
            associated_token: ctx.accounts.user_share_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.share_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;
    assert_canonical_ata(
        &ctx.accounts.user_share_ata.to_account_info(),
        &user_key,
        &basket.share_mint,
        &token_program,
    )?;

    transfer_from_user(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.user_source_a.to_account_info(),
        &ctx.accounts.mint_a.to_account_info(),
        &ctx.accounts.vault_a.to_account_info(),
        deposits_raw[0],
        ctx.accounts.mint_a.decimals,
    )?;
    transfer_from_user(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.user_source_b.to_account_info(),
        &ctx.accounts.mint_b.to_account_info(),
        &ctx.accounts.vault_b.to_account_info(),
        deposits_raw[1],
        ctx.accounts.mint_b.decimals,
    )?;

    let basket_key = basket.key();
    let bump = [basket.vault_authority_bump];
    let signer: [&[u8]; 3] = [VAULT_AUTHORITY_SEED, basket_key.as_ref(), &bump];
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.user_share_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&signer],
        ),
        shares,
    )?;
    let total_supply_raw = read_mint_supply(&ctx.accounts.share_mint.to_account_info())?;
    require!(
        total_supply_raw
            == supply
                .checked_add(shares)
                .ok_or(ManagedBasketError::MathOverflow)?,
        ManagedBasketError::InvalidMint
    );
    emit!(ManagedSharesMinted {
        basket: basket_key,
        holder: user_key,
        shares_minted_raw: shares,
        deposit_amounts_raw: deposits_raw,
        total_supply_raw,
    });
    Ok(())
}

pub fn redeem_handler(ctx: Context<RedeemInKind>, shares_to_redeem_raw: u64) -> Result<()> {
    validate_token_2022_program(&ctx.accounts.token_program.key())?;
    let basket = &ctx.accounts.basket;
    let user_key = ctx.accounts.user.key();
    let token_program = ctx.accounts.token_program.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    validate_constituent_pair(
        basket,
        &ctx.accounts.mint_a,
        &ctx.accounts.mint_b,
        &ctx.accounts.vault_a,
        &ctx.accounts.vault_b,
        &vault_authority,
        &token_program,
        false,
    )?;
    let supply = assert_mint(
        &ctx.accounts.share_mint.to_account_info(),
        &basket.share_mint,
        SHARE_DECIMALS,
        Some(vault_authority),
    )?;
    require!(supply > 0, ManagedBasketError::ZeroSupply);
    let user_share_balance = assert_canonical_ata(
        &ctx.accounts.user_share_ata.to_account_info(),
        &user_key,
        &basket.share_mint,
        &token_program,
    )?;
    require!(shares_to_redeem_raw > 0, ManagedBasketError::ZeroRedemption);
    require!(
        shares_to_redeem_raw <= user_share_balance && shares_to_redeem_raw <= supply,
        ManagedBasketError::InsufficientShares
    );
    let vault_balances = [
        read_token_amount(&ctx.accounts.vault_a.to_account_info())?,
        read_token_amount(&ctx.accounts.vault_b.to_account_info())?,
    ];
    let amounts = redeem_amounts(vault_balances, shares_to_redeem_raw, supply)?;
    require!(
        amounts[0] > 0 || amounts[1] > 0,
        ManagedBasketError::ZeroOutput
    );

    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.user.to_account_info(),
            associated_token: ctx.accounts.user_receive_a.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint_a.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;
    associated_token::create_idempotent(CpiContext::new(
        ctx.accounts.associated_token_program.to_account_info(),
        Create {
            payer: ctx.accounts.user.to_account_info(),
            associated_token: ctx.accounts.user_receive_b.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
            mint: ctx.accounts.mint_b.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;
    assert_canonical_ata(
        &ctx.accounts.user_receive_a.to_account_info(),
        &user_key,
        &basket.constituent_mints[0],
        &token_program,
    )?;
    assert_canonical_ata(
        &ctx.accounts.user_receive_b.to_account_info(),
        &user_key,
        &basket.constituent_mints[1],
        &token_program,
    )?;

    token_2022::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares_to_redeem_raw,
    )?;
    let basket_key = basket.key();
    let bump = [basket.vault_authority_bump];
    let signer: [&[u8]; 3] = [VAULT_AUTHORITY_SEED, basket_key.as_ref(), &bump];
    if amounts[0] > 0 {
        transfer_from_vault(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.vault_authority.to_account_info(),
            &[&signer],
            &ctx.accounts.vault_a.to_account_info(),
            &ctx.accounts.mint_a.to_account_info(),
            &ctx.accounts.user_receive_a.to_account_info(),
            amounts[0],
            ctx.accounts.mint_a.decimals,
        )?;
    }
    if amounts[1] > 0 {
        transfer_from_vault(
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.vault_authority.to_account_info(),
            &[&signer],
            &ctx.accounts.vault_b.to_account_info(),
            &ctx.accounts.mint_b.to_account_info(),
            &ctx.accounts.user_receive_b.to_account_info(),
            amounts[1],
            ctx.accounts.mint_b.decimals,
        )?;
    }
    let total_supply_raw = read_mint_supply(&ctx.accounts.share_mint.to_account_info())?;
    emit!(ManagedSharesRedeemed {
        basket: basket_key,
        holder: user_key,
        shares_burned_raw: shares_to_redeem_raw,
        amounts_out_raw: amounts,
        total_supply_raw,
    });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_constituent_pair(
    basket: &ManagedBasket,
    mint_a: &InterfaceAccount<Mint>,
    mint_b: &InterfaceAccount<Mint>,
    vault_a: &InterfaceAccount<TokenAccount>,
    vault_b: &InterfaceAccount<TokenAccount>,
    vault_authority: &Pubkey,
    token_program: &Pubkey,
    apply_extension_policy: bool,
) -> Result<()> {
    require_keys_eq!(
        mint_a.key(),
        basket.constituent_mints[0],
        ManagedBasketError::InvalidConstituents
    );
    require_keys_eq!(
        mint_b.key(),
        basket.constituent_mints[1],
        ManagedBasketError::InvalidConstituents
    );
    require!(
        mint_a.decimals == basket.constituent_decimals[0]
            && mint_b.decimals == basket.constituent_decimals[1],
        ManagedBasketError::InvalidMint
    );
    require_keys_eq!(
        *mint_a.to_account_info().owner,
        *token_program,
        ManagedBasketError::InvalidTokenProgram
    );
    require_keys_eq!(
        *mint_b.to_account_info().owner,
        *token_program,
        ManagedBasketError::InvalidTokenProgram
    );
    if apply_extension_policy {
        validate_supported_mint_extensions(&mint_a.to_account_info())?;
        validate_supported_mint_extensions(&mint_b.to_account_info())?;
    }
    assert_canonical_ata(
        &vault_a.to_account_info(),
        vault_authority,
        &basket.constituent_mints[0],
        token_program,
    )?;
    assert_canonical_ata(
        &vault_b.to_account_info(),
        vault_authority,
        &basket.constituent_mints[1],
        token_program,
    )?;
    Ok(())
}

fn transfer_from_user<'info>(
    token_program: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let from_before = read_token_amount(from)?;
    let to_before = read_token_amount(to)?;
    token_2022::transfer_checked(
        CpiContext::new(
            token_program.clone(),
            token_2022::TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: user.clone(),
            },
        ),
        amount,
        decimals,
    )?;
    verify_transfer_deltas(
        from_before,
        read_token_amount(from)?,
        to_before,
        read_token_amount(to)?,
        amount,
    )
}

// Keep the Token-2022 CPI account mapping explicit at each call site.
#[allow(clippy::too_many_arguments)]
fn transfer_from_vault<'info>(
    token_program: &AccountInfo<'info>,
    vault_authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    let from_before = read_token_amount(from)?;
    let to_before = read_token_amount(to)?;
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            token_2022::TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: vault_authority.clone(),
            },
            signer_seeds,
        ),
        amount,
        decimals,
    )?;
    verify_transfer_deltas(
        from_before,
        read_token_amount(from)?,
        to_before,
        read_token_amount(to)?,
        amount,
    )
}

fn verify_transfer_deltas(
    from_before: u64,
    from_after: u64,
    to_before: u64,
    to_after: u64,
    expected: u64,
) -> Result<()> {
    require!(
        from_before.checked_sub(from_after) == Some(expected)
            && to_after.checked_sub(to_before) == Some(expected),
        ManagedBasketError::TransferDeltaMismatch
    );
    Ok(())
}

#[derive(Accounts)]
pub struct MintInKind<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub basket: Account<'info, ManagedBasket>,
    /// CHECK: PDA derived from this basket; token owner checks bind vaults to it.
    #[account(seeds = [crate::state::VAULT_AUTHORITY_SEED, basket.key().as_ref()], bump = basket.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_source_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub user_source_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, address = basket.share_mint)]
    pub share_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Canonical user share ATA is derived and created idempotently in the handler.
    #[account(mut)]
    pub user_share_ata: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RedeemInKind<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    pub basket: Account<'info, ManagedBasket>,
    /// CHECK: PDA derived from this basket; token owner checks bind vaults to it.
    #[account(seeds = [crate::state::VAULT_AUTHORITY_SEED, basket.key().as_ref()], bump = basket.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub share_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub user_share_ata: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Canonical receive ATA is derived and created idempotently in the handler.
    #[account(mut)]
    pub user_receive_a: UncheckedAccount<'info>,
    /// CHECK: Canonical receive ATA is derived and created idempotently in the handler.
    #[account(mut)]
    pub user_receive_b: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

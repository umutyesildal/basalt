use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022,
    token_interface::{Mint, TokenAccount, TokenInterface},
};

use crate::{
    state::{
        ManagedBasket, ManagedBasketError, RebalanceExecuted, RebalanceProposal, PROPOSAL_SEED,
        SHARE_DECIMALS, STATUS_APPROVED, STATUS_EXECUTED, VAULT_AUTHORITY_SEED,
    },
    token::{
        assert_canonical_ata, assert_mint, read_token_amount, validate_supported_mint_extensions,
        validate_token_2022_program,
    },
};

pub fn fill_handler(
    ctx: Context<FillRebalance>,
    proposal_nonce: u64,
    input_raw: u64,
    output_raw: u64,
) -> Result<()> {
    validate_token_2022_program(&ctx.accounts.token_program.key())?;
    let basket = &ctx.accounts.basket;
    let proposal = &ctx.accounts.proposal;
    require!(
        basket.pending_proposal_nonce == Some(proposal_nonce)
            && proposal.nonce == proposal_nonce
            && proposal.basket == basket.key(),
        ManagedBasketError::NoPendingProposal
    );
    require!(
        proposal.status == STATUS_APPROVED,
        ManagedBasketError::ProposalNotApproved
    );
    require!(
        proposal.base_version == basket.allocation_version,
        ManagedBasketError::StaleVersion
    );
    let slot = Clock::get()?.slot;
    require!(
        slot >= proposal.not_before_slot,
        ManagedBasketError::TooEarly
    );
    require!(
        slot <= proposal.expires_at_slot,
        ManagedBasketError::ProposalExpired
    );
    require!(
        input_raw > 0 && output_raw > 0,
        ManagedBasketError::InvalidProposal
    );
    // Prototype RFQ is an all-or-nothing exact input. The `max_input_raw` name
    // is retained in the persisted client contract, but partial fills are not
    // allowed so accounting/indexer events have one unambiguous fill amount.
    require!(
        input_raw == proposal.max_input_raw,
        ManagedBasketError::FillOutsideBounds
    );
    require!(
        output_raw >= proposal.min_output_raw,
        ManagedBasketError::FillOutsideBounds
    );
    require!(
        proposal.target_weights_bps[0] > 0 && proposal.target_weights_bps[1] > 0,
        ManagedBasketError::InvalidWeights
    );
    require!(
        proposal.target_weights_bps[0] as u32 + proposal.target_weights_bps[1] as u32 == 10_000,
        ManagedBasketError::InvalidWeights
    );

    let token_program_key = ctx.accounts.token_program.key();
    let vault_authority = ctx.accounts.vault_authority.key();
    require_keys_eq!(
        ctx.accounts.mint_a.key(),
        basket.constituent_mints[0],
        ManagedBasketError::InvalidConstituents
    );
    require_keys_eq!(
        ctx.accounts.mint_b.key(),
        basket.constituent_mints[1],
        ManagedBasketError::InvalidConstituents
    );
    validate_supported_mint_extensions(&ctx.accounts.mint_a.to_account_info())?;
    validate_supported_mint_extensions(&ctx.accounts.mint_b.to_account_info())?;
    require!(
        ctx.accounts.mint_a.decimals == basket.constituent_decimals[0]
            && ctx.accounts.mint_b.decimals == basket.constituent_decimals[1],
        ManagedBasketError::InvalidMint
    );
    assert_canonical_ata(
        &ctx.accounts.vault_a.to_account_info(),
        &vault_authority,
        &basket.constituent_mints[0],
        &token_program_key,
    )?;
    assert_canonical_ata(
        &ctx.accounts.vault_b.to_account_info(),
        &vault_authority,
        &basket.constituent_mints[1],
        &token_program_key,
    )?;

    let input_index = if proposal.input_mint == basket.constituent_mints[0] {
        0
    } else if proposal.input_mint == basket.constituent_mints[1] {
        1
    } else {
        return err!(ManagedBasketError::WrongAssetPair);
    };
    let output_index = 1 - input_index;
    require_keys_eq!(
        proposal.output_mint,
        basket.constituent_mints[output_index],
        ManagedBasketError::WrongAssetPair
    );

    let vault_infos = [
        ctx.accounts.vault_a.to_account_info(),
        ctx.accounts.vault_b.to_account_info(),
    ];
    let mint_infos = [
        ctx.accounts.mint_a.to_account_info(),
        ctx.accounts.mint_b.to_account_info(),
    ];
    let taker_ata_infos = [
        ctx.accounts.taker_ata_a.to_account_info(),
        ctx.accounts.taker_ata_b.to_account_info(),
    ];
    let taker_key = ctx.accounts.taker.key();
    for (i, taker_ata) in taker_ata_infos.iter().enumerate() {
        assert_canonical_ata(
            taker_ata,
            &taker_key,
            &basket.constituent_mints[i],
            &token_program_key,
        )?;
    }
    let vault_before = [
        read_token_amount(&vault_infos[0])?,
        read_token_amount(&vault_infos[1])?,
    ];
    require!(
        vault_before[input_index] > input_raw,
        ManagedBasketError::InsufficientVaultBalance
    );
    require!(
        vault_before[output_index] > 0,
        ManagedBasketError::ZeroVault
    );
    let taker_output_before = read_token_amount(&taker_ata_infos[output_index])?;
    let vault_output_before = vault_before[output_index];
    let vault_input_before = vault_before[input_index];
    let taker_input_before = read_token_amount(&taker_ata_infos[input_index])?;

    // First move taker output into the vault, then send the exact approved input
    // under the vault PDA. Any failed bound/delta check rolls the entire Solana
    // transaction back; the program never invokes a caller-supplied program.
    token_2022::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from: taker_ata_infos[output_index].clone(),
                mint: mint_infos[output_index].clone(),
                to: vault_infos[output_index].clone(),
                authority: ctx.accounts.taker.to_account_info(),
            },
        ),
        output_raw,
        basket.constituent_decimals[output_index],
    )?;
    require!(
        taker_output_before.checked_sub(read_token_amount(&taker_ata_infos[output_index])?)
            == Some(output_raw)
            && read_token_amount(&vault_infos[output_index])?.checked_sub(vault_output_before)
                == Some(output_raw),
        ManagedBasketError::TransferDeltaMismatch
    );

    let basket_key = basket.key();
    let bump = [basket.vault_authority_bump];
    let signer: [&[u8]; 3] = [VAULT_AUTHORITY_SEED, basket_key.as_ref(), &bump];
    token_2022::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from: vault_infos[input_index].clone(),
                mint: mint_infos[input_index].clone(),
                to: taker_ata_infos[input_index].clone(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[&signer],
        ),
        input_raw,
        basket.constituent_decimals[input_index],
    )?;
    require!(
        vault_input_before.checked_sub(read_token_amount(&vault_infos[input_index])?)
            == Some(input_raw)
            && read_token_amount(&taker_ata_infos[input_index])?.checked_sub(taker_input_before)
                == Some(input_raw),
        ManagedBasketError::TransferDeltaMismatch
    );

    let post_balances_raw = [
        read_token_amount(&vault_infos[0])?,
        read_token_amount(&vault_infos[1])?,
    ];
    require!(
        post_balances_raw[0] > 0 && post_balances_raw[1] > 0,
        ManagedBasketError::WouldEmptyConstituent
    );
    let basket = &mut ctx.accounts.basket;
    let proposal = &mut ctx.accounts.proposal;
    let from_version = basket.allocation_version;
    let to_version = from_version
        .checked_add(1)
        .ok_or(ManagedBasketError::MathOverflow)?;
    basket.target_weights_bps = proposal.target_weights_bps;
    basket.allocation_version = to_version;
    basket.pending_proposal_nonce = None;
    proposal.status = STATUS_EXECUTED;
    let total_supply_raw = assert_mint(
        &ctx.accounts.share_mint.to_account_info(),
        &basket.share_mint,
        SHARE_DECIMALS,
        Some(vault_authority),
    )?;
    emit!(RebalanceExecuted {
        basket: basket_key,
        nonce: proposal_nonce,
        proposal_hash: proposal.proposal_hash,
        from_version,
        to_version,
        input_mint: proposal.input_mint,
        output_mint: proposal.output_mint,
        input_raw,
        output_raw,
        target_weights_bps: proposal.target_weights_bps,
        executed_at_slot: slot,
        total_supply_raw,
        post_balances_raw,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(proposal_nonce: u64)]
pub struct FillRebalance<'info> {
    pub taker: Signer<'info>,
    #[account(mut)]
    pub basket: Account<'info, ManagedBasket>,
    #[account(
        mut,
        seeds = [PROPOSAL_SEED, basket.key().as_ref(), &proposal_nonce.to_le_bytes()],
        bump = proposal.bump,
        has_one = basket
    )]
    pub proposal: Account<'info, RebalanceProposal>,
    /// CHECK: PDA derived from this basket; token owner checks bind vaults to it.
    #[account(seeds = [VAULT_AUTHORITY_SEED, basket.key().as_ref()], bump = basket.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint_a: InterfaceAccount<'info, Mint>,
    pub mint_b: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub vault_a: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub vault_b: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Canonical taker token accounts are derived and checked in the handler.
    #[account(mut)]
    pub taker_ata_a: UncheckedAccount<'info>,
    /// CHECK: Canonical taker token accounts are derived and checked in the handler.
    #[account(mut)]
    pub taker_ata_b: UncheckedAccount<'info>,
    #[account(address = basket.share_mint)]
    pub share_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
}

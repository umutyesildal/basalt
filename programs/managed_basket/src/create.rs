use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::{self, AssociatedToken, Create},
    token_2022::{self, spl_token_2022::instruction::AuthorityType},
    token_interface::{
        find_mint_account_size, initialize_mint2, InitializeMint2, Mint, TokenAccount,
        TokenInterface,
    },
};

use crate::{
    math::validate_weights,
    state::{
        ManagedBasket, ManagedBasketCreated, ManagedBasketError, BASKET_SEED, GENESIS_SHARES_RAW,
        IDENTITY_NFT_DECIMALS, IDENTITY_NFT_SEED, MAX_APPROVAL_TTL_SLOTS,
        MAX_EXECUTION_WINDOW_SLOTS, MAX_NOTICE_DURATION_SLOTS, MIN_NOTICE_DURATION_SLOTS,
        SHARE_DECIMALS, SHARE_MINT_SEED, VAULT_AUTHORITY_SEED,
    },
    token::{
        assert_canonical_ata, read_mint_supply, read_token_amount,
        validate_supported_mint_extensions, validate_token_2022_program,
    },
};

pub fn handler(
    ctx: Context<CreateManagedBasket>,
    basket_nonce: u64,
    target_weights_bps: [u16; 2],
    seed_amounts_raw: [u64; 2],
    approval_ttl_slots: u64,
    notice_duration_slots: u64,
    execution_window_slots: u64,
) -> Result<()> {
    validate_token_2022_program(&ctx.accounts.token_program.key())?;
    validate_weights(target_weights_bps)?;
    require!(
        seed_amounts_raw[0] > 0 && seed_amounts_raw[1] > 0,
        ManagedBasketError::ZeroAmount
    );
    require_keys_neq!(
        ctx.accounts.guardian.key(),
        ctx.accounts.creator.key(),
        ManagedBasketError::RolesMustDiffer
    );
    require_keys_neq!(
        ctx.accounts.guardian.key(),
        Pubkey::default(),
        ManagedBasketError::UnauthorizedGuardian
    );
    require!(
        (1..=MAX_APPROVAL_TTL_SLOTS).contains(&approval_ttl_slots),
        ManagedBasketError::InvalidProposal
    );
    require!(
        (MIN_NOTICE_DURATION_SLOTS..=MAX_NOTICE_DURATION_SLOTS).contains(&notice_duration_slots),
        ManagedBasketError::NoticeTooShort
    );
    require!(
        (1..=MAX_EXECUTION_WINDOW_SLOTS).contains(&execution_window_slots),
        ManagedBasketError::InvalidProposal
    );

    validate_supported_mint_extensions(&ctx.accounts.mint_a.to_account_info())?;
    validate_supported_mint_extensions(&ctx.accounts.mint_b.to_account_info())?;
    require_keys_neq!(
        ctx.accounts.mint_a.key(),
        ctx.accounts.mint_b.key(),
        ManagedBasketError::InvalidConstituents
    );
    require!(
        ctx.accounts.mint_a.decimals <= 12 && ctx.accounts.mint_b.decimals <= 12,
        ManagedBasketError::InvalidDecimals
    );

    let token_program_key = ctx.accounts.token_program.key();
    let creator_key = ctx.accounts.creator.key();
    assert_canonical_ata(
        &ctx.accounts.creator_source_a.to_account_info(),
        &creator_key,
        &ctx.accounts.mint_a.key(),
        &token_program_key,
    )?;
    assert_canonical_ata(
        &ctx.accounts.creator_source_b.to_account_info(),
        &creator_key,
        &ctx.accounts.mint_b.key(),
        &token_program_key,
    )?;

    let basket_key = ctx.accounts.basket.key();
    let vault_bump = [ctx.bumps.vault_authority];
    let vault_seeds: [&[u8]; 3] = [VAULT_AUTHORITY_SEED, basket_key.as_ref(), &vault_bump];
    let signer_seeds: &[&[&[u8]]] = &[&vault_seeds];

    let share_bump = [ctx.bumps.share_mint];
    let share_mint_seeds: [&[u8]; 3] = [SHARE_MINT_SEED, basket_key.as_ref(), &share_bump];
    initialize_mint_pda(
        &ctx.accounts.creator,
        &ctx.accounts.share_mint,
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        SHARE_DECIMALS,
        &ctx.accounts.vault_authority.key(),
        &[&share_mint_seeds],
    )?;
    let identity_bump = [ctx.bumps.identity_nft_mint];
    let identity_mint_seeds: [&[u8]; 3] = [IDENTITY_NFT_SEED, basket_key.as_ref(), &identity_bump];
    initialize_mint_pda(
        &ctx.accounts.creator,
        &ctx.accounts.identity_nft_mint,
        &ctx.accounts.system_program,
        &ctx.accounts.token_program,
        IDENTITY_NFT_DECIMALS,
        &ctx.accounts.vault_authority.key(),
        &[&identity_mint_seeds],
    )?;

    create_ata(
        ctx.accounts,
        &ctx.accounts.vault_a,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.mint_a.to_account_info(),
    )?;
    create_ata(
        ctx.accounts,
        &ctx.accounts.vault_b,
        &ctx.accounts.vault_authority.to_account_info(),
        &ctx.accounts.mint_b.to_account_info(),
    )?;
    create_ata(
        ctx.accounts,
        &ctx.accounts.creator_share_ata,
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.share_mint.to_account_info(),
    )?;
    create_ata(
        ctx.accounts,
        &ctx.accounts.creator_identity_ata,
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.identity_nft_mint.to_account_info(),
    )?;
    assert_canonical_ata(
        &ctx.accounts.vault_a.to_account_info(),
        &ctx.accounts.vault_authority.key(),
        &ctx.accounts.mint_a.key(),
        &token_program_key,
    )?;
    assert_canonical_ata(
        &ctx.accounts.vault_b.to_account_info(),
        &ctx.accounts.vault_authority.key(),
        &ctx.accounts.mint_b.key(),
        &token_program_key,
    )?;
    assert_canonical_ata(
        &ctx.accounts.creator_share_ata.to_account_info(),
        &creator_key,
        &ctx.accounts.share_mint.key(),
        &token_program_key,
    )?;
    assert_canonical_ata(
        &ctx.accounts.creator_identity_ata.to_account_info(),
        &creator_key,
        &ctx.accounts.identity_nft_mint.key(),
        &token_program_key,
    )?;

    // Vault ATAs are created above; only now parse their Token-2022 state and
    // seed them. Reading the initially system-owned, empty PDA accounts as
    // token accounts would fail before these creation CPIs run.
    let creator_source_a_before =
        read_token_amount(&ctx.accounts.creator_source_a.to_account_info())?;
    let vault_a_before = read_token_amount(&ctx.accounts.vault_a.to_account_info())?;
    token_2022::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from: ctx.accounts.creator_source_a.to_account_info(),
                mint: ctx.accounts.mint_a.to_account_info(),
                to: ctx.accounts.vault_a.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        seed_amounts_raw[0],
        ctx.accounts.mint_a.decimals,
    )?;
    verify_transfer_deltas(
        creator_source_a_before,
        read_token_amount(&ctx.accounts.creator_source_a.to_account_info())?,
        vault_a_before,
        read_token_amount(&ctx.accounts.vault_a.to_account_info())?,
        seed_amounts_raw[0],
    )?;

    let creator_source_b_before =
        read_token_amount(&ctx.accounts.creator_source_b.to_account_info())?;
    let vault_b_before = read_token_amount(&ctx.accounts.vault_b.to_account_info())?;
    token_2022::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::TransferChecked {
                from: ctx.accounts.creator_source_b.to_account_info(),
                mint: ctx.accounts.mint_b.to_account_info(),
                to: ctx.accounts.vault_b.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        seed_amounts_raw[1],
        ctx.accounts.mint_b.decimals,
    )?;
    verify_transfer_deltas(
        creator_source_b_before,
        read_token_amount(&ctx.accounts.creator_source_b.to_account_info())?,
        vault_b_before,
        read_token_amount(&ctx.accounts.vault_b.to_account_info())?,
        seed_amounts_raw[1],
    )?;

    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.creator_share_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        GENESIS_SHARES_RAW,
    )?;
    token_2022::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::MintTo {
                mint: ctx.accounts.identity_nft_mint.to_account_info(),
                to: ctx.accounts.creator_identity_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // The basket NFT is a non-economic identity marker. Revoke its mint
    // authority in the same atomic create transaction; shares remain the only
    // pro-rata economic claim.
    token_2022::set_authority(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_2022::SetAuthority {
                account_or_mint: ctx.accounts.identity_nft_mint.to_account_info(),
                current_authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        AuthorityType::MintTokens,
        None,
    )?;
    require!(
        read_mint_supply(&ctx.accounts.identity_nft_mint.to_account_info())? == 1,
        ManagedBasketError::InvalidMint
    );

    let basket = &mut ctx.accounts.basket;
    basket.schema_version = crate::state::SCHEMA_VERSION;
    basket.creator = creator_key;
    basket.manager = creator_key;
    basket.guardian = ctx.accounts.guardian.key();
    basket.basket_nonce = basket_nonce;
    basket.share_mint = ctx.accounts.share_mint.key();
    basket.identity_nft_mint = ctx.accounts.identity_nft_mint.key();
    basket.constituent_mints = [ctx.accounts.mint_a.key(), ctx.accounts.mint_b.key()];
    basket.constituent_decimals = [ctx.accounts.mint_a.decimals, ctx.accounts.mint_b.decimals];
    basket.target_weights_bps = target_weights_bps;
    basket.allocation_version = 0;
    basket.next_proposal_nonce = 0;
    basket.pending_proposal_nonce = None;
    basket.approval_ttl_slots = approval_ttl_slots;
    basket.notice_duration_slots = notice_duration_slots;
    basket.execution_window_slots = execution_window_slots;
    basket.bump = ctx.bumps.basket;
    basket.vault_authority_bump = ctx.bumps.vault_authority;

    emit!(ManagedBasketCreated {
        basket: basket_key,
        creator: creator_key,
        manager: creator_key,
        guardian: basket.guardian,
        share_mint: basket.share_mint,
        identity_nft_mint: basket.identity_nft_mint,
        constituent_mints: basket.constituent_mints,
        target_weights_bps,
        allocation_version: 0,
        total_supply_raw: read_mint_supply(&ctx.accounts.share_mint.to_account_info())?,
    });
    Ok(())
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

/// Initialize a PDA Token-2022 mint inside the instruction rather than through
/// Anchor's generated `try_accounts` initialization. The split keeps the large
/// atomic create context under the SBF 4KB stack-frame limit.
#[inline(never)]
fn initialize_mint_pda<'info>(
    payer: &Signer<'info>,
    mint: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
    token_program: &Interface<'info, TokenInterface>,
    decimals: u8,
    authority: &Pubkey,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let space = u64::try_from(find_mint_account_size(None)?)
        .map_err(|_| error!(ManagedBasketError::MathOverflow))?;
    let lamports = Rent::get()?.minimum_balance(
        usize::try_from(space).map_err(|_| error!(ManagedBasketError::MathOverflow))?,
    );
    anchor_lang::system_program::create_account(
        CpiContext::new_with_signer(
            system_program.to_account_info(),
            anchor_lang::system_program::CreateAccount {
                from: payer.to_account_info(),
                to: mint.to_account_info(),
            },
            signer_seeds,
        ),
        lamports,
        space,
        &token_program.key(),
    )?;
    initialize_mint2(
        CpiContext::new(
            token_program.to_account_info(),
            InitializeMint2 {
                mint: mint.to_account_info(),
            },
        ),
        decimals,
        authority,
        None,
    )
}

#[inline(never)]
fn create_ata<'info>(
    accounts: &CreateManagedBasket<'info>,
    associated_token: &UncheckedAccount<'info>,
    authority: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
) -> Result<()> {
    associated_token::create_idempotent(CpiContext::new(
        accounts.associated_token_program.to_account_info(),
        Create {
            payer: accounts.creator.to_account_info(),
            associated_token: associated_token.to_account_info(),
            authority: authority.clone(),
            mint: mint.clone(),
            system_program: accounts.system_program.to_account_info(),
            token_program: accounts.token_program.to_account_info(),
        },
    ))
}

#[derive(Accounts)]
#[instruction(basket_nonce: u64)]
pub struct CreateManagedBasket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: Public guardian identity; it signs future price-bound approvals.
    pub guardian: UncheckedAccount<'info>,
    #[account(
        init,
        payer = creator,
        space = 8 + ManagedBasket::INIT_SPACE,
        seeds = [BASKET_SEED, creator.key().as_ref(), &basket_nonce.to_le_bytes()],
        bump
    )]
    pub basket: Box<Account<'info, ManagedBasket>>,
    /// CHECK: PDA authority for vaults and the two protocol-created mints.
    #[account(seeds = [VAULT_AUTHORITY_SEED, basket.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub mint_a: Box<InterfaceAccount<'info, Mint>>,
    pub mint_b: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: The PDA is initialized as an extension-free Token-2022 mint in
    /// the handler to keep the generated account-validation frame below SBF's
    /// stack limit.
    #[account(mut, seeds = [SHARE_MINT_SEED, basket.key().as_ref()], bump)]
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: Supply-one Token-2022 identity mint PDA, initialized in-handler.
    #[account(mut, seeds = [IDENTITY_NFT_SEED, basket.key().as_ref()], bump)]
    pub identity_nft_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator_source_a: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub creator_source_b: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: The expected Token-2022 ATA is created and verified in-handler.
    #[account(mut)]
    pub vault_a: UncheckedAccount<'info>,
    /// CHECK: The expected Token-2022 ATA is created and verified in-handler.
    #[account(mut)]
    pub vault_b: UncheckedAccount<'info>,
    /// CHECK: The expected Token-2022 ATA is created and verified in-handler.
    #[account(mut)]
    pub creator_share_ata: UncheckedAccount<'info>,
    /// CHECK: The expected Token-2022 ATA is created and verified in-handler.
    #[account(mut)]
    pub creator_identity_ata: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

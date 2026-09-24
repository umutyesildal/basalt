use anchor_lang::prelude::*;

pub const BASKET_SEED: &[u8] = b"managed_basket";
pub const SHARE_MINT_SEED: &[u8] = b"managed_share_mint";
pub const IDENTITY_NFT_SEED: &[u8] = b"basket_identity_nft";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"managed_vault_authority";
pub const PROPOSAL_SEED: &[u8] = b"managed_rebalance_proposal";
pub const SCHEMA_VERSION: u8 = 1;
pub const CONSTITUENT_COUNT: usize = 2;
pub const SHARE_DECIMALS: u8 = 6;
pub const IDENTITY_NFT_DECIMALS: u8 = 0;
/// Fee-free proof supply: 1_000_000 raw units = one displayed share at 6 decimals.
pub const GENESIS_SHARES_RAW: u64 = 1_000_000;
pub const WEIGHTS_DENOMINATOR: u32 = 10_000;
/// The fast variant exists only to exercise delayed execution on localnet when
/// the validator cannot warp far enough for the public-notice integration case.
/// Never enable it in a deployable build.
#[cfg(feature = "localnet-fast-notice")]
pub const MIN_NOTICE_DURATION_SLOTS: u64 = 10;

/// Default minimum public notice is one nominal 24-hour Solana slot interval.
/// This prototype is slot-based (216,000 slots at 400ms/slot), not a wall-clock
/// guarantee under unusual cluster slot timing. Production should switch the
/// policy to Clock unix timestamps after a governance review.
#[cfg(not(feature = "localnet-fast-notice"))]
pub const MIN_NOTICE_DURATION_SLOTS: u64 = 216_000;
pub const MAX_NOTICE_DURATION_SLOTS: u64 = 10_000_000;
pub const MAX_APPROVAL_TTL_SLOTS: u64 = 216_000;
pub const MAX_EXECUTION_WINDOW_SLOTS: u64 = 216_000;

#[cfg(all(test, feature = "localnet-fast-notice"))]
mod fast_notice_tests {
    #[test]
    fn localnet_fast_notice_is_ten_slots() {
        assert_eq!(super::MIN_NOTICE_DURATION_SLOTS, 10);
    }
}

#[cfg(all(test, not(feature = "localnet-fast-notice")))]
mod default_notice_tests {
    #[test]
    fn default_notice_remains_twenty_four_hours_nominally() {
        assert_eq!(super::MIN_NOTICE_DURATION_SLOTS, 216_000);
    }
}

pub const STATUS_PENDING_APPROVAL: u8 = 0;
pub const STATUS_APPROVED: u8 = 1;
pub const STATUS_EXECUTED: u8 = 2;
pub const STATUS_CANCELLED: u8 = 3;
pub const STATUS_EXPIRED: u8 = 4;

#[account]
#[derive(InitSpace)]
pub struct ManagedBasket {
    pub schema_version: u8,
    pub creator: Pubkey,
    pub manager: Pubkey,
    pub guardian: Pubkey,
    pub basket_nonce: u64,
    pub share_mint: Pubkey,
    pub identity_nft_mint: Pubkey,
    pub constituent_mints: [Pubkey; CONSTITUENT_COUNT],
    pub constituent_decimals: [u8; CONSTITUENT_COUNT],
    pub target_weights_bps: [u16; CONSTITUENT_COUNT],
    pub allocation_version: u64,
    pub next_proposal_nonce: u64,
    pub pending_proposal_nonce: Option<u64>,
    pub approval_ttl_slots: u64,
    pub notice_duration_slots: u64,
    pub execution_window_slots: u64,
    pub bump: u8,
    pub vault_authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RebalanceProposal {
    pub basket: Pubkey,
    pub nonce: u64,
    pub base_version: u64,
    pub manager: Pubkey,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub max_input_raw: u64,
    pub min_output_raw: u64,
    pub target_weights_bps: [u16; CONSTITUENT_COUNT],
    pub approval_deadline_slot: u64,
    pub notice_duration_slots: u64,
    pub execution_window_slots: u64,
    pub approved_at_slot: u64,
    pub not_before_slot: u64,
    pub expires_at_slot: u64,
    pub commitment_hash: [u8; 32],
    pub proposal_hash: [u8; 32],
    pub status: u8,
    pub bump: u8,
}

#[event]
pub struct ManagedBasketCreated {
    pub basket: Pubkey,
    pub creator: Pubkey,
    pub manager: Pubkey,
    pub guardian: Pubkey,
    pub share_mint: Pubkey,
    pub identity_nft_mint: Pubkey,
    pub constituent_mints: [Pubkey; CONSTITUENT_COUNT],
    pub target_weights_bps: [u16; CONSTITUENT_COUNT],
    pub allocation_version: u64,
    pub total_supply_raw: u64,
}

#[event]
pub struct ManagedSharesMinted {
    pub basket: Pubkey,
    pub holder: Pubkey,
    pub shares_minted_raw: u64,
    pub deposit_amounts_raw: [u64; CONSTITUENT_COUNT],
    pub total_supply_raw: u64,
}

#[event]
pub struct ManagedSharesRedeemed {
    pub basket: Pubkey,
    pub holder: Pubkey,
    pub shares_burned_raw: u64,
    pub amounts_out_raw: [u64; CONSTITUENT_COUNT],
    pub total_supply_raw: u64,
}

#[event]
pub struct RebalanceProposed {
    pub basket: Pubkey,
    pub nonce: u64,
    pub base_version: u64,
    /// Digest of manager-set terms, before guardian supplies min_output_raw.
    pub commitment_hash: [u8; 32],
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub max_input_raw: u64,
    pub target_weights_bps: [u16; CONSTITUENT_COUNT],
    pub approval_deadline_slot: u64,
    pub notice_duration_slots: u64,
    pub execution_window_slots: u64,
}

#[event]
pub struct PriceBoundApproved {
    pub basket: Pubkey,
    pub nonce: u64,
    pub commitment_hash: [u8; 32],
    /// Final digest binds manager terms and guardian min output / timing.
    pub proposal_hash: [u8; 32],
    pub max_input_raw: u64,
    pub min_output_raw: u64,
    pub approved_at_slot: u64,
    pub execute_after_slot: u64,
    pub expires_at_slot: u64,
}

#[event]
pub struct RebalanceCancelled {
    pub basket: Pubkey,
    pub nonce: u64,
    pub commitment_hash: [u8; 32],
    pub proposal_hash: [u8; 32],
}

#[event]
pub struct RebalanceExpired {
    pub basket: Pubkey,
    pub nonce: u64,
    pub commitment_hash: [u8; 32],
    pub proposal_hash: [u8; 32],
}

#[event]
pub struct RebalanceExecuted {
    pub basket: Pubkey,
    pub nonce: u64,
    pub proposal_hash: [u8; 32],
    pub from_version: u64,
    pub to_version: u64,
    pub input_mint: Pubkey,
    pub output_mint: Pubkey,
    pub input_raw: u64,
    pub output_raw: u64,
    pub target_weights_bps: [u16; CONSTITUENT_COUNT],
    pub executed_at_slot: u64,
    pub total_supply_raw: u64,
    /// Raw post-fill vault balances in `constituent_mints` order.
    pub post_balances_raw: [u64; CONSTITUENT_COUNT],
}

#[error_code]
pub enum ManagedBasketError {
    #[msg("Invalid constituent pair")]
    InvalidConstituents,
    #[msg("Weights must be positive and total 10,000 basis points")]
    InvalidWeights,
    #[msg("Seed and deposit amounts must be positive")]
    ZeroAmount,
    #[msg("Unsupported Token-2022 mint extension")]
    UnsupportedMintExtension,
    #[msg("Underlying mint has an issuer freeze authority")]
    FreezeAuthorityPresent,
    #[msg("Expected Token-2022 program")]
    InvalidTokenProgram,
    #[msg("Mint decimals are outside the supported prototype range")]
    InvalidDecimals,
    #[msg("Invalid mint account")]
    InvalidMint,
    #[msg("Invalid associated token account")]
    InvalidTokenAccount,
    #[msg("Token account owner does not match expected owner")]
    InvalidTokenOwner,
    #[msg("Token account mint does not match expected mint")]
    InvalidTokenAccountMint,
    #[msg("Token transfer did not debit and credit exact raw amounts")]
    TransferDeltaMismatch,
    #[msg("Arithmetic overflow or underflow")]
    MathOverflow,
    #[msg("Share supply must be positive")]
    ZeroSupply,
    #[msg("Vault has a zero constituent balance")]
    ZeroVault,
    #[msg("Deposit legs imply zero shares")]
    ZeroShares,
    #[msg("Deposit legs exceed the 1% share-ratio tolerance")]
    WeightMismatch,
    #[msg("Insufficient share balance")]
    InsufficientShares,
    #[msg("Redemption amount must be positive")]
    ZeroRedemption,
    #[msg("Redemption rounds to zero for every constituent")]
    ZeroOutput,
    #[msg("Manager signature required")]
    UnauthorizedManager,
    #[msg("Guardian signature required")]
    UnauthorizedGuardian,
    #[msg("Only the manager or guardian can cancel")]
    UnauthorizedCanceller,
    #[msg("Manager and guardian must be distinct")]
    RolesMustDiffer,
    #[msg("Expected allocation version is stale")]
    StaleVersion,
    #[msg("A proposal is already active")]
    ProposalAlreadyPending,
    #[msg("No matching active proposal")]
    NoPendingProposal,
    #[msg("Proposal nonce does not match")]
    WrongProposalNonce,
    #[msg("Invalid proposal terms")]
    InvalidProposal,
    #[msg("Notice duration is outside the configured slot bounds")]
    NoticeTooShort,
    #[msg("Guardian approval deadline has passed")]
    ApprovalDeadlinePassed,
    #[msg("Price bound was already approved")]
    PriceBoundAlreadyApproved,
    #[msg("Invalid minimum output")]
    InvalidPriceBound,
    #[msg("Proposal is not guardian-approved")]
    ProposalNotApproved,
    #[msg("Rebalance notice period has not elapsed")]
    TooEarly,
    #[msg("Proposal execution window has expired")]
    ProposalExpired,
    #[msg("Proposal has not passed its approval deadline or execution window")]
    ProposalNotExpired,
    #[msg("Fill is outside committed input/output bounds")]
    FillOutsideBounds,
    #[msg("Input/output mint pair does not match proposal")]
    WrongAssetPair,
    #[msg("Taker does not own the canonical output token account")]
    WrongTaker,
    #[msg("Counterparty lacks output balance")]
    InsufficientCounterpartyBalance,
    #[msg("Vault lacks requested input balance")]
    InsufficientVaultBalance,
    #[msg("Fill must leave positive raw balance in each constituent")]
    WouldEmptyConstituent,
}

use std::fmt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CoreError {
    InvalidConfiguration,
    ManagerGuardianMustDiffer,
    InvalidWeights,
    ZeroVaultBalance,
    EmptyHolderSet,
    ZeroHolderShares,
    ShareSupplyOverflow,
    AccountingInvariant,
    UnauthorizedManager,
    UnauthorizedGuardian,
    UnauthorizedCanceller,
    StaleVersion,
    ProposalAlreadyPending,
    NoPendingProposal,
    WrongProposalNonce,
    InvalidProposal,
    PriceBoundAlreadyApproved,
    InvalidPriceBound,
    ApprovalDeadlinePassed,
    ProposalNotApproved,
    ProposalNotExpired,
    TooEarly,
    ProposalExpired,
    FillOutsideBounds,
    WrongAssetPair,
    WrongCounterparty,
    InsufficientCounterpartyBalance,
    InsufficientVaultBalance,
    WouldEmptyConstituent,
    ZeroDeposit,
    ZeroMintShares,
    DepositRatioMismatch,
    ZeroRedemption,
    ZeroSupply,
    InsufficientShares,
    ArithmeticOverflow,
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for CoreError {}

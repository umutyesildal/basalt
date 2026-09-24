use managed_core_proof::{
    Asset, CoreError, Counterparty, ManagedBasket, ManagedBasketConfig, PairFill, RawBalances,
    TimingPolicy,
};

const MANAGER: u64 = 1;
const GUARDIAN: u64 = 2;
const ALICE: u64 = 10;
const BOB: u64 = 11;
const TAKER: u64 = 20;

fn setup() -> (ManagedBasket, Counterparty) {
    let basket = new_basket(
        RawBalances::new(100, 100),
        &[(ALICE, 60), (BOB, 40)],
        [5_000, 5_000],
        TimingPolicy::new(10, 10, 20),
    );
    let taker = Counterparty::new(TAKER, RawBalances::new(0, 100));
    (basket, taker)
}

fn new_basket(
    vault_raw: RawBalances,
    initial_holders: &[(u64, u64)],
    target_weights_bps: [u16; 2],
    timing: TimingPolicy,
) -> ManagedBasket {
    ManagedBasket::new(ManagedBasketConfig {
        manager: MANAGER,
        guardian: GUARDIAN,
        initial_vault_raw: vault_raw,
        initial_holders: initial_holders.to_vec(),
        target_weights_bps,
        timing,
    })
    .unwrap()
}

fn propose_and_approve(
    basket: &mut ManagedBasket,
    max_input: u64,
    min_output: u64,
    proposed_at: u64,
    approved_at: u64,
) -> u64 {
    let nonce = basket
        .propose_rebalance(
            MANAGER,
            basket.allocation_version(),
            [2_500, 7_500],
            Asset::A,
            max_input,
            proposed_at,
        )
        .unwrap();
    basket
        .approve_price_bound(GUARDIAN, nonce, max_input, min_output, approved_at)
        .unwrap();
    nonce
}

#[test]
fn two_holders_keep_their_shares_and_redeem_current_vault_pro_rata_across_a_fill() {
    let (mut basket, mut taker) = setup();

    // A partial exit before the rebalance is permissionless and uses the
    // current 50/50 raw vault, reducing both balances and share supply equally.
    assert_eq!(basket.redeem(BOB, 10).unwrap(), RawBalances::new(10, 10));
    assert_eq!(basket.vault_raw(), RawBalances::new(90, 90));
    assert_eq!(basket.total_share_supply(), 90);

    // The proposal's visible delay starts only when the guardian commits the
    // immutable input/output bound at slot 8, so execution starts at slot 18.
    let nonce = propose_and_approve(&mut basket, 36, 36, 5, 8);
    let approved = basket.pending_proposal().unwrap().price_bound.unwrap();
    assert_eq!(approved.approved_at_slot, 8);
    assert_eq!(approved.execute_after_slot, 18);
    assert_eq!(approved.expires_at_slot, 38);

    // A bad early fill is rejected atomically.
    let before_early = basket.clone();
    let taker_before_early = taker.clone();
    assert_eq!(
        basket.fill_rebalance(
            TAKER,
            &mut taker,
            nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 36,
                output_raw: 36,
            },
            17,
        ),
        Err(CoreError::TooEarly)
    );
    assert_eq!(basket, before_early);
    assert_eq!(taker, taker_before_early);

    // Alice can redeem during the public notice period; the proposal does not
    // gate redemption and the exit is calculated against then-current assets.
    assert_eq!(basket.redeem(ALICE, 18).unwrap(), RawBalances::new(18, 18));
    assert_eq!(basket.vault_raw(), RawBalances::new(72, 72));
    assert_eq!(basket.total_share_supply(), 72);
    assert_eq!(basket.holder_shares(ALICE), 42);
    assert_eq!(basket.holder_shares(BOB), 30);

    // One bounded pair exchange changes the shared vault only. Share balances
    // and supply remain fixed, and both holders now own the same new mix.
    basket
        .fill_rebalance(
            TAKER,
            &mut taker,
            nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 36,
                output_raw: 36,
            },
            18,
        )
        .unwrap();
    assert_eq!(basket.vault_raw(), RawBalances::new(36, 108));
    assert_eq!(basket.total_share_supply(), 72);
    assert_eq!(basket.holder_shares(ALICE), 42);
    assert_eq!(basket.holder_shares(BOB), 30);
    assert_eq!(basket.target_weights_bps(), [2_500, 7_500]);
    assert_eq!(basket.allocation_version(), 1);
    assert!(basket.pending_proposal().is_none());
    assert_eq!(taker.balances_raw, RawBalances::new(36, 64));

    // Each holder's post-fill exit reflects the actual 25/75 raw vault mix.
    assert_eq!(basket.redeem(ALICE, 42).unwrap(), RawBalances::new(21, 63));
    assert_eq!(basket.redeem(BOB, 30).unwrap(), RawBalances::new(15, 45));
    assert_eq!(basket.vault_raw(), RawBalances::new(0, 0));
    assert_eq!(basket.total_share_supply(), 0);
}

#[test]
fn bad_price_bound_fill_wrong_taker_and_emptying_a_constituent_all_roll_back() {
    let (mut basket, mut taker) = setup();
    let nonce = propose_and_approve(&mut basket, 50, 40, 1, 2);
    let baseline_basket = basket.clone();
    let baseline_taker = taker.clone();

    let invalid_fills = [
        (
            TAKER,
            PairFill {
                input_asset: Asset::A,
                input_raw: 51,
                output_raw: 50,
            },
            CoreError::FillOutsideBounds,
        ),
        (
            TAKER,
            PairFill {
                input_asset: Asset::A,
                input_raw: 50,
                output_raw: 39,
            },
            CoreError::FillOutsideBounds,
        ),
        (
            TAKER,
            PairFill {
                input_asset: Asset::B,
                input_raw: 50,
                output_raw: 50,
            },
            CoreError::WrongAssetPair,
        ),
        (
            999,
            PairFill {
                input_asset: Asset::A,
                input_raw: 50,
                output_raw: 50,
            },
            CoreError::WrongCounterparty,
        ),
    ];

    for (actor, fill, expected) in invalid_fills {
        assert_eq!(
            basket.fill_rebalance(actor, &mut taker, nonce, fill, 12),
            Err(expected)
        );
        assert_eq!(basket, baseline_basket);
        assert_eq!(taker, baseline_taker);
    }

    // The approved order cannot sell an entire fixed constituent, even if
    // that amount is within its numeric max input.
    let (mut emptying_basket, mut emptying_taker) = setup();
    let empty_nonce = propose_and_approve(&mut emptying_basket, 100, 1, 1, 2);
    let before_emptying = emptying_basket.clone();
    let taker_before_emptying = emptying_taker.clone();
    assert_eq!(
        emptying_basket.fill_rebalance(
            TAKER,
            &mut emptying_taker,
            empty_nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 100,
                output_raw: 100,
            },
            12,
        ),
        Err(CoreError::WouldEmptyConstituent)
    );
    assert_eq!(emptying_basket, before_emptying);
    assert_eq!(emptying_taker, taker_before_emptying);
}

#[test]
fn delay_expiry_and_guardian_bound_are_enforced_without_partial_mutation() {
    let (mut basket, mut taker) = setup();
    let nonce = basket
        .propose_rebalance(MANAGER, 0, [3_000, 7_000], Asset::A, 20, 10)
        .unwrap();
    let after_proposal = basket.clone();

    assert_eq!(
        basket.approve_price_bound(GUARDIAN, nonce, 19, 18, 11),
        Err(CoreError::InvalidPriceBound)
    );
    assert_eq!(basket, after_proposal);

    let bound = basket
        .approve_price_bound(GUARDIAN, nonce, 20, 18, 11)
        .unwrap();
    assert_eq!(
        basket.pending_proposal().unwrap().approval_deadline_slot,
        20
    );
    assert_eq!(bound.execute_after_slot, 21);
    assert_eq!(bound.expires_at_slot, 41);
    let after_approval = basket.clone();

    // Guardian cannot secretly weaken an already-approved min-out.
    assert_eq!(
        basket.approve_price_bound(GUARDIAN, nonce, 20, 1, 12),
        Err(CoreError::PriceBoundAlreadyApproved)
    );
    assert_eq!(basket, after_approval);

    assert_eq!(
        basket.fill_rebalance(
            TAKER,
            &mut taker,
            nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 20,
                output_raw: 18,
            },
            40,
        ),
        Ok(())
    );
}

#[test]
fn guardian_must_approve_before_deadline_and_unapproved_proposal_can_expire() {
    let (mut basket, _) = setup();
    let nonce = basket
        .propose_rebalance(MANAGER, 0, [3_000, 7_000], Asset::A, 20, 10)
        .unwrap();
    let before_late_approval = basket.clone();

    // Proposal at slot 10 carries an approval deadline at slot 20. Approving
    // at the deadline is too late; delay does not begin for unapproved terms.
    assert_eq!(
        basket.approve_price_bound(GUARDIAN, nonce, 20, 18, 20),
        Err(CoreError::ApprovalDeadlinePassed)
    );
    assert_eq!(basket, before_late_approval);
    assert_eq!(
        basket.expire_proposal(19),
        Err(CoreError::ProposalNotExpired)
    );
    assert_eq!(basket, before_late_approval);

    basket.expire_proposal(20).unwrap();
    assert!(basket.pending_proposal().is_none());
}

#[test]
fn expired_fill_and_stale_manager_version_do_not_change_state() {
    let (mut basket, mut taker) = setup();
    let nonce = propose_and_approve(&mut basket, 20, 18, 1, 2);
    let before_expired_fill = basket.clone();
    let taker_before_expired_fill = taker.clone();

    assert_eq!(
        basket.fill_rebalance(
            TAKER,
            &mut taker,
            nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 20,
                output_raw: 18,
            },
            32,
        ),
        Err(CoreError::ProposalExpired)
    );
    assert_eq!(basket, before_expired_fill);
    assert_eq!(taker, taker_before_expired_fill);

    basket.expire_proposal(32).unwrap();
    let after_expiry = basket.clone();
    assert_eq!(
        basket.propose_rebalance(MANAGER, 9, [3_000, 7_000], Asset::A, 10, 33),
        Err(CoreError::StaleVersion)
    );
    assert_eq!(basket, after_expiry);
}

#[test]
fn raw_redemption_floors_each_asset_and_leaves_rounding_dust_for_remaining_shares() {
    let mut basket = new_basket(
        RawBalances::new(10, 7),
        &[(ALICE, 1), (BOB, 2)],
        [5_000, 5_000],
        TimingPolicy::new(5, 5, 5),
    );

    // floor(10 * 1 / 3) = 3 and floor(7 * 1 / 3) = 2 raw units.
    assert_eq!(basket.redeem(ALICE, 1).unwrap(), RawBalances::new(3, 2));
    assert_eq!(basket.vault_raw(), RawBalances::new(7, 5));
    assert_eq!(basket.total_share_supply(), 2);
    assert_eq!(basket.holder_shares(BOB), 2);

    assert_eq!(basket.redeem(BOB, 2).unwrap(), RawBalances::new(7, 5));
    assert_eq!(basket.total_share_supply(), 0);
    assert_eq!(basket.vault_raw(), RawBalances::new(0, 0));
}

#[test]
fn later_mints_and_redeems_follow_live_post_fill_vault_ratio_not_target_weights() {
    let mut basket = new_basket(
        RawBalances::new(100, 100),
        &[(ALICE, 100)],
        [5_000, 5_000],
        TimingPolicy::new(10, 10, 20),
    );

    // Bob's first deposit matches the initial 1:1 live vault ratio.
    assert_eq!(
        basket.mint_in_kind(BOB, RawBalances::new(20, 20)).unwrap(),
        20
    );
    assert_eq!(basket.vault_raw(), RawBalances::new(120, 120));
    assert_eq!(basket.total_share_supply(), 120);
    assert_eq!(basket.holder_shares(BOB), 20);

    // The bounded fill shifts the common pool. The 50 raw B output is within
    // the guardian's committed min-out, while target and resulting raw ratio
    // intentionally differ (25/75 target versus 60/170 actual units).
    let nonce = basket
        .propose_rebalance(MANAGER, 0, [2_500, 7_500], Asset::A, 60, 5)
        .unwrap();
    basket
        .approve_price_bound(GUARDIAN, nonce, 60, 50, 8)
        .unwrap();
    let mut taker = Counterparty::new(TAKER, RawBalances::new(0, 50));
    basket
        .fill_rebalance(
            TAKER,
            &mut taker,
            nonce,
            PairFill {
                input_asset: Asset::A,
                input_raw: 60,
                output_raw: 50,
            },
            18,
        )
        .unwrap();
    assert_eq!(basket.vault_raw(), RawBalances::new(60, 170));
    assert_eq!(basket.target_weights_bps(), [2_500, 7_500]);
    assert_eq!(basket.total_share_supply(), 120);

    // Against the post-fill live holdings, [12,17] implies 24 shares from A
    // and 12 from B, so it is outside the 1% tolerance. It fails atomically.
    let before_bad_deposit = basket.clone();
    assert_eq!(
        basket.mint_in_kind(BOB, RawBalances::new(12, 17)),
        Err(CoreError::DepositRatioMismatch)
    );
    assert_eq!(basket, before_bad_deposit);

    // [6,17] follows actual post-fill holdings: each leg implies 12 shares.
    // This ratio differs from the target weights, which are not used to price
    // in-kind shares. Bob's later redemption also pays from the live vault.
    assert_eq!(
        basket.mint_in_kind(BOB, RawBalances::new(6, 17)).unwrap(),
        12
    );
    assert_eq!(basket.vault_raw(), RawBalances::new(66, 187));
    assert_eq!(basket.total_share_supply(), 132);
    assert_eq!(basket.holder_shares(BOB), 32);
    assert_eq!(basket.redeem(BOB, 12).unwrap(), RawBalances::new(6, 17));
    assert_eq!(basket.vault_raw(), RawBalances::new(60, 170));
    assert_eq!(basket.total_share_supply(), 120);
    assert_eq!(basket.holder_shares(BOB), 20);
}

#[test]
fn in_kind_mint_uses_the_documented_exact_one_percent_boundary() {
    let mut at_boundary = new_basket(
        RawBalances::new(10_000, 10_000),
        &[(ALICE, 10_000)],
        [5_000, 5_000],
        TimingPolicy::new(5, 5, 5),
    );
    // Implied shares are 100 and 101: spread*100 == min, so exactly 1% passes.
    assert_eq!(
        at_boundary
            .mint_in_kind(BOB, RawBalances::new(100, 101))
            .unwrap(),
        100
    );

    let mut over_boundary = new_basket(
        RawBalances::new(10_000, 10_000),
        &[(ALICE, 10_000)],
        [5_000, 5_000],
        TimingPolicy::new(5, 5, 5),
    );
    let before = over_boundary.clone();
    // Implied shares are 100 and 102: spread*100 > min; no deposit or mint lands.
    assert_eq!(
        over_boundary.mint_in_kind(BOB, RawBalances::new(100, 102)),
        Err(CoreError::DepositRatioMismatch)
    );
    assert_eq!(over_boundary, before);
}

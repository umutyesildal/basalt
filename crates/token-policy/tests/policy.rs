use basalt_token_policy::{validate_mint, validate_token_account, MintProfile, PolicyError};
const KEY: [u8; 32] = [42; 32];
const AAPL: [u8; 32] = [
    7, 232, 160, 123, 86, 206, 146, 102, 185, 146, 170, 95, 214, 68, 92, 60, 119, 152, 178, 235,
    183, 51, 60, 30, 126, 222, 6, 44, 107, 134, 7, 229,
];
const SPY: [u8; 32] = [
    7, 232, 220, 44, 222, 123, 35, 160, 215, 67, 248, 241, 39, 107, 101, 125, 138, 158, 234, 6,
    149, 11, 166, 122, 141, 48, 51, 197, 60, 76, 222, 79,
];
fn mint() -> Vec<u8> {
    let mut b = vec![0; 82];
    b[44] = 8;
    b[45] = 1;
    b
}
fn account() -> Vec<u8> {
    let mut b = vec![0; 165];
    b[..32].copy_from_slice(&KEY);
    b[32..64].fill(17);
    b[64..72].copy_from_slice(&1_234_567_u64.to_le_bytes());
    b[108] = 1;
    b
}
fn extended(mut base: Vec<u8>, entries: &[(u16, Vec<u8>)], kind: u8) -> Vec<u8> {
    base.resize(165, 0);
    base.push(kind);
    for (t, v) in entries {
        base.extend(t.to_le_bytes());
        base.extend((v.len() as u16).to_le_bytes());
        base.extend(v)
    }
    base
}
fn scaled() -> Vec<u8> {
    let mut b = vec![0; 56];
    b[32..40].copy_from_slice(&1.25_f64.to_le_bytes());
    b[48..56].copy_from_slice(&2.5_f64.to_le_bytes());
    b
}
fn metadata() -> Vec<u8> {
    let mut b = vec![0; 32];
    b.extend(KEY);
    for s in ["Public fixture", "FIXx", "https://example.invalid/fixture"] {
        b.extend((s.len() as u32).to_le_bytes());
        b.extend(s.as_bytes());
    }
    b.extend(0_u32.to_le_bytes());
    b
}
fn pointer() -> Vec<u8> {
    let mut b = vec![0; 32];
    b.extend(KEY);
    b
}
fn issuer() -> Vec<(u16, Vec<u8>)> {
    let mut hook = vec![0; 64];
    hook[..32].fill(9);
    vec![
        (18, pointer()),
        (12, vec![8; 32]),
        (6, vec![1]),
        (25, scaled()),
        (26, vec![0; 33]),
        (4, vec![0; 65]),
        (14, hook),
        (19, metadata()),
    ]
}
fn mutate(entries: &mut [(u16, Vec<u8>)], kind: u16, f: impl FnOnce(&mut Vec<u8>)) {
    f(&mut entries.iter_mut().find(|(k, _)| *k == kind).unwrap().1)
}
fn issuer_mint(entries: &[(u16, Vec<u8>)]) -> Vec<u8> {
    extended(mint(), entries, 1)
}
fn tlv_value_range(data: &[u8], wanted: u16) -> std::ops::Range<usize> {
    let mut p = 166;
    loop {
        let k = u16::from_le_bytes([data[p], data[p + 1]]);
        let n = u16::from_le_bytes([data[p + 2], data[p + 3]]) as usize;
        if k == wanted {
            return p + 4..p + 4 + n;
        }
        p += 4 + n
    }
}

#[test]
fn captured_official_mints_have_full_supported_profile() {
    for (bytes, key) in [
        (include_bytes!("fixtures/AAPLx.bin").as_slice(), AAPL),
        (include_bytes!("fixtures/SPYx.bin").as_slice(), SPY),
    ] {
        let p = validate_mint(bytes, &key).unwrap();
        assert_eq!(p.profile, MintProfile::IssuerControlled);
        assert_eq!(p.decimals, 8);
        assert!(p.has_scaled_ui && p.issuer_controlled && p.mutable_hook_authority);
        assert_eq!(
            validate_mint(bytes, &KEY),
            Err(PolicyError::IdentityMismatch)
        );
    }
}
#[test]
fn plain_base_mint_preserves_decimals_and_freeze_info() {
    for d in [0, 6, 8, 12] {
        let mut b = mint();
        b[44] = d;
        b[46] = 1;
        let p = validate_mint(&b, &KEY).unwrap();
        assert_eq!(p.decimals, d);
        assert_eq!(p.profile, MintProfile::Plain);
        assert!(p.has_freeze_authority);
        assert!(!p.has_scaled_ui)
    }
    let mut b = mint();
    b[44] = 13;
    assert_eq!(validate_mint(&b, &KEY), Err(PolicyError::InvalidDecimals));
}
#[test]
fn base_mint_coption_and_initialization_are_canonical() {
    for off in [0, 46] {
        let mut b = mint();
        b[off] = 2;
        assert_eq!(
            validate_mint(&b, &KEY),
            Err(PolicyError::InvalidAccountData)
        );
    }
    let mut b = mint();
    b[45] = 0;
    assert_eq!(validate_mint(&b, &KEY), Err(PolicyError::Uninitialized));
    b[45] = 2;
    assert_eq!(
        validate_mint(&b, &KEY),
        Err(PolicyError::InvalidAccountData)
    );
}
#[test]
fn unused_coption_key_bytes_are_not_mistaken_for_invalid_padding() {
    let mut b = mint();
    b[4..36].fill(5);
    b[50..82].fill(6);
    assert!(validate_mint(&b, &KEY).is_ok());
}
#[test]
fn every_display_subset_is_admitted_without_privilege() {
    let all = [
        (18, pointer()),
        (19, metadata()),
        (25, scaled()),
        (6, vec![1]),
    ];
    for mask in 1..16 {
        let e: Vec<_> = all
            .iter()
            .enumerate()
            .filter(|(i, _)| mask & (1 << i) != 0)
            .map(|(_, e)| e.clone())
            .collect();
        let p = validate_mint(&extended(mint(), &e, 1), &KEY).unwrap();
        assert_eq!(p.profile, MintProfile::DisplayOnly);
        assert!(!p.issuer_controlled)
    }
}
#[test]
fn issuer_order_is_irrelevant_but_privileged_profile_must_be_complete() {
    let mut e = issuer();
    e.reverse();
    assert_eq!(
        validate_mint(&issuer_mint(&e), &KEY).unwrap().profile,
        MintProfile::IssuerControlled
    );
    for index in 0..8 {
        let mut e = issuer();
        e.remove(index);
        assert_eq!(
            validate_mint(&issuer_mint(&e), &KEY),
            Err(PolicyError::UnsupportedExtension)
        );
    }
}
#[test]
fn unsupported_known_and_unknown_mint_extensions_fail_closed() {
    for kind in [
        1, 2, 3, 5, 7, 8, 9, 10, 11, 13, 15, 16, 17, 20, 21, 22, 23, 24, 27, 28, 29, 255, 65535,
    ] {
        assert_eq!(
            validate_mint(&extended(mint(), &[(kind, vec![])], 1), &KEY),
            Err(PolicyError::UnsupportedExtension)
        );
    }
}
#[test]
fn every_fixed_mint_payload_has_exact_size() {
    for kind in [18, 12, 6, 25, 26, 4, 14] {
        for change in [-1, 1] {
            let mut e = issuer();
            mutate(&mut e, kind, |b| {
                if change < 0 {
                    b.pop();
                } else {
                    b.push(0)
                }
            });
            assert_eq!(
                validate_mint(&issuer_mint(&e), &KEY),
                Err(PolicyError::MalformedExtensions),
                "kind {kind}, change {change}"
            );
        }
    }
}
#[test]
fn metadata_pointer_and_metadata_must_bind_actual_mint() {
    for kind in [18, 19] {
        let mut e = issuer();
        mutate(&mut e, kind, |b| b[32] ^= 1);
        assert_eq!(
            validate_mint(&issuer_mint(&e), &KEY),
            Err(PolicyError::IdentityMismatch)
        );
    }
}
#[test]
fn metadata_schema_rejects_truncation_trailing_and_invalid_utf8() {
    let good = metadata();
    for n in 0..good.len() {
        let data = extended(mint(), &[(19, good[..n].to_vec())], 1);
        assert!(validate_mint(&data, &KEY).is_err(), "metadata prefix {n}");
    }
    let mut b = good.clone();
    b.push(0);
    assert_eq!(
        validate_mint(&extended(mint(), &[(19, b)], 1), &KEY),
        Err(PolicyError::MalformedExtensions)
    );
    let mut b = good;
    b[68] = 255;
    assert_eq!(
        validate_mint(&extended(mint(), &[(19, b)], 1), &KEY),
        Err(PolicyError::MalformedExtensions)
    );
}
#[test]
fn metadata_huge_lengths_and_pair_counts_fail_without_allocation() {
    let mut b = metadata();
    b[64..68].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(validate_mint(&extended(mint(), &[(19, b)], 1), &KEY).is_err());
    let mut b = metadata();
    let p = b.len() - 4;
    b[p..].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(validate_mint(&extended(mint(), &[(19, b)], 1), &KEY).is_err());
}
#[test]
fn metadata_additional_pairs_are_fully_consumed() {
    let mut b = metadata();
    let p = b.len() - 4;
    b[p..].copy_from_slice(&1_u32.to_le_bytes());
    for s in ["venue", "test"] {
        b.extend((s.len() as u32).to_le_bytes());
        b.extend(s.as_bytes())
    }
    assert!(validate_mint(&extended(mint(), &[(19, b.clone())], 1), &KEY).is_ok());
    b.pop();
    assert!(validate_mint(&extended(mint(), &[(19, b)], 1), &KEY).is_err());
}
#[test]
fn positive_finite_multipliers_only_in_both_slots() {
    for bits in [
        0,
        1_u64 << 63,
        (-1_f64).to_bits(),
        f64::INFINITY.to_bits(),
        f64::NEG_INFINITY.to_bits(),
        f64::NAN.to_bits(),
        0x7ff0000000000001,
    ] {
        for off in [32, 48] {
            let mut b = scaled();
            b[off..off + 8].copy_from_slice(&bits.to_le_bytes());
            assert_eq!(
                validate_mint(&extended(mint(), &[(25, b)], 1), &KEY),
                Err(PolicyError::InvalidExtensionState)
            );
        }
    }
    for f in [f64::from_bits(1), 0.5, 1.0, f64::MAX] {
        let mut b = scaled();
        b[32..40].copy_from_slice(&f.to_le_bytes());
        assert!(validate_mint(&extended(mint(), &[(25, b)], 1), &KEY).is_ok());
    }
}
#[test]
fn multiplier_and_schedule_do_not_change_raw_account_amount() {
    let mut a = scaled();
    let mut b = scaled();
    a[32..40].copy_from_slice(&0.5_f64.to_le_bytes());
    b[32..40].copy_from_slice(&3_f64.to_le_bytes());
    b[40..48].copy_from_slice(&i64::MAX.to_le_bytes());
    for s in [a, b] {
        assert!(validate_mint(&extended(mint(), &[(25, s)], 1), &KEY).is_ok());
        assert_eq!(
            validate_token_account(&account()).unwrap().amount,
            1_234_567
        )
    }
}
#[test]
fn paused_active_hook_and_frozen_default_rejected() {
    for (kind, offset) in [(26, 32), (14, 32), (6, 0)] {
        let mut e = issuer();
        mutate(&mut e, kind, |b| b[offset] = if kind == 6 { 2 } else { 1 });
        assert_eq!(
            validate_mint(&issuer_mint(&e), &KEY),
            Err(PolicyError::InvalidExtensionState)
        );
    }
}
#[test]
fn boolean_encoding_must_be_zero_or_one() {
    for kind in [26, 4] {
        let mut e = issuer();
        mutate(&mut e, kind, |b| b[32] = 2);
        assert_eq!(
            validate_mint(&issuer_mint(&e), &KEY),
            Err(PolicyError::MalformedExtensions)
        );
    }
    let mut e = issuer();
    mutate(&mut e, 4, |b| b[32] = 1);
    assert!(validate_mint(&issuer_mint(&e), &KEY).is_ok());
}
#[test]
fn duplicate_tlvs_are_rejected_even_with_valid_payloads() {
    let mut e = issuer();
    e[7] = e[0].clone();
    assert_eq!(
        validate_mint(&issuer_mint(&e), &KEY),
        Err(PolicyError::MalformedExtensions)
    );
    let e = [(25, scaled()), (25, scaled())];
    assert_eq!(
        validate_mint(&extended(mint(), &e, 1), &KEY),
        Err(PolicyError::MalformedExtensions)
    );
}
#[test]
fn zero_padding_is_allowed_only_after_real_extensions() {
    let mut b = extended(mint(), &[(25, scaled())], 1);
    for count in [1, 2, 4, 32] {
        let mut padded = b.clone();
        padded.extend(vec![0; count]);
        assert!(validate_mint(&padded, &KEY).is_ok());
    }
    b.extend([0, 0, 0, 0, 25, 0, 0, 0]);
    assert_eq!(
        validate_mint(&b, &KEY),
        Err(PolicyError::MalformedExtensions)
    );
    for n in [83, 165, 166, 170, 200] {
        let mut b = mint();
        b.resize(n, 0);
        if n > 165 {
            b[165] = 1;
        }
        assert!(validate_mint(&b, &KEY).is_err());
    }
}
#[test]
fn extended_mint_padding_account_kind_and_multisig_length_are_checked() {
    let b = extended(mint(), &[(25, scaled())], 1);
    for off in [82, 120, 164, 165] {
        let mut bad = b.clone();
        bad[off] = 9;
        assert_eq!(
            validate_mint(&bad, &KEY),
            Err(PolicyError::MalformedExtensions)
        );
    }
    let mut b = b;
    b.resize(355, 0);
    assert_eq!(
        validate_mint(&b, &KEY),
        Err(PolicyError::InvalidAccountData)
    );
}
#[test]
fn truncated_tlv_header_and_length_overruns_rejected() {
    let b = extended(mint(), &[(25, scaled())], 1);
    for n in 167..b.len() {
        assert!(validate_mint(&b[..n], &KEY).is_err(), "prefix {n}");
    }
    let mut b = b;
    b[168..170].copy_from_slice(&u16::MAX.to_le_bytes());
    assert_eq!(
        validate_mint(&b, &KEY),
        Err(PolicyError::MalformedExtensions)
    );
}
#[test]
fn official_fixture_mutations_reject_dangerous_semantics() {
    for (kind, offset) in [(26, 32), (14, 32), (4, 32), (25, 32)] {
        let mut b = include_bytes!("fixtures/AAPLx.bin").to_vec();
        let r = tlv_value_range(&b, kind);
        if kind == 25 {
            b[r.start + offset..r.start + offset + 8].fill(0)
        } else {
            b[r.start + offset] = if kind == 4 { 2 } else { 1 }
        }
        assert!(validate_mint(&b, &AAPL).is_err(), "kind {kind}");
    }
}
#[test]
fn official_fixture_truncated_payloads_do_not_panic() {
    let b = include_bytes!("fixtures/AAPLx.bin");
    for n in 0..b.len() {
        let result = std::panic::catch_unwind(|| validate_mint(&b[..n], &AAPL));
        assert!(result.is_ok(), "prefix {n}");
        if n == 82 {
            assert_eq!(result.unwrap().unwrap().profile, MintProfile::Plain);
        } else if n == 234 {
            assert_eq!(result.unwrap().unwrap().profile, MintProfile::DisplayOnly);
        } else {
            assert!(result.unwrap().is_err(), "prefix {n} unexpectedly accepted");
        }
    }
}
#[test]
fn initialized_base_account_returns_exact_identity_and_raw_amount() {
    let p = validate_token_account(&account()).unwrap();
    assert_eq!(p.mint, KEY);
    assert_eq!(p.owner, [17; 32]);
    assert_eq!(p.amount, 1_234_567)
}
#[test]
fn standard_issuer_atas_are_accepted_in_any_order() {
    let mut e = vec![(7, vec![]), (15, vec![0]), (27, vec![])];
    for _ in 0..3 {
        let p = validate_token_account(&extended(account(), &e, 2)).unwrap();
        assert_eq!(p.amount, 1_234_567);
        e.rotate_left(1);
    }
}
#[test]
fn account_confidential_fee_guard_memo_unknown_and_mint_types_are_rejected() {
    for kind in [
        1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 28,
        65535,
    ] {
        assert_eq!(
            validate_token_account(&extended(account(), &[(kind, vec![])], 2)),
            Err(PolicyError::UnsupportedExtension)
        );
    }
}
#[test]
fn frozen_uninitialized_and_bad_account_coptions_are_rejected() {
    for state in [0, 2, 3] {
        let mut b = account();
        b[108] = state;
        assert!(validate_token_account(&b).is_err());
    }
    for off in [72, 109, 129] {
        let mut b = account();
        b[off] = 2;
        assert_eq!(
            validate_token_account(&b),
            Err(PolicyError::InvalidAccountData)
        );
    }
}
#[test]
fn hook_account_requires_canonical_false() {
    for b in [1, 2, 255] {
        assert!(validate_token_account(&extended(account(), &[(15, vec![b])], 2)).is_err())
    }
    assert!(validate_token_account(&extended(account(), &[(15, vec![])], 2)).is_err());
    for kind in [7, 27] {
        assert_eq!(
            validate_token_account(&extended(account(), &[(kind, vec![0])], 2)),
            Err(PolicyError::MalformedExtensions)
        );
    }
}
#[test]
fn token_account_duplicate_kind_wrong_tag_and_truncated_base_rejected() {
    assert!(validate_token_account(&extended(account(), &[(7, vec![]), (7, vec![])], 2)).is_err());
    assert!(validate_token_account(&extended(account(), &[(7, vec![])], 1)).is_err());
    let b = account();
    for n in 0..b.len() {
        assert!(validate_token_account(&b[..n]).is_err());
    }
}
#[test]
fn arbitrary_mutation_fuzz_is_total_and_deterministic() {
    let fixture = include_bytes!("fixtures/AAPLx.bin");
    let mut seed = 0x7261775f616d6f75_u64;
    for _ in 0..2000 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        let mut b = fixture.to_vec();
        let i = (seed as usize) % b.len();
        b[i] ^= ((seed >> 32) as u8) | 1;
        let a = std::panic::catch_unwind(|| validate_mint(&b, &AAPL));
        assert!(a.is_ok());
        assert_eq!(a.unwrap(), validate_mint(&b, &AAPL));
    }
}

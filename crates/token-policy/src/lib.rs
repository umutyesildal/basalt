//! Shared, allocation-free Token-2022 admission policy.
//!
//! Layouts are pinned to the official SPL Token-2022 interface 1.0.0 sources;
//! see README.md and tests/fixtures/upstream-layouts.json. Modern interface
//! dependencies cannot coexist with the current Anchor/Solana dependency graph.
//! This parser recognizes complete wire schemas, not arbitrary opaque TLVs.
//!
//! CALLERS must verify the account is owned by Token-2022, then enforce the
//! expected mint/owner/ATA and authority-controlled mint whitelist separately.
//! Profiles describe transfer semantics, never issuer authenticity. Apply this
//! policy to admission and deposits only; do not add a redemption policy gate.
#![no_std]
#![forbid(unsafe_code)]

const MINT_LEN: usize = 82;
const ACCOUNT_LEN: usize = 165;
const EXTENSIONS_START: usize = 166;
const MAX_EXTENSIONS: usize = 8;
pub const MAX_DECIMALS: u8 = 12;

// Stable u16 discriminants from interface 1.0.0's repr(u16) ExtensionType.
const CONFIDENTIAL_MINT: u16 = 4;
const DEFAULT_STATE: u16 = 6;
const IMMUTABLE_OWNER: u16 = 7;
const PERMANENT_DELEGATE: u16 = 12;
const TRANSFER_HOOK: u16 = 14;
const TRANSFER_HOOK_ACCOUNT: u16 = 15;
const METADATA_POINTER: u16 = 18;
const TOKEN_METADATA: u16 = 19;
const SCALED_UI: u16 = 25;
const PAUSABLE: u16 = 26;
const PAUSABLE_ACCOUNT: u16 = 27;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PolicyError {
    InvalidAccountData,
    Uninitialized,
    MalformedExtensions,
    UnsupportedExtension,
    InvalidExtensionState,
    IdentityMismatch,
    InvalidDecimals,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MintProfile {
    Plain,
    DisplayOnly,
    IssuerControlled,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MintPolicyInfo {
    pub decimals: u8,
    pub profile: MintProfile,
    pub has_scaled_ui: bool,
    /// True for the complete privileged extension profile, not issuer identity.
    pub issuer_controlled: bool,
    pub mutable_hook_authority: bool,
    /// Base-mint freeze power exists independently of extension profiles.
    pub has_freeze_authority: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TokenAccountInfo {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub amount: u64,
}

#[derive(Clone, Copy)]
struct Entry<'a> {
    kind: u16,
    value: &'a [u8],
}
struct Entries<'a> {
    entries: [Entry<'a>; MAX_EXTENSIONS],
    len: usize,
}
impl Entries<'_> {
    fn iter(&self) -> core::slice::Iter<'_, Entry<'_>> {
        self.entries[..self.len].iter()
    }
    fn contains(&self, kind: u16) -> bool {
        self.iter().any(|entry| entry.kind == kind)
    }
}

/// Validate initialized base state and every extension of an admitted mint.
/// Does not read account ownership or authenticate an issuer; callers do both.
pub fn validate_mint(data: &[u8], mint_key: &[u8; 32]) -> Result<MintPolicyInfo, PolicyError> {
    let base = data
        .get(..MINT_LEN)
        .ok_or(PolicyError::InvalidAccountData)?;
    validate_coption(&base[..4])?;
    validate_coption(&base[46..50])?;
    match base[45] {
        0 => return Err(PolicyError::Uninitialized),
        1 => {}
        _ => return Err(PolicyError::InvalidAccountData),
    }
    let decimals = base[44];
    if decimals > MAX_DECIMALS {
        return Err(PolicyError::InvalidDecimals);
    }
    let mut info = MintPolicyInfo {
        decimals,
        profile: MintProfile::Plain,
        has_scaled_ui: false,
        issuer_controlled: false,
        mutable_hook_authority: false,
        has_freeze_authority: base[46] == 1,
    };
    if data.len() == MINT_LEN {
        return Ok(info);
    }
    let entries = parse_extensions(data, MINT_LEN, 1)?;
    let mut privileged = false;
    for entry in entries.iter() {
        match entry.kind {
            METADATA_POINTER => {
                let pointer = MetadataPointer::parse(entry.value)?;
                if pointer.metadata_address != *mint_key {
                    return Err(PolicyError::IdentityMismatch);
                }
            }
            TOKEN_METADATA => validate_metadata(entry.value, mint_key)?,
            SCALED_UI => {
                ScaledUi::parse(entry.value)?;
                info.has_scaled_ui = true;
            }
            DEFAULT_STATE => {
                exact(entry.value, 1)?;
                if entry.value[0] != 1 {
                    return Err(PolicyError::InvalidExtensionState);
                }
            }
            PERMANENT_DELEGATE => {
                // OptionalNonZeroPubkey is 32 bytes: zero=None, nonzero=Some.
                // No authority is silently inferred from its value.
                exact(entry.value, 32)?;
                privileged = true;
            }
            PAUSABLE => {
                let pause = Pausable::parse(entry.value)?;
                if pause.paused {
                    return Err(PolicyError::InvalidExtensionState);
                }
                privileged = true;
            }
            CONFIDENTIAL_MINT => {
                ConfidentialMint::parse(entry.value)?;
                privileged = true;
            }
            TRANSFER_HOOK => {
                let hook = TransferHook::parse(entry.value)?;
                if hook.active {
                    return Err(PolicyError::InvalidExtensionState);
                }
                info.mutable_hook_authority = hook.mutable_authority;
                privileged = true;
            }
            _ => return Err(PolicyError::UnsupportedExtension),
        }
    }
    if privileged {
        // Permit the observed issuer profile only as a complete set. A random
        // privileged extension attached to a display-only mint is not admitted.
        const ISSUER: [u16; 8] = [
            METADATA_POINTER,
            PERMANENT_DELEGATE,
            DEFAULT_STATE,
            SCALED_UI,
            PAUSABLE,
            CONFIDENTIAL_MINT,
            TRANSFER_HOOK,
            TOKEN_METADATA,
        ];
        if entries.len != ISSUER.len() || !ISSUER.iter().all(|kind| entries.contains(*kind)) {
            return Err(PolicyError::UnsupportedExtension);
        }
        info.profile = MintProfile::IssuerControlled;
        info.issuer_controlled = true;
    } else {
        info.profile = MintProfile::DisplayOnly;
    }
    Ok(info)
}

/// Deposit-side token-account validation, never a new gate on redemption.
/// Returns raw data only. Caller verifies program owner and canonical identity.
pub fn validate_token_account(data: &[u8]) -> Result<TokenAccountInfo, PolicyError> {
    let base = data
        .get(..ACCOUNT_LEN)
        .ok_or(PolicyError::InvalidAccountData)?;
    validate_coption(&base[72..76])?; // delegate
    validate_coption(&base[109..113])?; // native reserve
    validate_coption(&base[129..133])?; // close authority
    match base[108] {
        0 => return Err(PolicyError::Uninitialized),
        1 => {}
        2 => return Err(PolicyError::InvalidExtensionState), // frozen
        _ => return Err(PolicyError::InvalidAccountData),
    }
    if data.len() != ACCOUNT_LEN {
        let entries = parse_extensions(data, ACCOUNT_LEN, 2)?;
        for entry in entries.iter() {
            match entry.kind {
                IMMUTABLE_OWNER | PAUSABLE_ACCOUNT => exact(entry.value, 0)?,
                TRANSFER_HOOK_ACCOUNT => {
                    exact(entry.value, 1)?;
                    if canonical_bool(entry.value[0])? {
                        return Err(PolicyError::InvalidExtensionState);
                    }
                }
                // Includes ConfidentialTransferAccount, transfer fees,
                // MemoTransfer, CPI guard, non-transferable and future types.
                _ => return Err(PolicyError::UnsupportedExtension),
            }
        }
    }
    Ok(TokenAccountInfo {
        mint: read_key(&base[..32])?,
        owner: read_key(&base[32..64])?,
        amount: u64::from_le_bytes(
            base[64..72]
                .try_into()
                .map_err(|_| PolicyError::InvalidAccountData)?,
        ),
    })
}

fn validate_coption(tag: &[u8]) -> Result<(), PolicyError> {
    // Pack's COption layout is a canonical u32 0/1 tag. Its unused payload may
    // retain old bytes after SetAuthority(None), so do not require zero there.
    if tag == [0, 0, 0, 0] || tag == [1, 0, 0, 0] {
        Ok(())
    } else {
        Err(PolicyError::InvalidAccountData)
    }
}
fn read_key(bytes: &[u8]) -> Result<[u8; 32], PolicyError> {
    bytes
        .try_into()
        .map_err(|_| PolicyError::MalformedExtensions)
}
fn exact(bytes: &[u8], len: usize) -> Result<(), PolicyError> {
    if bytes.len() == len {
        Ok(())
    } else {
        Err(PolicyError::MalformedExtensions)
    }
}
fn canonical_bool(byte: u8) -> Result<bool, PolicyError> {
    match byte {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(PolicyError::MalformedExtensions),
    }
}

/// Validate the full TLV framing, account-kind byte, duplicate entries, and
/// padding. SPL ignores bytes after Uninitialized; this policy allows only
/// zeros there so malformed/hidden trailing TLVs never silently disappear.
fn parse_extensions(
    data: &[u8],
    base_len: usize,
    account_kind: u8,
) -> Result<Entries<'_>, PolicyError> {
    if data.len() < EXTENSIONS_START || data.len() == 355 {
        return Err(PolicyError::InvalidAccountData);
    }
    if data[base_len..ACCOUNT_LEN].iter().any(|byte| *byte != 0) || data[165] != account_kind {
        return Err(PolicyError::MalformedExtensions);
    }
    let mut out = Entries {
        entries: [Entry {
            kind: 0,
            value: &[],
        }; MAX_EXTENSIONS],
        len: 0,
    };
    let mut cursor = EXTENSIONS_START;
    while cursor < data.len() {
        let remaining = &data[cursor..];
        // Genuine zero allocation padding may be any length, including 1 byte.
        if remaining.iter().all(|byte| *byte == 0) {
            break;
        }
        let header = remaining.get(..4).ok_or(PolicyError::MalformedExtensions)?;
        let kind = u16::from_le_bytes([header[0], header[1]]);
        if kind == 0 || out.contains(kind) {
            return Err(PolicyError::MalformedExtensions);
        }
        if out.len == MAX_EXTENSIONS {
            return Err(PolicyError::UnsupportedExtension);
        }
        let len = usize::from(u16::from_le_bytes([header[2], header[3]]));
        let end = 4usize
            .checked_add(len)
            .ok_or(PolicyError::MalformedExtensions)?;
        let value = remaining
            .get(4..end)
            .ok_or(PolicyError::MalformedExtensions)?;
        out.entries[out.len] = Entry { kind, value };
        out.len += 1;
        cursor = cursor
            .checked_add(end)
            .ok_or(PolicyError::MalformedExtensions)?;
    }
    // Reject padded base mints/accounts masquerading as extension accounts.
    if out.len == 0 {
        return Err(PolicyError::MalformedExtensions);
    }
    Ok(out)
}

struct MetadataPointer {
    metadata_address: [u8; 32],
}
impl MetadataPointer {
    fn parse(bytes: &[u8]) -> Result<Self, PolicyError> {
        exact(bytes, 64)?; // optional authority[32], optional metadata_address[32]
        Ok(Self {
            metadata_address: read_key(&bytes[32..64])?,
        })
    }
}
struct ScaledUi;
impl ScaledUi {
    fn parse(bytes: &[u8]) -> Result<Self, PolicyError> {
        exact(bytes, 56)?; // authority[32], f64[8], i64[8], f64[8]
        positive_finite_f64(&bytes[32..40])?;
        positive_finite_f64(&bytes[48..56])?;
        Ok(Self)
    }
}
fn positive_finite_f64(bytes: &[u8]) -> Result<(), PolicyError> {
    let bits = u64::from_le_bytes(
        bytes
            .try_into()
            .map_err(|_| PolicyError::MalformedExtensions)?,
    );
    // Check IEEE-754 encoding without float arithmetic in the on-chain program.
    let positive = bits >> 63 == 0 && bits != 0;
    let finite = (bits >> 52) & 0x7ff != 0x7ff;
    if positive && finite {
        Ok(())
    } else {
        Err(PolicyError::InvalidExtensionState)
    }
}
struct Pausable {
    paused: bool,
}
impl Pausable {
    fn parse(bytes: &[u8]) -> Result<Self, PolicyError> {
        exact(bytes, 33)?;
        Ok(Self {
            paused: canonical_bool(bytes[32])?,
        })
    }
}
struct TransferHook {
    active: bool,
    mutable_authority: bool,
}
impl TransferHook {
    fn parse(bytes: &[u8]) -> Result<Self, PolicyError> {
        exact(bytes, 64)?;
        Ok(Self {
            active: bytes[32..64].iter().any(|byte| *byte != 0),
            mutable_authority: bytes[..32].iter().any(|byte| *byte != 0),
        })
    }
}
struct ConfidentialMint;
impl ConfidentialMint {
    fn parse(bytes: &[u8]) -> Result<Self, PolicyError> {
        exact(bytes, 65)?; // authority[32], bool, optional ElGamal auditor[32]
        canonical_bool(bytes[32])?;
        Ok(Self)
    }
}

/// Complete Borsh TokenMetadata schema: optional update authority[32], mint[32],
/// name/symbol/uri strings, then Vec<(String,String)>. No allocation or unchecked
/// length cast; every UTF-8 byte is consumed and trailing payload is rejected.
fn validate_metadata(bytes: &[u8], mint_key: &[u8; 32]) -> Result<(), PolicyError> {
    let identity = bytes.get(32..64).ok_or(PolicyError::MalformedExtensions)?;
    if identity != mint_key {
        return Err(PolicyError::IdentityMismatch);
    }
    let mut cursor = 64;
    for _ in 0..3 {
        take_string(bytes, &mut cursor)?;
    }
    let count = take_u32(bytes, &mut cursor)? as usize;
    // Every pair needs at least two u32 string lengths, even for empty strings.
    if count > bytes.len().saturating_sub(cursor) / 8 {
        return Err(PolicyError::MalformedExtensions);
    }
    for _ in 0..count {
        take_string(bytes, &mut cursor)?;
        take_string(bytes, &mut cursor)?;
    }
    if cursor != bytes.len() {
        return Err(PolicyError::MalformedExtensions);
    }
    Ok(())
}
fn take_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, PolicyError> {
    let end = cursor
        .checked_add(4)
        .ok_or(PolicyError::MalformedExtensions)?;
    let chunk = bytes
        .get(*cursor..end)
        .ok_or(PolicyError::MalformedExtensions)?;
    *cursor = end;
    Ok(u32::from_le_bytes(
        chunk
            .try_into()
            .map_err(|_| PolicyError::MalformedExtensions)?,
    ))
}
fn take_string(bytes: &[u8], cursor: &mut usize) -> Result<(), PolicyError> {
    let len = take_u32(bytes, cursor)? as usize;
    let end = cursor
        .checked_add(len)
        .ok_or(PolicyError::MalformedExtensions)?;
    let value = bytes
        .get(*cursor..end)
        .ok_or(PolicyError::MalformedExtensions)?;
    core::str::from_utf8(value).map_err(|_| PolicyError::MalformedExtensions)?;
    *cursor = end;
    Ok(())
}

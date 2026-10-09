//! Tests actual production Anchor init context validation, including account
//! ownership/deserialization, self Program<...>, canonical loader seeds and
//! signer constraints. Public in-memory fixtures only; no keys or RPC.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    bpf_loader_upgradeable,
    entrypoint::ProgramResult,
    instruction::Instruction,
    program_stubs::{set_syscall_stubs, SyscallStubs},
};

struct HostInitSyscalls;
impl SyscallStubs for HostInitSyscalls {
    fn sol_get_rent_sysvar(&self, destination: *mut u8) -> u64 {
        // Solana's host syscall interface supplies a properly aligned Rent pointer.
        unsafe { std::ptr::write(destination.cast::<Rent>(), Rent::default()) };
        0
    }
    fn sol_invoke_signed(
        &self,
        _instruction: &Instruction,
        _account_infos: &[AccountInfo],
        _signers_seeds: &[&[&[u8]]],
    ) -> ProgramResult {
        // Config fixtures already contain allocated zeroed storage owned by
        // the tested program. This stub bypasses System creation ONLY; it
        // does not replace any production Anchor authorization constraint.
        Ok(())
    }
}

fn info(
    key: Pubkey,
    owner: Pubkey,
    signer: bool,
    writable: bool,
    executable: bool,
    data: Vec<u8>,
) -> AccountInfo<'static> {
    let lamports = Rent::default().minimum_balance(data.len()).max(1);
    AccountInfo::new(
        Box::leak(Box::new(key)),
        signer,
        writable,
        Box::leak(Box::new(lamports)),
        Box::leak(data.into_boxed_slice()),
        Box::leak(Box::new(owner)),
        executable,
        0,
    )
}
fn fixture_key(n: u8) -> Pubkey {
    Pubkey::new_from_array([n; 32])
}

pub fn assert_cases(
    program_id: Pubkey,
    seed: &[u8],
    config_size: usize,
    mut run: impl FnMut(&'static [AccountInfo<'static>], Pubkey, Pubkey) -> bool,
) {
    let previous = set_syscall_stubs(Box::new(HostInitSyscalls));
    for case in [
        "valid",
        "nonsigner",
        "wrong-authority",
        "wrong-self-program",
        "nonexecutable-self",
        "wrong-program-loader",
        "wrong-loader-pointer",
        "wrong-programdata-pda",
        "noncanonical-loader-pair",
        "wrong-programdata-owner",
        "wrong-programdata-state",
        "truncated-programdata",
        "immutable-no-authority",
        "missing-programdata",
    ] {
        let authority = fixture_key(90);
        let config = Pubkey::find_program_address(&[seed], &program_id).0;
        let pd =
            Pubkey::find_program_address(&[program_id.as_ref()], &bpf_loader_upgradeable::ID).0;
        let noncanonical_data = fixture_key(91);
        // bincode UpgradeableLoaderState::Program { programdata_address }.
        let mut program_bytes = 2_u32.to_le_bytes().to_vec();
        program_bytes.extend_from_slice(
            if case == "wrong-loader-pointer" || case == "noncanonical-loader-pair" {
                noncanonical_data.as_ref()
            } else {
                pd.as_ref()
            },
        );
        // bincode ProgramData { slot:u64, upgrade_authority_address:Option<Pubkey> }.
        let mut pd_bytes = 3_u32.to_le_bytes().to_vec();
        pd_bytes.extend_from_slice(&1_u64.to_le_bytes());
        pd_bytes.push(if case == "immutable-no-authority" {
            0
        } else {
            1
        });
        pd_bytes.extend_from_slice(authority.as_ref());
        if case == "wrong-programdata-state" {
            pd_bytes = 0_u32.to_le_bytes().to_vec();
        }
        if case == "truncated-programdata" {
            pd_bytes.truncate(10);
        }
        let mut accounts = vec![
            info(config, program_id, false, true, false, vec![0; config_size]),
            info(
                if case == "wrong-authority" {
                    fixture_key(92)
                } else {
                    authority
                },
                anchor_lang::solana_program::system_program::ID,
                case != "nonsigner",
                true,
                false,
                vec![],
            ),
            info(
                anchor_lang::solana_program::system_program::ID,
                fixture_key(93),
                false,
                false,
                true,
                vec![],
            ),
            info(
                if case == "wrong-self-program" {
                    fixture_key(94)
                } else {
                    program_id
                },
                if case == "wrong-program-loader" {
                    fixture_key(95)
                } else {
                    bpf_loader_upgradeable::ID
                },
                false,
                false,
                case != "nonexecutable-self",
                program_bytes,
            ),
            info(
                if case == "noncanonical-loader-pair" {
                    fixture_key(91)
                } else if case == "wrong-programdata-pda" {
                    fixture_key(96)
                } else {
                    pd
                },
                if case == "wrong-programdata-owner" {
                    program_id
                } else {
                    bpf_loader_upgradeable::ID
                },
                false,
                false,
                false,
                pd_bytes,
            ),
        ];
        if case == "missing-programdata" {
            accounts.pop();
        }
        let accounts = Box::leak(accounts.into_boxed_slice());
        let accepted = run(accounts, authority, fixture_key(97));
        assert_eq!(
            accepted,
            case == "valid",
            "Anchor init authorization case: {case}"
        );
    }
    set_syscall_stubs(previous);
}

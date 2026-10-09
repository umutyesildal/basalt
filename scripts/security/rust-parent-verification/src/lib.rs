//! Host-only regression fixtures; no network, signer, program or deployed-account writes.

#[cfg(test)]
mod tests {
    use std::{
        env,
        ffi::OsString,
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_PATH: AtomicU64 = AtomicU64::new(0);

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = env::temp_dir().join(format!(
                "basalt-rust-parent-{}-{}",
                std::process::id(),
                NEXT_PATH.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("new isolated fixture directory");
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    struct LoggingEnvironment(Vec<(&'static str, Option<OsString>)>);
    impl LoggingEnvironment {
        fn isolated() -> Self {
            let prior = ["RUST_LOG", "_RUST_LOG"]
                .into_iter()
                .map(|name| (name, env::var_os(name)))
                .collect();
            env::remove_var("RUST_LOG");
            env::remove_var("_RUST_LOG");
            Self(prior)
        }
    }
    impl Drop for LoggingEnvironment {
        fn drop(&mut self) {
            for (name, value) in &self.0 {
                if let Some(value) = value {
                    env::set_var(name, value);
                } else {
                    env::remove_var(name);
                }
            }
        }
    }

    // One test owns process-global logging/environment so its phases cannot race.
    #[test]
    fn logger_retains_default_explicit_environment_filters_and_append_output() {
        let _environment = LoggingEnvironment::isolated();
        solana_logger::setup();
        assert_eq!(log::max_level(), log::LevelFilter::Error);
        solana_logger::setup_with_default_filter();
        assert_eq!(log::max_level(), log::LevelFilter::Info);

        env::set_var("RUST_LOG", "basalt_parent_patch=warn");
        solana_logger::setup_with_default("basalt_parent_patch=debug");
        assert_eq!(log::max_level(), log::LevelFilter::Warn);
        assert!(!log::log_enabled!(target: "basalt_parent_patch", log::Level::Info));
        assert!(log::log_enabled!(target: "basalt_parent_patch", log::Level::Error));

        solana_logger::setup_with("basalt_parent_patch=debug");
        assert_eq!(log::max_level(), log::LevelFilter::Debug);
        env::set_var("_RUST_LOG", "basalt_parent_patch=error");
        solana_logger::setup_with("basalt_parent_patch=trace");
        assert_eq!(log::max_level(), log::LevelFilter::Error);
        env::remove_var("RUST_LOG");
        env::remove_var("_RUST_LOG");

        let scratch = Scratch::new();
        let path = scratch.0.join("logger-output.log");
        fs::write(&path, "existing line\n").unwrap();
        solana_logger::setup_file_with_default(path.to_str().unwrap(), "basalt_parent_patch=info");
        log::debug!(target: "basalt_parent_patch", "excluded debug line");
        log::info!(target: "basalt_parent_patch", "retained info line");
        log::error!(target: "basalt_parent_patch", "retained error line");
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("existing line\n"));
        assert!(text.contains("retained info line"));
        assert!(text.contains("retained error line"));
        assert!(!text.contains("excluded debug line"));
        // Close the logger's file handle before the scratch directory is removed.
        solana_logger::setup();
    }

    #[test]
    fn sdk_mmap_genesis_load_preserves_serialized_bytes_fields_and_hash() {
        use solana_sdk::{
            account::AccountSharedData, genesis_config::GenesisConfig, pubkey::Pubkey,
        };
        let scratch = Scratch::new();
        let mut config = GenesisConfig {
            creation_time: 1_700_000_000,
            ..GenesisConfig::default()
        };
        config.add_account(
            Pubkey::new_from_array([17; 32]),
            AccountSharedData::new(123_456, 16, &Pubkey::new_from_array([18; 32])),
        );
        config.add_native_instruction_processor("fixture".into(), Pubkey::new_from_array([19; 32]));
        let before = bincode::serialize(&config).unwrap();
        config.write(&scratch.0).unwrap();
        assert_eq!(fs::read(scratch.0.join("genesis.bin")).unwrap(), before);
        let loaded = GenesisConfig::load(&scratch.0).unwrap();
        assert_eq!(loaded, config);
        assert_eq!(loaded.hash(), config.hash());
        assert_eq!(bincode::serialize(&loaded).unwrap(), before);
    }

    #[test]
    fn sdk_mmap_genesis_load_rejects_missing_empty_and_truncated_files() {
        use solana_sdk::genesis_config::GenesisConfig;
        let scratch = Scratch::new();
        assert!(GenesisConfig::load(&scratch.0).is_err());
        let path = scratch.0.join("genesis.bin");
        fs::write(&path, []).unwrap();
        assert!(GenesisConfig::load(&scratch.0).is_err());
        let bytes = bincode::serialize(&GenesisConfig::default()).unwrap();
        fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
        assert!(GenesisConfig::load(&scratch.0).is_err());
    }

    #[test]
    fn frozen_abi_anonymous_map_api_survives_and_rejects_unsound_ranges() {
        // The unchanged frozen-ABI AbiExample implementation uses map_anon(1).
        let mut map = memmap2::MmapMut::map_anon(1).unwrap();
        map[0] = 42;
        assert_eq!(map[0], 42);
        // Regression for RUSTSEC-2026-0186: invalid ranges must be errors, never
        // unchecked pointer arithmetic. Exercise overflow and out-of-bounds input.
        assert!(map.flush_range(usize::MAX, 1).is_err());
        assert!(map.flush_range(0, usize::MAX).is_err());
        assert!(map.flush_async_range(2, 1).is_err());
    }
}

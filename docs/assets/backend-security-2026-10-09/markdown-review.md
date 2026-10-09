# Basalt Markdown review, 2026-10-09

Review base: main@387ff5c3088315ab7471d3d3c304d51eb2ef52db. Reviewed project-owned Markdown, excluding vendored skills, dependencies, build output and generated video projects. The root checkout's separate 2026-10-04 audit/report and build-context were also reviewed. Security, architecture, release and operating records were read closely; historical design/product documents were reviewed by their decisions, status, scope, superseding notices and acceptance gates. No source, live deployment, key, authority or database was changed by this research task.

## Findings

- The requested prior backend/devnet/security work is the 2026-10-04 audit of exactly main@387ff5c, not the initial detached FolioX scaffold and not the uncommitted contract-hardening worktree. The audit deliberately applied no fixes.
- First package: BAS-AUD-02 production social-auth secret validation and BAS-AUD-03 bounded HTTP/nonce/quote resource consumption. Preserve backend non-custody and gate only social writes.
- Governance/compromised-key items BAS-AUD-01/04 remain operations work. Never reuse disclosed historical keys, add mutable basket treasury/update/admin-withdraw, or gate existing redeem.
- Medium follow-ups: deterministic multi-event identity (05), dedicated DB transaction plus concurrency for position effects (06), durable finalized pagination/cursor (07), fail-closed mint/vault facts (08), complete fresh NAV eligibility (09), dependency reachability/remediation (10).
- Latest dated Oct3 release and single-pipeline records supersede earlier local/unpushed notices. Preserve exact published historical evidence rather than globally rewriting snapshots.
- README route map line 101, brand lines 57/71, data-integrity line 34 and UX-plan lines 3/7 still describe /create/onchain redirects; current Oct3 workspace exposes fixed-mock claim/create/mint/redeem. Relevant current docs already explain this supersession.
- architecture-current line 111 overstates missing binary provenance; Oct3 has local-source/deployed-byte hashes and finalized byte attestation. Independent reproducible source-to-ELF build proof remains separate and open.
- deploy/DEPLOY.md troubleshooting line 211 says restarting usually resolves SOCIAL_AUTH_SECRET failures; after fail-closed configuration it must tell operators to provide a generated secret, then recreate/restart. Section 9 still puts auth/rate limits in future work; update scoped code completion while keeping deployment pending.
- Public agent guide lines 61-62 has stale multiplier example and claims 10^12 exceeds Number integer safety (threshold is 2^53-1). These are documentation corrections, outside first security code package.
- Managed V2 is merged historical provenance, opt-in/localnet, zero fees, and still lacks public admission/role rotation/full adversarial proof. Do not mix it into this backend package or reinstate the rejected holder-migration draft.

## Suggested dated roadmap text

Backend/devnet security remediation starts on codex/backend-devnet-security from main@387ff5c. It follows the read-only 2026-10-04 audit. This branch begins with BAS-AUD-02 and BAS-AUD-03: reject absent/short/known-placeholder production auth secrets before listening, require explicit local-only development fallback, limit JSON bodies by bytes with 413/abort handling, bound nonce storage and wallet/IP auth requests, and bound quote requests/upstream concurrency. Wallet signatures, single-use nonces and social-write-only bearer scope remain intact. The app continues to use raw Token-2022 amounts and backend-independent permissionless redemption.

Completion is recorded separately for code, regression tests and live operation. This package makes no VPS/Vercel/program deployment, secret rotation, asset transfer, repository-history rewrite or governance-authority transfer. BAS-AUD-01/04 stay open until the owner completes their reviewed operational evidence; BAS-AUD-05 through 10 remain ordered follow-up tasks. Mainnet remains blocked by the independent security/legal/governance gates.

Acceptance: production missing/placeholder secret fails before server.listen; old fallback tokens cannot authenticate with the configured secret; max body succeeds and max+1 byte returns 413; aborted/oversized requests release memory; repeated wallet/IP auth requests return 429 with bounded retained state; capacity remains at a measured hard upper bound and expires predictably; quote concurrency is bounded; normal GET remains responsive after rejected requests; trusted proxy configuration never trusts arbitrary forwarded headers. Run backend TypeScript build and full backend tests, with focused negative regressions and optional disposable PostgreSQL tests clearly distinguished from executed tests.

## Exact Markdown inventory

| File | Lines | SHA-256 |
|---|---:|---|
| `.superstack/build-context.md` | 56 | `44408a16e880cc9f585b5c4beeabae1f299a6ca1cbce36e6736ac4e80c5b75f0` |
| `.superstack/idea-context.md` | 119 | `ed9d6ff4dc5499fe42cecec88c8d93732af9283e2e408ab206deca81921b28b6` |
| `AGENTS.md` | 613 | `f995161194f43e9725effe9ef98e314ba633515a8bd44c73e4ebb73c722794bc` |
| `CLAUDE.md` | 594 | `0407a53fa8993f37b6b579e3d6dac3a85abf895edb3eeb1604a28f72094d9438` |
| `CONTEXT.md` | 596 | `f29bd6df82daea4f2a4e027e8b0fc171761dbce6fa709ca95f724c09243f9bd4` |
| `README.md` | 140 | `33800407cf173dd9697e394d0f7dd98fdad3b2aafb1c57adde73dd324524a60f` |
| `app/README.md` | 80 | `b2d7336363ee6ca467549d2d7047ffe2b2a697337f3c35eb294668b8b87d45db` |
| `app/public/basalt-agent-guide.md` | 118 | `a5ea085fcb0170ec0e9cc40960bb71ca7e18355b6445d0c946b1bd5421d05e2c` |
| `brand/social/twitter-profile.md` | 194 | `74023f5e7be827a522465b260edc0c84608367688a5f6b0354ebdc3bba13a0ef` |
| `brand.md` | 82 | `8ab16b9b381bd19f129ac8a240b77c0eeb76e8c5c799369955f8e65859c7b2e6` |
| `crates/token-policy/README.md` | 27 | `3874bac8b37c5d95cfbaf0eabbd9c81c15cd633ca8940b82a30041446f5e8114` |
| `deploy/DEPLOY.md` | 223 | `1ae38eb9684f5fd47e108ea67da5fc0686bbdf894ab4f0c79ead49a9321adb2b` |
| `docs/README.md` | 90 | `c0a082512cbc45fe579d720a5604b4535a191f5eab8b101d0a73f925eb74da79` |
| `docs/architecture-current.md` | 113 | `54f5306cb527b88050677ba309eea066f9528db82a224c92637060b070e1b845` |
| `docs/backend-cache-deployment-2026-10-03.md` | 69 | `bbda2c57e464a4d65d52946003f733ee5c72620b5511c86996588e9097a86c28` |
| `docs/bas-002-token2022-extension-policy.md` | 107 | `7988ee737a3ad71f7e0ef9eb2f74866e1c30df23549dfec6853aa8df57199317` |
| `docs/basalt-rebalance-v1-draft.md` | 205 | `de43a72dc85ee4086ee652ed96e3fcfdb52bd345b90a1198fb16c7516a91d0c9` |
| `docs/basalt-v0-spec.md` | 825 | `412d2bf9c7a252c67d3dacb9ba878fb9c3b7355da77f2c235494fae6dac797e5` |
| `docs/basket-cover-prompts-2026-10-02.md` | 151 | `443339617566915986e26be86b40958e18e8978ffdd6190daef677f5b945b8ff` |
| `docs/basket-cover-refresh-2026-10-02.md` | 41 | `27b63e18882a7061f966a040589e92f9ee479705a12076e312b6549f272c4db8` |
| `docs/colosseum-comparison-2026-10-02.md` | 57 | `35ecda5b539ac093ae71d8626fa3fba541eb72f6b095b4c5071372af0d1ddaa6` |
| `docs/compact-asset-cards-2026-10-03.md` | 23 | `e2e47f053788182d0433133507b46921db98af43718ca495cb7ec279035225ca` |
| `docs/competitive-landscape-2026-09-26.md` | 63 | `574f6382a87a648aed7b0793807b86d653475ffebef13a86e022b56000740549` |
| `docs/create-price-cache-2026-10-03.md` | 77 | `0f602b4a042d6ea89002cfc8821743653c1122849894aa34c10d0be65f84b16a` |
| `docs/current-state-2026-09-18.md` | 90 | `39e4467de46f62529237791cae87beb5b2dd83e62b851aa99d2aa2c81a20d173` |
| `docs/data-integrity-and-demo-policy.md` | 115 | `cdbae8ceb2839404a20d92af4020409030174e09f5b27f97de179b7aea6db0b5` |
| `docs/dependency-audit-2026-09-18.md` | 41 | `d6f650db30fff865e89ccc7bd616770627f7246671d9a035e09a1504b00e8e0c` |
| `docs/deployment-attestation.md` | 88 | `9609eab966fb7ae9ac15f536c15b024fb6bcf3ed2e4e4d610aa806d5f3523a02` |
| `docs/design-basalt-v1.md` | 132 | `943b572be29ba869c81734cb7f00dbbb699abb443c5e59d482f16eb35172c954` |
| `docs/design-cyberpunk-yellow-v1.md` | 245 | `b97f195e4c9e52eaa0f0fabb398eb0c0a48e57cf6bafb6855202004857f43cc0` |
| `docs/design-home-chapters-2026-10-02.md` | 63 | `84a3e7123f66720c75449de518916aef284b488051140afed1d9c0ddeed88ca7` |
| `docs/design-home-desktop-2026-09-27.md` | 31 | `ab1aeae2fd4077c9305e6b21a695084ee67db2bec639c4d8ec75b6b388f84a03` |
| `docs/design-home-discovery-2026-10-02.md` | 100 | `91d734afa52c127b02836d29ce71511c1d86d0af195c069c24e24c3eadfc4cc3` |
| `docs/design-home-visual-creation-2026-10-02.md` | 68 | `0e4f9f5550847f8ee7b4026fb951bcac7a0d52c90395c2ca1089211561cfb22a` |
| `docs/devnet-contract-readiness-2026-10-03.md` | 102 | `71824d13406b7e476e1772460b43ddf566e7a79a67405be1008e2f9a898a9ad5` |
| `docs/devnet-governance-audit-2026-09-19.md` | 89 | `de133e69cccd56275c10c5ea3609a92beb0de99fd96e3c58aaa96f179f7cf943` |
| `docs/devnet-live-2026-09-04.md` | 330 | `7a1bfb8950afae4d6ac4c36918d13a1b9c2c93d5143c44aca4aa8c6cdf5c7c2a` |
| `docs/devnet-single-pipeline-2026-10-03.md` | 53 | `984fecb1d91496cf31201f59136f235e501fac4c71f57ebf2ad78c3dcc863172` |
| `docs/devnet-smoke-2026-09-14.md` | 161 | `6990fcf773200602f52a9549c38b115bc3d82b05667805a55c468b9104b6c9a2` |
| `docs/devnet-ui-faucet-2026-10-03.md` | 47 | `00032c94935de6c39fbfdde30601a2b47fa5fddb172e58f5af678805e6471760` |
| `docs/devnet-ui-wallet-flow-2026-10-03.md` | 85 | `0405c98bee424f88cb0b58ffe3daef4df190b219a25d2b9d673c44d67850ec63` |
| `docs/git-checkpoint-2026-10-03.md` | 23 | `77b484296016b7bc35c527410a78e02fc96f1e75aadb0c6d1e5de3dc62f035c2` |
| `docs/github-live-release-2026-10-03.md` | 104 | `56baf2e393de5632e893ffc6747884ef379d99c5939f31fe65b65001a757a5c8` |
| `docs/governance-ceremony-runbook.md` | 217 | `269ebb25e8c9a5809c14b313095dd4854a9c0db9d415de9a423dba07f8e0772b` |
| `docs/home-create-feedback-2026-10-02.md` | 76 | `77c299ffc1103910a6e35ae1ee32904ff02a7f67828123bbd6d921e8e012b468` |
| `docs/home-hero-restoration-2026-10-02.md` | 33 | `dcc5e312751cb9fee7708d79059591cfe872b4be416c2b9feb8aa96c783d2e28` |
| `docs/ideathon-submission-2026-09.md` | 41 | `ef5180d611d0b1bba8c4ba6356fbe80fad64c68f9f3a03813dad5ab39dd95e3f` |
| `docs/implementation-backlog.md` | 488 | `0780b4ad5971e2b3681cfe78d3d935dfebe894f402b10cf99660cac9482e31cd` |
| `docs/indexed-basket-return-integrity.md` | 42 | `083f3f79cd73b5b2597ff2e731ce2cd062167bf75d36bbdd15d346b62d3ab196` |
| `docs/landing-journeys-2026-10-03.md` | 41 | `b4f1b97ac0106ee2f79e8a8dbd391f90d59a178d207d2b5fa43285dbd14221b8` |
| `docs/local-governance-rehearsal-2026-09-19.md` | 101 | `1b6f52597c2b14e11d75f8dcf837f162bcd5e4a5048aec01c886d7cbcfcddefa` |
| `docs/mainnet-readiness-roadmap.md` | 110 | `4cc7298a3080713082ccd096ccebe8875611f5d3a90af976404fa68f95b5d2c2` |
| `docs/managed-basket-v2-localnet-proof.md` | 21 | `0b80ffd35b5fb1b930ac4d38ca4b80a167bb6a715985a5b5f578dac99204c477` |
| `docs/managed-basket-v2-plan.md` | 113 | `c8eb97194a5a68d5c389fb0344bbb90e176decd4703456ef65304ebee0fe26d1` |
| `docs/managed-basket-v2-product-flow.md` | 148 | `c5569816b19600b6646d7377f793dc8435ef530f1d2c67dcdc57e17539698b79` |
| `docs/managed-basket-v2-prototype-status.md` | 39 | `d38c085982df7b50759eafa3366dab0a1157c63e413f01c6e4654dcc657c3a49` |
| `docs/managed-basket-v2-threat-model.md` | 119 | `61898897794e660a4308f9e6fe63eed3c2f47d49d9ed6255c2f89fddc9c0b7fb` |
| `docs/managed-basket-v2-wallet-lab.md` | 26 | `485bab5f75cc4f9132eb157fe2ed7a29a6b59bf9e90dd8517a405658af9f227a` |
| `docs/product-performance-audit-2026-10-02.md` | 130 | `8654a9b9d9066738c2fa38fa31b45cf43356bf493a3258671b902ad0216f3b70` |
| `docs/product-ux-improvement-plan.md` | 102 | `29ace0388b2d2a5161c0d7810178642b3b2fa10702a7c3a09be39a523d7c7d21` |
| `docs/providers.md` | 69 | `5e416cc76f26ef0b4e20a003cd518bf18a788cb96714c3ee6d8e1c18f9c53fc7` |
| `docs/security-hardening-plan.md` | 150 | `770aa918d7472d516239fb74756166b49383b8b20afeaa219fa572e108abfaaa` |
| `docs/session-updates-2026-10-02.md` | 173 | `0ebfa7654633a92b461bbe53a84fa3025338fd476ca66fe24e66450b194d2ee0` |
| `docs/session-updates-2026-10-03.md` | 66 | `ddabd880320406e0018d89a3d324af9a0a73bf3fa85b7575b1cc1f1addc43b16` |
| `docs/stocklana-submission-2026-09.md` | 72 | `84ac2752bdd77b8f77670b21daa4799bd05bcf05f5bb24ce89138dd9ae1e3c8a` |
| `docs/testing-and-release-plan.md` | 145 | `4e0a85707e8e2ce05371612e0ead67e3a12061fe489520e3edfd1f7b39bc5459` |
| `docs/ui-audit-wave3.md` | 107 | `a74118670d3b5530f036d3a04ecfedbfc66a74c899af4cd6782e2c4f716335dc` |
| `docs/ui-plan.md` | 56 | `2be772f0ab2ad8c566b768491ed79cbcc7ac1f84eb17a10cda4a98ee438aa9d0` |
| `docs/ui-primitives.md` | 205 | `19aa6cc22c629bc7c5708f64bd81769c01ccff8c4df0da4427e124f7b70f8821` |
| `docs/upgrade-governance-policy.md` | 163 | `ea4efcbe532e5dd962a9e79e314b001b0929010df9ee48f6a3e6229288b2d0aa` |
| `docs/v0-sbf-build-2026-10-03.md` | 53 | `afb93927f69af66d71c3bd7f937c5f6bc2798abf75b1519024490c9957f600bf` |
| `docs/xstocks-charts-2026-10-03.md` | 58 | `61d18080a8ed159834dc36356b7f24ddcf818ccb7d69f941d885397a583a6922` |
| `docs/xstocks-contract-compatibility-2026-10-03.md` | 182 | `20863038a39ebd63aad9873314c19ef35c4e29afa9bf0acbefb3f61133e5a719` |
| `docs/xstocks-devnet-basket-proof-2026-10-03.md` | 86 | `c9ac9b9416ff6eae338fa968f2ede5416289d581188a6df4f88bbe2475f09eab` |
| `docs/xstocks-devnet-runtime-2026-10-03.md` | 103 | `3110359db5606fd86a5e5196e82e50dde73d4a8b3935c5ad7e753c29ddb827c0` |
| `docs/xstocks-integration-2026-10-03.md` | 67 | `2df8da0ea4dabc69a79ced95a2b6cc92d84851fd635b6769ac8fe3e90004047f` |
| `docs/xstocks-live-data-research-2026-10-03.md` | 51 | `7681618b34be72c3d0d7f9666eb844cc2e6fffbd7aea17a2453ec57e3b4343af` |
| `docs/xstocks-token-policy-decision-2026-10-03.md` | 71 | `70f344010060f938d30a97ab4674ebb89589b51a475571e4631bcaf8b55e826e` |
| `foliox_build_prompt.md` | 235 | `bec2840dcaa2a361e423b8ebc581eeff432df4800b6543ecbdd7b9def88eb32d` |
| `handoff.md` | 118 | `632b4fb4d7d8c859d01f49e7113a5730429bba9ad1e8b85e2541035232525dd9` |
| `managed-core/README.md` | 25 | `c25633002d3c28612a478da5fcb798c7fec7036dfc55ddc49f8a03318b0c9aea` |
| `plan.md` | 337 | `de180871651cb07865bfc0765bed1407be475991cda8afb2322bbda2dad33222` |
| `programs/managed_basket/README.md` | 36 | `ee4caf46a1ee67f78ae2b1e220c31d3aad85d38019294e7aed697402b9ae5f31` |

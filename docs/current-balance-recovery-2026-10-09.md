# Independent current-balance recovery — 2026-10-09

The owner asked to complete the remaining devnet work after the website/backend release. This change recovers verifiable **current raw share balances** without claiming to reconstruct missing historical transactions or acquisition costs. Mainnet and real-asset activity remain outside this request.

## Why this is a separate projection

A fresh read-only production check found ten indexed baskets, two distinct quarantined transactions and zero activated historical rebuilds. Truncated original logs cannot supply an authentic event offset or a complete genesis/supply ledger. The existing historical rebuild, quarantine, conservation checks, immutable backups and activation boundary remain intact.

The new `current_balance_snapshots` table is independent of `user_positions`, position claims, reconciliation barriers and recovery receipts. Its `history_complete` column is constrained to false. Neither the worker nor the portfolio API can clear a historical guard. Unverified original positions remain preserved.

## What proves a balance

The worker verifies the devnet genesis and the exact distinct program roles, authenticates the canonical immutable Basket and plain six-decimal Token-2022 share mint, then reads candidate token-account bytes alongside that basket and mint at one finalized RPC context. Every candidate batch repeats the basket and mint. All batch slots and repeated bytes must agree; context drift retries the complete read within its deadline.

The standard [Solana getMultipleAccounts API](https://solana.com/docs/rpc/http/getmultipleaccounts) accepts at most 100 addresses. Each batch therefore contains at most 98 candidates plus the basket and mint. Discovery and reads are bounded; exceeding a limit or failing to reconcile preserves the failure rather than certifying a partial set.

Candidate addresses come from known owners, prior verified token accounts and bounded transaction account-key hints. These hints establish no balance or event. Only authenticated initialized Token-2022 accounts for the exact share mint contribute. Duplicate token accounts are removed before reading; owners' raw amounts are aggregated exactly. The sum must equal the authenticated mint's entire raw supply. For this plain, nonnegative share accounting, equality proves that no positive balance was omitted. Zero supply is handled explicitly. No parsed provider balance, invented log offset, inferred fill or floating-point share calculation is accepted.

Publication binds the configured program tuple and immutable indexed facts, rejects slot regression and superseded attempts, and commits one separate snapshot atomically. A failed or expired observation does not become a fresh verified zero. The API accepts only recently verified evidence for the configured deployment. Stored malformed or duplicate matched-holder records fail closed.

## User-visible result

Both portfolio endpoints prefer the independent verified balance for a covered basket, including a verified zero that supersedes a stale positive projection. Responses expose the finalized slot, observation time, source, coverage and explicit unknown history/cost flags. USD values and costs remain null for the independent snapshot path.

The portfolio screen displays exact six-decimal shares and the finalized slot. It withholds pending legacy projections, does not derive a value from optional basket-feed prices, and distinguishes verified zero positions in checked baskets from incomplete coverage. Baskets outside the indexed catalog are not covered by an empty result. Existing direct redemption continues to use the deployed legacy programs.

## Clean namespace preparation

The legacy factory treasury is immutable and still retired. The new unsigned [bootstrap plan](clean-devnet-bootstrap-plan.md) derives and checks public inputs without generating keys, inventing approvals or changing deployed IDs. Init-only source guards bind fresh whitelist/factory initialization to the authenticated loader upgrade authority, preventing a first-caller takeover. They add readonly init accounts and preserve existing config layouts and basket operations. These new program bytes are not deployed by a website/backend rollout.

Actual new-namespace activation still needs owner-supplied public governance/treasury identities, registration and runtime verification of the prepared legacy-aware client/indexer routing, the prescribed signer ceremony and deployed-byte evidence. No completed Squads or 48-hour rehearsal is claimed.

## Release evidence

Exact source, test results, candidate verification, rollout and public post-deployment observations are recorded with the release rather than inferred from this source description.

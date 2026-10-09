# Ledger recovery source proposal — approval required

This patch is an unexecuted source-code proposal. It has not been applied. It makes no live database calls, no RPC calls, no chain writes and no production publication. Existing event accounting remains atomic; the older periodic reconciliation writer is currently disabled.

## Exact approval-review rejection

> This broad multi-file rewrite changes on-chain holder validation, reconciliation, event deduplication, database locking, and valuation predicates, including position zeroing; its substantial unverified financial-ledger blast radius is not narrowly scoped enough for the general audit authorization.

The rejected rewrite was not applied. This artifact presents the affected ledger source for explicit human review; it is not an alternate execution route around the rejection. Independent valuation metadata fixes are already outside this proposal.

## Requested authorization

Authorize implementing and testing this source proposal in the isolated `codex/backend-devnet-security` worktree using only a disposable local PostgreSQL schema and in-memory authenticated RPC fixtures. This does not authorize connecting the activation operation to a live database, publishing a production projection, sending transactions, or deploying contracts. After approval, source review and tests may refine this patch; production activation remains a separate explicit operator decision.

## Review boundaries

- Reject the entire basket snapshot on malformed token accounts, wrong Token-2022 owner, wrong inner mint, duplicate accounts, uninitialized state, or missing finalized context. Parsed provider fallbacks cannot supply this evidence.
- Require mint supply and every holder account to share the exact same finalized slot; require the sum of holder balances to equal the authenticated mint supply and validate basket/mint PDA authority. Context drift fails closed after at most three complete snapshot attempts within a 10-second read deadline; other authentication faults fail immediately. Recovery transactions use 5-second lock, 15-second statement and 30-second idle-transaction timeouts.
- Serialize history discovery and per-basket projection updates on dedicated pooled connections and advisory locks. Incomplete scans, pending/quarantined signatures and unresolved legacy projections block reconciliation. Every program must have persisted verified discovery through the finalized snapshot slot; stale completion and zero-net unseen history cannot satisfy this evidence. Snapshot contexts newer than coverage fail closed and require catch-up/restaging; the approved staging CLI already catches up after reading its holder snapshot.
- Record a finalized snapshot slot in the same transaction as projection writes. Delayed canonical events already included in that snapshot claim their runtime identity without double-crediting balances. Historical fill cost remains unknown rather than fabricated.
- Activation is an exported explicit operation with no boot/worker/CLI caller. It rechecks the exact reviewed run/hash, all run metadata after lock acquisition, complete stable canonical history, staged claims and a new authenticated finalized snapshot. Changed history/holders/supply require restaging.
- Before publication, preserve every prior position and claim in immutable per-run backup tables; post-activation INSERT is also rejected so a backup cannot grow. Old negative legacy claim markers remain retained. Missing users are set to zero rather than deleted. New positions, canonical claims, snapshot barrier, activated status and legacy-guard transition commit in one transaction or all roll back.
- APIs and wallet valuation recognize a legacy guard as resolved only after the referenced run has matching basket and status 'activated' committed. The normal replay CLI remains staging-only.

## Validation required after source approval

1. Build plus existing backend test suite; keep strict finalized fixtures explicit.
2. Real disposable PostgreSQL fault injection after backup, first position write, canonical claim, marker update and final status update: no partial publication or backup should survive rollback; retry publishes exactly once.
3. Parallel same-basket event/reconcile calls, delayed snapshot-covered events, and unrelated baskets: no lost updates/double effects.
4. Wrong owner/mint, one malformed account, missing/partial enumeration, supply mismatch, context drift, missing snapshot-slot discovery coverage and RPC failure: preserve all prior positions and no marker advance.
5. History changes, active scan, pending/quarantined queue, stale or tampered staged rows, mismatched programs and already-activated run: reject activation.
6. Verify backups reject UPDATE/DELETE/TRUNCATE and post-activation INSERT, old negative claims remain readable and no automatic activation call exists.

## Operational state

No production projection was replaced. Automatic reconciliation remains disabled pending this source approval. Current-chain staging is available and nondestructive, but staged projections must not be treated as active. Historical cost basis cannot be reconstructed from current snapshots alone. The normal event writer does not create a genesis holder credit from BasketCreated: creator genesis and other known missing-position redemptions remain pending with position-projection-gap errors until authenticated historical staging and separately reviewed activation/reconciliation. No new genesis-credit implementation is enabled by the current approved code.

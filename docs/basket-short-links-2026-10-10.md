# Basket sharing and preview actions, 2026-10-10

Status: implemented; release verification is in progress. This record will be completed with the exact live source and deployments.

## Owner request and result

The encoded preview URL filled an X draft with a long block of text. A shared basket now receives a short `https://basalt.markets/b/<id>` address. The existing `/preview?d=...` links remain compatible. The short page renders the same basket directly and does not redirect back to the encoded URL.

The preview has one Actions card: Use this mix, Create image, a compact Copy link / Share on X row, and a quieter Create on devnet link. The separate share/onchain cards, duplicate header CTA and full-link toggle are removed. If clipboard permission fails, the short link is selected in a manual-copy field. API failures show a retry message rather than opening a long X draft.

## Snapshot and sharing behavior

- The complete validated v4 snapshot is stored unchanged: name, thesis, cover, amount, ordered assets with optional exact mints, weights and fees. Editing a snapshot creates a different address; existing records are immutable through the API.
- The address uses the first 120 bits of SHA-256, encoded as 20 base64url characters. The complete hash and exact payload are checked for collisions. Duplicate sharing requests return the same ID.
- Storage is a separate PostgreSQL `basket_shares` table in the existing persistent VPS database. It does not write indexed baskets, financial history, positions or social posts. Opening a preview alone does not persist it. Choosing Copy link, Share on X or Create image prepares the shared snapshot.
- The public endpoint is bounded: 8 KiB body, validated v4 structure, dedicated transactions with lock/statement timeouts, 25,000-row admission cap under an advisory lock, socket-peer and global write budgets, finite limiter storage and four concurrent writes. Forwarded headers are not trusted as identities. The app resolves only the fixed configured backend origin and fails closed for malformed IDs or snapshots.
- X receives an editable draft containing the short address. No tweet is posted and PNG files are not automatically attached by the web intent. Download PNG remains available. Native file sharing is offered only when the browser supports it and the short URL is ready, then requires a user click.
- Short pages expose matching canonical, Open Graph and Twitter metadata from the same validated snapshot. Share requests are deduplicated in a bounded client cache. Async copy, X preparation and native image sharing discard results from a previous basket or a closed component.

## Verification

- App typecheck and production build passed; the build contains dynamic `/b/[id]` and the existing 29 static pages.
- Backend strict TypeScript build passed. Focused validation and actual PostgreSQL tests passed, including concurrent duplicate requests, new-connection resolution, collision preservation and concurrent near-capacity admission.
- All 1,539 backend tests passed across 66 files with actual SQL regressions enabled on a disposable PostgreSQL cluster, zero skips. Full frontend checks passed before the final response-type guard; 28 focused short-link/resolution/metadata checks pass after that guard. Independent read-only review found no blocking defect.
- Public API and browser results follow below once completed.

## Release boundary

The previous live backend reports source `ef31b239a6887715f6a2fee59fed4d079035ee76` and image `sha256:43a74dd3d8a6dafdaaf6c5460264330fd9e8e020ab476ae7c5f9e3946609d657`. Its backend/dependency/runtime files match the clean baseline used here. The only preexisting deployment-tree difference is explanatory Markdown. No unrelated runtime upgrade is needed.

Retain the previous frontend deployment `dpl_AJvvU1od887UFEKpqdQMVyVhmYTm` for rollback. Before a backend rollout, retain and restore-test a private database/source/config/image backup, then keep a fresh dump under stopped writers. Preserve private environment files and all existing volumes. This additive snapshot table does not activate historical recovery or change devnet contracts, authorities, fees, pricing, financial projections or transaction behavior.

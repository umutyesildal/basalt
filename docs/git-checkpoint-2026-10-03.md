# Git checkpoint before the next landing revision, 2026-10-03

The owner requested a Git checkpoint of the accepted current version before continuing the new landing-page proposal. This snapshot preserves the calm stock-basket hero, discovery gallery, lower creator invitation, ten unique basket covers, Create improvements, model-performance leaderboard, and the existing backend, wallet-scheduling and governance-verifier work.

## Repository and boundary

- Canonical checkout: `/Users/umutyesildal/orca/workspaces/createyouretf/createyouretf`.
- Branch and intended push target: `main` to `origin/main`.
- Remote: `https://github.com/umutyesildal/basalt.git`.
- Pre-checkpoint local and remote head: `e18d6f429dbb657ef32b10bc8d83e27ae42b3c3b`, verified with `git ls-remote` on 2026-10-03.
- Commit message: `chore: checkpoint current Basalt product before landing revision`.

The subsequent request for a new benefits section, investor/manager steps and revised disclosure placement is outside this snapshot. No role-journey component had been written when work was paused. No new UI, protocol or deployment changes were made for this checkpoint.

All six untracked `brag-output-*` video-production directories remain local and are excluded. Ignored dependency folders, build output, environment files, keys and temporary runtime files are excluded. Five small build/test logs already linked by the dated audits are included deliberately as evidence; arbitrary runtime logs are not included. Archived build logs have trailing terminal whitespace normalized without changing their messages. Existing files are preserved on disk.

## Review and validation

The staged source, documentation and assets were checked for accidental secret files and common credential patterns. No real credential was found; the verifier test's `example.test` credential URL is a deliberate rejection fixture. The ten production basket images and dated visual evidence are included. The complete diff passes `git diff --check`.

This checkpoint uses the previously recorded [final restoration build and responsive checks](home-hero-restoration-2026-10-02.md). That build log was inspected again and confirms compilation, TypeScript checking and static-page generation. Tests and builds were not rerun solely to record the already-verified version. Earlier dated test counts retain their original scope and are not fresh test claims.

The commit itself identifies the exact saved tree; a successful push must be confirmed separately by matching the remote branch head to the local commit. This document does not claim a deployment or a protocol release.

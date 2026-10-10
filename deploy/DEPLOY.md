> **Current live owner-devnet release, 2026-10-10:** Website and VPS backend now run source `6cacb49f2b1a1fecd7398174c189c9bb65cec895`. The genuine owner initialization and independently verified 19-transaction three/four-token lifecycle are complete. New basket creation uses only the approved owner namespace and treasury; legacy baskets retain their read/redemption routes. Start at [Create on devnet](https://basalt.markets/create/onchain). No additional owner setup signature is required. See the [final release, exact identities and public evidence](../docs/devnet-owner-live-activation-2026-10-10.md).

> **Current limits:** This is a project-issued mock-token devnet release with single-owner governance. Chrome verified the live Create factory check and the existing legacy withdrawal screen without sending a transaction; no fresh human creation transaction is claimed. At 17:37:59 UTC, finalized discovery covered all six registered programs with zero pending scans or missing coverage, but 111 history signatures, four quarantine rows and seven basket rebuilds remained; USD valuations were unavailable. Historical financial recovery was not automatically activated. Earlier dated pending/disabled/backend-`307053d` statements below are preserved checkpoints, superseded by this release.

> **Release checkout:** Continue implementation and releases from `/Users/umutyesildal/.codex/worktrees/basket-art-release/createyouretf`. Older dirty checkouts retain unrelated work and must not be reset or deployed. The [release record](../docs/devnet-owner-live-activation-2026-10-10.md#guarded-vps-cutover-and-continuation) documents the stopped-writer backup and guarded manual continuation after a missing directory stopped the initial cutover.

# Basalt Backend — Devnet/Demo Deployment Runbook (VPS + Docker + Caddy)

> **Share-link follow-up, 2026-10-10:** Frontend and VPS backend now run source `307053da1310331c658c0401d0107f8405912199`, with persistent immutable preview short links. [Exact release, retained backups and Chrome verification](../docs/basket-short-links-2026-10-10.md). Historical projection/recovery guards remain in place.

> **Current release, 2026-10-09:** The data-repair website/backend release is live. Read the [exact deployment, rollback, hosted-build and runtime evidence](../docs/devnet-live-release-2026-10-09.md). Earlier pending-build statements below describe preparation; historical financial recovery remains guarded. This guide retains bootstrap instructions and the exact candidate/release boundaries in §9.

This runbook brings the Basalt backend (indexer + NAV engine + REST API) online
24/7 on a VPS. The frontend (Vercel) and Solana programs (devnet) are already
live; this runbook installs only the backend + PostgreSQL.

This is a devnet/demo operations guide, not a mainnet production runbook. Mainnet
requires the security, governance, attestation, data-truth, and legal gates in
`docs/implementation-backlog.md`.

**Architecture:**

```
User → https://api.<domain> (Cloudflare DNS)
     → VPS :443 (Caddy, automatic Let's Encrypt SSL)
     → backend container (Node 20, port 3001)
     → postgres container (internal network only, CLOSED externally)
```

**Why this stack:** the backend is non-custodial (it never stores private keys
and never signs transactions), so standard hardening (SSH key-only + firewall +
Postgres closed to the outside) provides sufficient security for a hackathon
demo. Redis is intentionally omitted: when `REDIS_URL` is not defined, the
backend falls back to an in-memory cache (`src/index.ts`).

---

## 0. Cost summary

| Item | Cost |
|---|---|
| Hetzner CX22 (2 vCPU, 4GB RAM, Germany) | ~€4/month |
| Cloudflare Registrar domain (.com ~$10/year, .xyz cheaper) | ~$2-10/year |
| Vercel + SSL + Docker | $0 |
| **Total** | **~€4-5/month** |

---

## 1. Create the server (you do this)

1. Go to https://console.hetzner.com → create a new project (for example, `basalt`) → **Add Server**.
2. Settings:
   - **Location:** Nuremberg or the region closest to your users
   - **Image:** Ubuntu 24.04
   - **Type:** Shared vCPU → **CX22** (2 vCPU / 4 GB)
   - **SSH keys:** add your existing `~/.ssh/id_ed25519.pub` (in the Hetzner
     panel, choose "Add SSH key" and paste the output of
     `cat ~/.ssh/id_ed25519.pub`)
3. Click Create. The server will be ready in about 30 seconds; **record its IP
   address** (for example, `5.75.x.x`).

> Hetzner accepts payment by credit card or PayPal. Account verification can
> sometimes take a few hours, so allow time before a planned demo.

## 2. Purchase a domain through Cloudflare (you do this)

1. Go to https://dash.cloudflare.com → **Domain Registration → Register Domain**.
2. Choose a short name (for example, `basalt.xyz`, `basaltlabs.com`). Cloudflare
   Registrar sells domains at cost (no markup).
3. The domain is added to your Cloudflare account automatically. Do not add a
   DNS record yet; that happens in §5.

## 3. Initial server setup (over SSH)

```bash
# Replace the IP. The first login uses your SSH key and does not ask for a password.
ssh root@SERVER_IP

# Update the system
apt update && apt upgrade -y

# Docker (official script)
curl -fsSL https://get.docker.com | sh

# Firewall: SSH + HTTP + HTTPS only
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# (Optional but recommended) work as a user instead of root
# adduser basalt && usermod -aG sudo,docker basalt
# Move ~/.ssh/authorized_keys to that user and disable root SSH access.
```

> No Docker ports other than 80/443 are published; Postgres is reachable only
> inside the Compose network.

## 4. Install and start the project

The repository is on GitHub (`umutyesildal/basalt`). If it is public:

```bash
git clone https://github.com/umutyesildal/basalt.git /opt/basalt
```

If it is private, create a deploy key or transfer it from your local machine with rsync:

```bash
# from your local machine (at the repository root):
rsync -avz --exclude node_modules --exclude .next --exclude target \
  --include '.env*.example' --exclude '.env*' \
  ./.dockerignore ./deploy ./backend ./vendor user@SERVER_IP:/opt/basalt/
```

Compose builds from the repository root using `backend/Dockerfile`. Transfer the
root `.dockerignore` and `vendor/` package as shown above; the image installs the
standalone backend lockfile and never copies frontend files or local env files.
The existing cache volume remains at `/app/.cache` in both compose settings and
runtime environment variables.

Configuration files:

```bash
cd /opt/basalt/deploy

# deploy/.env — Compose variables
cat > .env <<'EOF'
API_DOMAIN=api.YOURDOMAIN.COM
POSTGRES_PASSWORD=CHANGE_ME
EOF
# Generate a real random password and replace the placeholder:
#   openssl rand -hex 24

# backend/.env.production — application settings
cp ../backend/.env.production.example ../backend/.env.production
nano ../backend/.env.production
#   Put the output of `openssl rand -hex 32` into SOCIAL_AUTH_SECRET
#   Missing/short/placeholder secrets fail startup; never use the development opt-in here.
#   Fill in HELIUS_API_KEY if you have one (otherwise the public devnet RPC is used)

# Start (the first run builds the image and takes 1–2 minutes)
docker compose up -d --build

# Monitor the status
docker compose ps
docker compose logs -f backend   # Look for "[db] schema applied" and indexer lines
```

## 5. Cloudflare DNS + SSL

1. Cloudflare → domain → **DNS → Add record**:
   - Type `A`, Name `api`, IPv4 `SERVER_IP`, **Proxy status: OFF (gray cloud)** —
     required for the initial certificate issuance.
2. Wait for Caddy on the server to obtain the certificate (about 1 minute), then verify:
   ```bash
   curl -s https://api.YOURDOMAIN.COM/api/v1/health | head -c 400
   ```
3. After the certificate works, you can **enable** the Cloudflare proxy (orange
   cloud; free DDoS protection). Set the SSL/TLS mode to **Full (strict)**.
   Let's Encrypt certificate renewal continues to use HTTP-01; if you have
   problems, turn off the proxy and run `docker compose restart caddy`.

## 6. Connect the frontend to the new backend (Vercel)

`NEXT_PUBLIC_API` is inlined at build time, so changing it in Vercel requires a redeploy:

1. Go to https://vercel.com → the basalt project → **Settings → Environment Variables**.
2. Set `NEXT_PUBLIC_API` to `https://api.YOURDOMAIN.COM` (Production + Preview).
3. Go to **Deployments → latest → ⋯ → Redeploy**.
4. Test: https://basalt.markets/explore should now load data from the
   live backend.

### Current release path (2026-10-09)

The existing `basalt` Vercel project is not connected to Git. A push alone does
not deploy it. Build and upload from the repository root: the frontend imports
a canonical backend fee helper. Project settings are `rootDirectory: app` and
`sourceFilesOutsideRootDirectory: true`; `.vercelignore` excludes private
configuration, keys, caches and unrelated outputs.

After the release checks pass, deploy with production settings, verify the
returned build, then promote that exact deployment:

```bash
cd /path/to/clean/release-checkout
vercel deploy --prod --skip-domain --yes --project basalt --scope yesildaladams-projects
# Use the deployment ID or URL returned above after verification:
vercel promote DEPLOYMENT_ID_OR_URL --yes --scope yesildaladams-projects
```

Production uses `NEXT_PUBLIC_API=https://basalt.178.104.34.252.sslip.io`,
`NEXT_PUBLIC_CLUSTER=devnet`, a verified devnet RPC and
`NEXT_PUBLIC_SITE_URL=https://basalt.markets`. Preserve the existing
home-demo setting when updating infrastructure.

The checked-in `app/vercel.json` now invokes the frozen root-workspace installer,
`app/scripts/vercel-install.mjs`, from either build working directory. It validates
the root lock/local codec and pins npm 11.6.2 with `npm ci --legacy-peer-deps=false`.
Include the root package/lock, app, backend fee helper and vendor codec in the
upload. Local build success does not establish that Vercel used this install path:
check the exact new hosted build log before promotion. Hosted proof for this
follow-up is still pending.

The VPS uses rsync source updates under `/opt/basalt`, with no Git checkout.
Preserve `deploy/.env`, `backend/.env.production` and existing database/Caddy
volumes. Back up the DB, source, Compose file and running backend image, then
build/recreate only `backend`. Do not use `down -v` for a release. Quotes and
history persist in `backend_cache:/app/.cache`; see the
[cache migration](../docs/backend-cache-deployment-2026-10-03.md) for genuine
snapshot seeding outside the NYSE session. The
[published release record](../docs/github-live-release-2026-10-03.md) gives exact
source/image/deployment identities, rollback material and live checks.

## 7. Maintenance commands

```bash
cd /opt/basalt/deploy
docker compose logs -f backend            # live logs
docker compose restart backend            # restart the application
# Updates follow the verified candidate/release procedure in §9.

# Read-only backup/restore rehearsal with retained rollback material is in §9.
# Never prune volumes during a release or use `docker compose down -v`.
# Review unused images individually; retain the running and rollback image IDs.
```

## 8. Troubleshooting

| Symptom | Resolution |
|---|---|
| `docker compose ps` backend `unhealthy` | Check `docker compose logs backend`. Auth configuration failures intentionally stop before workers/listen: provide a generated `SOCIAL_AUTH_SECRET` in `backend/.env.production`, then recreate the backend. Restarting alone does not repair missing/weak/placeholder configuration. Diagnose DB failures separately. |
| Certificate could not be obtained | Is the DNS A record using the proxy-free (gray cloud) setting? `dig api.domain +short` should return the server IP. |
| `/api/v1/ready` returns 503 | Inspect its checks: DB/schema failures require PostgreSQL/migration diagnosis; network failures require the configured devnet RPC to recover and then a backend restart (RPC genesis is verified once at boot). `/health` is process liveness and may stay 200. |
| Indexer is not progressing | Check the `indexer lag` field in the `/api/v1/health` output; the public devnet RPC may be rate-limited → add `HELIUS_API_KEY`. |
| Vercel site still shows old data | `NEXT_PUBLIC_API` is a build-time value — was the deployment redeployed? |

## 9. Existing devnet release: backup, isolated rehearsal and rollout

This section applies to the current website/backend update. It does not deploy an
ELF, change program IDs or authorities, move assets, or activate a live position
recovery. Current supported-client basket creation remains blocked by the retired
factory treasury; existing direct-RPC redemption remains available.

Use one clean, tested source SHA. Before overwriting `/opt/basalt`, upload the
reviewed `deploy/prepare-candidate.sh` to a private temporary path and execute it
with `/opt/basalt/deploy` as the current directory. It reads the existing
`deploy/.env`; do not create or substitute `deploy.env`.

```bash
cd /opt/basalt/deploy
install -d -m 700 /var/backups/basalt
bash /private/path/prepare-candidate.sh \
  --source-sha=EXACT_40_HEX_SOURCE_SHA \
  --candidate-id=20261009_release \
  --directory=/var/backups/basalt/20261009_release
```

The helper takes a consistent online custom-format dump, records its checksum
and table-of-contents, retains the previous source/config/image, creates a separate
restricted candidate role/database, restores with errors fatal, and writes a
private candidate manifest and environment. It never stops the live backend,
changes the live schema or deletes failed evidence. Restoring successfully proves
the dump can be read; replay/staging and SQL tests separately prove migration and
projection behavior. Private dumps, wallet rows, credentials and review artifacts
stay on the server, outside Git and the website upload.

Build the exact new backend image with `BASALT_BUILD_SHA` set to the source SHA.
The image label and `/ready` source field are declared build provenance; retain
an independently checked source archive and image ID in the release record.
Do not rely on that field as an ELF or cryptographic reproducible-build attestation.
Mount the private candidate folder read-only into a **one-off maintenance**
container; pass `CANDIDATE_DATABASE_URL` and `RELEASE_SOURCE_SHA` privately and keep
the existing RPC/program configuration. Never start normal workers on the candidate.

```text
node dist/maintenance/recovery-operator.js inspect --manifest=/candidate/candidate.json
node dist/maintenance/replay-indexer.js --manifest=/candidate/candidate.json --max-polls=10
node dist/maintenance/replay-indexer.js --manifest=/candidate/candidate.json --max-polls=10 --stage-basket=EXACT_BASKET
node dist/maintenance/recovery-operator.js export --manifest=/candidate/candidate.json --run-id=EXACT_RUN --output=/private/review.json
```

Replay requires the exact candidate database/role/identity **before** applying the
schema. An incomplete archive, unavailable block order, quarantined logs or changed
finalized holder/supply facts fail closed. Export binds the candidate, source/backup
hash, exact run/history and staged holder/claim digests. Explicit candidate activation
requires review of that artifact and its raw file SHA:

```text
node dist/maintenance/recovery-operator.js activate --manifest=/candidate/candidate.json --review=/private/review.json --approve-sha256=EXACT_REVIEW_FILE_SHA --max-polls=10
```

This command cannot target live `foliox`. It reuses the atomic recovery API,
rechecks reviewed staging under locks and retains immutable per-run backups. After
an uncertain timeout, inspect and retry the same review to obtain its receipt.
A rehearsed candidate is not automatically published over the live database.

For the contained application rollout, retain a fresh consistent backup under
**stopped backend writers** immediately before the live migration/recreate. Preserve
all social/profile data accumulated since the initial rehearsal. Sync only the
reviewed source, preserving both private env files and all volumes. Validate the
candidate Caddy config using the running Caddy version before reload, then
rebuild/recreate only the backend with the pinned source SHA. Keep the original
DB dump, source, Compose config and image throughout the release.

`/api/v1/health` remains liveness. `/api/v1/ready` returns 503 for failed DB/schema,
required workers or unverified current devnet identity, and always uses `no-store`.
Its `projectionReady` additionally requires the exact registered six program histories,
non-null finalized coverage, a fresh completed discovery, empty pending/quarantine
queues and no unresolved legacy rebuilds. NAV coverage is reported separately;
missing prices never become fabricated valuations.

```bash
node scripts/verify-backend-rollout.mjs \
  --origin=https://basalt.178.104.34.252.sslip.io \
  --source-sha=EXACT_40_HEX_SOURCE_SHA
```

If a contained devnet release intentionally keeps pending/rebuild guards, use
`--allow-incomplete-projections` explicitly and retain the resulting incomplete
counts in the release record. This acknowledgement never clears guards or claims
recovery complete. Controlled 413/429 probes are a separate operator check: use
invalid requests, cap them at the configured threshold, avoid upstream quotes,
and account for the shared Caddy socket-peer quota before testing.

Only after backend checks pass, deploy the frontend with production settings and
`--skip-domain`, verify the exact returned deployment and promote it as described
in §6. Recheck the public devnet UI, API source identity, quote/history provenance,
creation notice and existing redemption path.

### Rollback boundary

Stop backend writers before any DB rollback or database switch. Restore the whole
pre-migration dump into a separate database, verify it, and select the matching old
image/config; retain the current database for comparison. Do not overwrite a live
volume, discard new user writes or treat per-run balance backups as a complete
rollback after new chain events. A later historical-position publication needs
its own exact review and a new consistent cutover plan. Never use `down -v` or
volume pruning. Website rollback promotes the retained previous Vercel deployment.

### Shared RPC and collection operations (new data-repair source)

The backend environment supports the following bounded settings:

```dotenv
# Optional private devnet endpoint supporting finalized Token-2022 holder enumeration.
# Leave empty when no provider is configured; never expose this in NEXT_PUBLIC variables.
POSITIONS_RPC_URL=
POSITIONS_RPC_UNSUPPORTED_COOLDOWN_MS=900000
RPC_MAX_CONCURRENCY=2
RPC_MAX_QUEUE=32
RPC_MIN_INTERVAL_MS=250
RPC_QUEUE_TIMEOUT_MS=2000
RPC_REQUEST_TIMEOUT_MS=8000
```

The secondary endpoint must pass full devnet genesis verification before workers
start and supplies the whole basket/holder/mint snapshot; no enhanced API fallback
or cross-provider account mixing is allowed. An account-index exclusion starts the
configured cooldown. Unsupported providers are skipped until the next probe, and
known history/rebuild blockers skip unnecessary holder scans before any RPC.
Configuration support does not provide credentials or make public RPC enumeration
available. Inspect sanitized subsystem `positionsRpc`, `rpcRequests` and
`positionsSync` evidence; do not paste endpoint credentials into logs or docs.

Normal discovery still retains the ordered financial queue. When its head requires
a rebuild, or quarantine blocks it, a separate bounded collector can persist later
canonical event facts. `db.history.pendingEvidence` tracks facts still unread;
`collectedPendingEffects` tracks authenticated facts whose financial work remains
pending. Collection keeps queue status, claims, balances and all recovery guards
unchanged. At most five signatures are collected per poll, and truncated/unverified
logs remain quarantined. An unchanged pending total can coexist with successful
fact collection. Do not interpret collection completion as activation, complete
balances, complete transaction history or eligible USD valuations.

Candidate replay remains explicit maintenance under the identity-bound manifest
commands above. Never clear a quarantine or operational guard just to advance
readiness; retained incomplete history still blocks staged financial recovery.
Health/ready and basket `dataQuality` must disclose those gaps. Missing exact-mint
prices, including project-issued mocks without USD market prices, remain
unavailable. Permissionless direct-RPC redemption is independent of these metrics.

## 10. Remaining mainnet prerequisites

- Complete the separate governance ceremony with real hardware signer/vault
  identities, exact approvals and upgrade rehearsal; no keys are invented here.
- Complete the remaining Rust migration/reachability work before the existing
  exception expiry. The bounded host logger/mmap changes reduce findings from 16
  to 13; the remaining scope/2026-10-23 expiry is unchanged. A new SBF build and
  any program deployment still require separate verification/approval; the Node
  devnet release does not attest deployed binaries.
- Complete external security and legal review and the mainnet go/no-go record.
- Reassess trusted-proxy identities/shared quotas before replicas or proxy changes.
- Configure the desired provider backup policy separately from the retained,
  restore-tested release backup.

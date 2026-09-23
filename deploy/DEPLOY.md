# Basalt Backend — Devnet/Demo Deployment Runbook (VPS + Docker + Caddy)

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

The repository is on GitHub (`umutyesildal/foliox`). If it is public:

```bash
git clone https://github.com/umutyesildal/foliox.git /opt/basalt
```

If it is private, create a deploy key or transfer it from your local machine with rsync:

```bash
# from your local machine (at the repository root):
rsync -avz --exclude node_modules --exclude .next --exclude target \
  --exclude .env.local --exclude .env.devnet --exclude backend/.env* \
  ./deploy ./backend user@SERVER_IP:/opt/basalt/
```

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
4. Test: https://basalt-coral.vercel.app/explore should now load data from the
   live backend.

### Current devnet release path (2026-09-23)

The `basalt` Vercel project is not connected to Git. A push to `main` alone
does not update `basalt-coral.vercel.app`. Deploy from the canonical `main`
worktree's `app/` directory after pushing and passing `npm run typecheck` and
`npm run build`:

```bash
cd /Users/umutyesildal/orca/workspaces/createyouretf/createyouretf/app
vercel deploy --prod --yes --scope yesildaladams-projects
```

Production uses the stable devnet API at
`https://basalt.178.104.34.252.sslip.io`, `NEXT_PUBLIC_CLUSTER=devnet`, and
`NEXT_PUBLIC_HOME_DEMO=0`. The site reads indexed devnet data; project mock
tokens and reference prices must remain labeled as such. Check
`/api/v1/health` on the API, then open `/create` and `/explore` on the public
alias to confirm both assets and baskets load. Before enabling automatic Git
deployments, set the Vercel project root to `app/` and confirm the production
branch is `main`.

## 7. Maintenance commands

```bash
cd /opt/basalt/deploy
docker compose logs -f backend            # live logs
docker compose restart backend            # restart the application
docker compose pull && docker compose up -d --build   # update

# Postgres backup (you can add this to cron):
docker compose exec postgres pg_dump -U basalt foliox | gzip > backup-$(date +%F).sql.gz
# Restore:
# gunzip -c backup-2026-09-17.sql.gz | docker compose exec -T postgres psql -U basalt foliox

# Clean up Docker artifacts if the disk is full:
docker system prune -af --volumes --filter "until=72h"   # WARNING: read the volume filter
```

## 8. Troubleshooting

| Symptom | Resolution |
|---|---|
| `docker compose ps` backend `unhealthy` | Run `docker compose logs backend` — this is usually caused by `SOCIAL_AUTH_SECRET` or a database wait issue; restarting is usually enough. |
| Certificate could not be obtained | Is the DNS A record using the proxy-free (gray cloud) setting? `dig api.domain +short` should return the server IP. |
| `/api/v1/health` returns `DB_UNAVAILABLE` | Run `docker compose logs postgres`; verify that the password matches `deploy/.env`. |
| Indexer is not progressing | Check the `indexer lag` field in the `/api/v1/health` output; the public devnet RPC may be rate-limited → add `HELIUS_API_KEY`. |
| Vercel site still shows old data | `NEXT_PUBLIC_API` is a build-time value — was the deployment redeployed? |

## 9. Next steps (before mainnet — OUTSIDE THE SCOPE of this runbook)

- Enable a Hetzner snapshot/backup policy for Postgres (in the panel, about a
  20% additional charge)
- Plan `SOCIAL_AUTH_SECRET` rotation and rate limiting (Caddy or Cloudflare WAF)
- Complete the `cso` + `review-and-iterate` security passes and legal review
  (README "Legal" section) — required for mainnet.

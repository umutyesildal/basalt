# Backend market-data cache deployment

The VPS backend now mounts the `backend_cache` Compose volume at `/app/.cache`.
Explicit `XSTOCK_PRICE_CACHE_PATH` and `XSTOCK_HISTORY_CACHE_PATH` settings point
to the existing workers' JSON snapshots. Postgres and Caddy volumes retain their
existing names and contents.

This matters during a closed NYSE session: the spot worker serves its last
validated Jupiter quotes but makes no upstream spot requests. A newly empty
container cannot recover those quotes until the next supported market session.
Daily history requests may still refresh outside that session. The change
preserves both caches across container rebuilds without changing these rules.

## Migrate the existing VPS before recreating the backend

Run from the existing VPS checkout's `deploy/` directory, using its existing
Compose project name, `deploy/.env` and `backend/.env.production`. Do not print
those env files. Keep the existing database, volumes and public API hostname.

First copy the current public cache snapshots from the running backend before
any container recreation:

```bash
mkdir -p cache-migration
docker compose cp backend:/app/.cache/xstocks-prices.json ./cache-migration/xstocks-prices.json
docker compose cp backend:/app/.cache/xstocks-history.json ./cache-migration/xstocks-history.json
```

If either path is absent, record that fact and preserve any snapshot that does
exist. Do not substitute generated or mock values. A verified saved public
snapshot from the current development backend may be copied to the VPS if the
old container predates these workers; keep its original timestamps and units.

After installing the updated Compose file and backend source, build the new
image, then seed the new named volume using only the snapshots that exist:

```bash
docker compose build backend
docker compose run --rm -T --no-deps --entrypoint sh backend -c 'cat > /app/.cache/xstocks-prices.json' < ./cache-migration/xstocks-prices.json
docker compose run --rm -T --no-deps --entrypoint sh backend -c 'cat > /app/.cache/xstocks-history.json' < ./cache-migration/xstocks-history.json
docker compose up -d --no-deps backend
```

These temporary commands mount the same `backend_cache` volume and do not start
the indexer or market workers. Do not run `docker compose down -v`, change the
Compose project name, delete `pgdata`, or prune volumes during this update.
Retain `cache-migration/` until the restarted API has been checked.

Verify the live API's health, catalog, one known spot quote and one history
series. Check quote `source`, `unit`, original `fetchedAt`/`observedAt`,
`stale`/`freshness`, and `marketSession`; a restored weekend quote must remain
stale. History must remain `geckoterminal`, `scaled-ui`, completed UTC daily
closes with the original saved timestamps. Confirm the frontend was built with
the existing public HTTPS API origin and `NEXT_PUBLIC_CLUSTER=devnet`.

## Public development snapshot inventory

Read-only inventory from the canonical checkout on 2026-10-03:

| File | Format | Saved data |
|---|---|---|
| `backend/.cache/xstocks-prices.json` | version 1; keys `version`, `savedAt`, `entries` | 176 entries; `savedAt` 2026-10-02T23:02:20.578Z |
| `backend/.cache/xstocks-history.json` | version 1; keys `version`, `source`, `unit`, `normalization`, `histories` | 13 histories |

This inventory establishes available saved public files, not the VPS's current
cache contents. Worker loaders validate issuer mints, units and timestamps
before serving saved data. The local `backend/.env.devnet` exists;
`backend/.env.production` does not. No env values or credentials were inspected
or printed for this inventory. VPS runtime configuration remains separate.

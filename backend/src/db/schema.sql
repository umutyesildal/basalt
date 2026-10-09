-- Basalt PostgreSQL schema — V0 per docs/basalt-v0-spec.md §7 (normative SQL)
--
-- IDEMPOTENT: safe to re-run on an existing database. Every statement uses
-- CREATE ... IF NOT EXISTS / CREATE OR REPLACE, so db/init.ts can apply it on
-- every boot. Apply manually with:
--     psql "$DATABASE_URL" -f src/db/schema.sql
--
-- INTEGER-SAFETY CONVENTION (AGENTS.md §2 #7 — binds every writer):
--   * Raw on-chain u64 amounts (TokenAccount.amount, share supply, event
--     gross/net/fee shares) can exceed Number.MAX_SAFE_INTEGER (2^53-1).
--     They live in BIGINT columns and MUST be bound from TypeScript as
--     decimal STRINGS (or via a BigInt-safe driver) — never as JS numbers.
--     BIGINT is i64 (ceiling 9223372036854775807): a u64 value beyond i64
--     range is REJECTED loudly by Postgres, never silently truncated. The
--     programs' amounts (token supplies, share supplies, sequential nonces)
--     stay far below that ceiling.
--   * `multiplier` and `scaled_amount` are display/NAV-only NUMERIC values
--     (scaled = raw × multiplier ÷ 10^decimals, human units). Programs use
--     raw only; the backend never feeds scaled amounts back on-chain.

BEGIN;

-- ---------------------------------------------------------------------------
-- baskets (immutable core — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS baskets (
  pubkey TEXT PRIMARY KEY,                -- basket PDA
  factory TEXT NOT NULL,                  -- FactoryConfig PDA
  creator TEXT NOT NULL,
  treasury TEXT NOT NULL,                 -- fee treasury (from FactoryConfig)
  share_mint TEXT NOT NULL UNIQUE,        -- Token-2022 share mint, 6 decimals
  nonce BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  metadata_hash TEXT NOT NULL,            -- hex of [u8;32] (IPFS content hash)
  metadata_json JSONB,                    -- off-chain name, desc, image
  num_constituents INT NOT NULL CHECK (num_constituents BETWEEN 2 AND 20),
  constituents TEXT[] NOT NULL,           -- ordered mint pubkeys
  weights_bps INT[] NOT NULL,             -- ordered, sum 10000
  entry_fee_bps INT NOT NULL,
  exit_fee_bps INT NOT NULL,
  management_fee_bps INT NOT NULL,
  last_fee_accrual_ts TIMESTAMPTZ NOT NULL,
  CHECK (array_length(constituents,1) = num_constituents),
  CHECK (array_length(weights_bps,1) = num_constituents)
);

-- ---------------------------------------------------------------------------
-- whitelist (spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS whitelisted_mints (
  mint TEXT PRIMARY KEY,
  decimals INT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active','PausedNewMints')),
  price_source TEXT,
  multiplier NUMERIC NOT NULL DEFAULT 1,  -- cached Scaled UI Amount multiplier
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- vault holdings snapshot per basket (updated every 30s or on event — spec §7)
-- raw_amount is u64 and MUST be bound as a string (see header convention).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vault_holdings (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  mint TEXT REFERENCES whitelisted_mints(mint),
  raw_amount BIGINT NOT NULL,             -- u64 raw base units
  multiplier NUMERIC NOT NULL DEFAULT 1,  -- Token-2022 ScaledUiAmountConfig
  scaled_amount NUMERIC NOT NULL,         -- raw*multiplier/10^decimals (display)
  decimals INT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (basket, mint)
);

-- ---------------------------------------------------------------------------
-- NAV snapshots (every 1 min — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nav_snapshots (
  id BIGSERIAL PRIMARY KEY,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  nav NUMERIC NOT NULL,                   -- Σ scaled*price (USD)
  supply BIGINT NOT NULL,                 -- share supply, raw u64 base units
  share_price NUMERIC NOT NULL,           -- nav / supply
  price_source JSONB NOT NULL             -- map of mint -> {price, source, asOf}
);
ALTER TABLE vault_holdings ADD COLUMN IF NOT EXISTS authenticated BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nav_snapshots ADD COLUMN IF NOT EXISTS valuation_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE nav_snapshots ADD COLUMN IF NOT EXISTS valuation_status TEXT NOT NULL DEFAULT 'legacy-unverified';
CREATE INDEX IF NOT EXISTS nav_snapshots_eligible_basket_ts_idx ON nav_snapshots(basket, ts DESC) WHERE valuation_eligible AND valuation_status = 'complete';
CREATE TABLE IF NOT EXISTS basket_valuation_state (
  basket TEXT PRIMARY KEY REFERENCES baskets(pubkey) ON DELETE CASCADE,
  status TEXT NOT NULL,
  reason TEXT,
  attempted_at TIMESTAMPTZ NOT NULL,
  last_complete_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS nav_snapshots_basket_ts_idx ON nav_snapshots(basket, ts DESC);

-- ---------------------------------------------------------------------------
-- share supply history (dilution tracking — spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_snapshots (
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  supply BIGINT NOT NULL,                 -- raw u64 base units
  PRIMARY KEY (basket, ts)
);

-- ---------------------------------------------------------------------------
-- indexed program events (spec §7)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  sig TEXT NOT NULL,                      -- transaction signature
  log_index INT NOT NULL DEFAULT -1,       -- runtime log offset; -1 = quarantined legacy row
  slot BIGINT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey),
  type TEXT NOT NULL CHECK (type IN ('BasketCreated','Minted','Redeemed','FeeAccrued')),
  data JSONB NOT NULL,                    -- decoded Anchor event (u64 fields as decimal strings)
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (sig, log_index)
);
ALTER TABLE events ADD COLUMN IF NOT EXISTS log_index INT NOT NULL DEFAULT -1;
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_pkey;
ALTER TABLE events ADD CONSTRAINT events_pkey PRIMARY KEY (sig, log_index);
CREATE INDEX IF NOT EXISTS events_basket_ts_idx ON events(basket, ts DESC);
CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events(type, ts DESC);

-- ---------------------------------------------------------------------------
-- creator stats (spec §7 + AGENTS §9)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creator_stats (
  creator TEXT PRIMARY KEY,
  basket_count INT NOT NULL DEFAULT 0,
  total_aum NUMERIC NOT NULL DEFAULT 0,
  total_fees_earned NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- user positions (spec §7; "user" is a reserved word and must stay quoted)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_positions (
  "user" TEXT NOT NULL,
  basket TEXT REFERENCES baskets(pubkey) ON DELETE CASCADE,
  share_balance BIGINT NOT NULL DEFAULT 0,  -- raw u64 base units
  cost_basis NUMERIC,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user", basket)
);
CREATE INDEX IF NOT EXISTS user_positions_user_idx ON user_positions("user");
CREATE INDEX IF NOT EXISTS user_positions_basket_idx ON user_positions(basket);
-- cost_basis provenance: 'reference' = blended from nav_snapshots.share_price
-- by the indexer (an estimate, not a fill price). NULL = cost basis unknown.
ALTER TABLE user_positions ADD COLUMN IF NOT EXISTS cost_basis_source TEXT;

-- ---------------------------------------------------------------------------
-- position_events — idempotency ledger for user_positions writes (indexer).
-- Every applied Minted/Redeemed/FeeAccrued claims its runtime (sig, log_index)
-- in the same transaction as all position effects. Legacy negative offsets
-- retain evidence of old claims and keep their baskets pending recovery.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS position_events (
  sig TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('Minted','Redeemed','FeeAccrued')),
  basket TEXT,                              -- informational (no FK: fee splits
                                           -- may run before baskets is indexed)
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  log_index INT NOT NULL DEFAULT -1,
  PRIMARY KEY (sig, log_index)
);
ALTER TABLE position_events ADD COLUMN IF NOT EXISTS log_index INT NOT NULL DEFAULT -1;
ALTER TABLE position_events ADD COLUMN IF NOT EXISTS slot BIGINT CHECK(slot >= 0);
-- Old (sig,kind) can have several rows. Distinct negative offsets preserve all markers;
-- none is a canonical runtime event or safe evidence that its effects committed.
WITH legacy AS (
  SELECT ctid, -row_number() OVER (PARTITION BY sig ORDER BY kind)::int AS ordinal
  FROM position_events WHERE log_index < 0
)
UPDATE position_events p SET log_index = legacy.ordinal FROM legacy WHERE p.ctid = legacy.ctid;
ALTER TABLE position_events DROP CONSTRAINT IF EXISTS position_events_pkey;
ALTER TABLE position_events ADD CONSTRAINT position_events_pkey PRIMARY KEY (sig, log_index);
CREATE TABLE IF NOT EXISTS position_rebuild_required (
  basket TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO position_rebuild_required(basket, reason)
SELECT DISTINCT basket, 'legacy-nonatomic-position-ledger' FROM position_events
WHERE log_index < 0 AND basket IS NOT NULL ON CONFLICT (basket) DO NOTHING;
-- Pre-slot atomic ledgers cannot establish which finalized snapshot covers their effects.
INSERT INTO position_rebuild_required(basket, reason)
SELECT DISTINCT basket, 'missing-finalized-position-slot' FROM position_events
WHERE log_index >= 0 AND slot IS NULL AND basket IS NOT NULL ON CONFLICT (basket) DO NOTHING;

-- ---------------------------------------------------------------------------
-- basket_rankings — materialized view per spec §7, refreshed by the NAV
-- worker (~every 5m) with REFRESH MATERIALIZED VIEW CONCURRENTLY (the unique
-- index below makes CONCURRENTLY legal).
-- ---------------------------------------------------------------------------
-- One-time upgrade of the old total-NAV-return materialized view.
-- This is derived data only. No CASCADE: unexpected external dependencies
-- fail closed rather than being removed. Subsequent bootstraps keep the view.
DO $basket_returns_migration$
BEGIN
  IF to_regclass('basket_rankings') IS NOT NULL THEN
    IF position('first_day.share_price' IN pg_get_viewdef(to_regclass('basket_rankings'))) = 0
       OR position('valuation_eligible' IN pg_get_viewdef(to_regclass('basket_rankings'))) = 0
       OR position('basket_valuation_state' IN pg_get_viewdef(to_regclass('basket_rankings'))) = 0 THEN
      DROP MATERIALIZED VIEW basket_rankings;
    END IF;
  END IF;
END;
$basket_returns_migration$;

CREATE MATERIALIZED VIEW IF NOT EXISTS basket_rankings AS
SELECT
  b.pubkey,
  b.creator,
  b.share_mint,
  h.nav,
  h.supply,
  h.share_price,
  CASE WHEN h.supply > 0 AND h.nav >= 0 AND h.share_price >= 0
         AND h.nav::text NOT IN ('NaN', 'Infinity', '-Infinity')
         AND h.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
         AND EXISTS (SELECT 1 FROM basket_valuation_state current_state
                     WHERE current_state.basket = b.pubkey AND current_state.status = 'complete'
                       AND current_state.last_complete_at = h.ts)
         AND h.ts <= NOW() AND h.ts >= NOW() - interval '15 minutes'
         AND first_day.supply > 0 AND first_day.share_price > 0
         AND first_day.share_price::text NOT IN ('NaN', 'Infinity', '-Infinity')
       THEN (h.share_price - first_day.share_price) / NULLIF(first_day.share_price, 0)
  END AS return_30d,
  COUNT(DISTINCT (e.sig,e.log_index)) FILTER (WHERE e.type = 'Minted' AND e.log_index >= 0) AS mint_count,
  NOW() AS refreshed_at
FROM baskets b
JOIN LATERAL (
  SELECT nav, supply, share_price, ts FROM nav_snapshots WHERE basket = b.pubkey AND valuation_eligible AND valuation_status = 'complete' ORDER BY ts DESC LIMIT 1
) h ON true
LEFT JOIN LATERAL (
  SELECT supply, share_price FROM nav_snapshots
  WHERE basket = b.pubkey AND valuation_eligible AND valuation_status = 'complete'
    AND ts <= h.ts - interval '30 days'
    AND ts >= h.ts - interval '30 days' - interval '1 hour'
  ORDER BY ts DESC LIMIT 1
) first_day ON true
LEFT JOIN events e ON e.basket = b.pubkey
GROUP BY b.pubkey, b.creator, b.share_mint, h.nav, h.supply, h.share_price, h.ts,
         first_day.supply, first_day.share_price;

CREATE UNIQUE INDEX IF NOT EXISTS basket_rankings_pubkey_idx ON basket_rankings(pubkey);
CREATE INDEX IF NOT EXISTS basket_rankings_nav_idx ON basket_rankings(nav DESC);

COMMENT ON MATERIALIZED VIEW basket_rankings IS
  'Spec §7 rankings; refresh with REFRESH MATERIALIZED VIEW CONCURRENTLY basket_rankings (NAV worker, ~5m).';

-- Debug convenience view (kept from V0.1): latest NAV row per basket.
CREATE OR REPLACE VIEW basket_latest_nav AS
SELECT DISTINCT ON (basket) basket, nav, supply, share_price, ts
FROM nav_snapshots WHERE valuation_eligible AND valuation_status = 'complete' ORDER BY basket, ts DESC;

-- ---------------------------------------------------------------------------
-- V0.1 price-comparison support (providers / price & index snapshots)
-- Kept from the existing schema, made idempotent.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('xstock','price','index'))
);
INSERT INTO providers(id, name, type) VALUES
  ('backed',  'Backed Finance',     'xstock'),
  ('jupiter', 'Jupiter Price v6',   'price'),
  ('yahoo',   'Yahoo Finance',      'price'),
  ('nasdaq',  'Nasdaq Benchmark',   'index')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS price_snapshots (
  mint TEXT NOT NULL,
  ticker TEXT NOT NULL,
  provider TEXT NOT NULL REFERENCES providers(id),
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mint, provider, ts)
);
CREATE INDEX IF NOT EXISTS price_snapshots_ticker_provider_ts_idx ON price_snapshots(ticker, provider, ts DESC);
CREATE INDEX IF NOT EXISTS price_snapshots_ts_idx ON price_snapshots(ts DESC);

CREATE TABLE IF NOT EXISTS index_snapshots (
  symbol TEXT NOT NULL,
  price_usd NUMERIC NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS index_snapshots_symbol_ts_idx ON index_snapshots(symbol, ts DESC);

-- ---------------------------------------------------------------------------
-- V0.2 social trading layer — profiles, follows, thesis posts, equity curve.
-- Identity stays wallet-native: a profiles row is an OPTIONAL display layer
-- (handle/avatar/privacy) over a pubkey. Wallets without a row are treated
-- as public; is_public=false hides the wallet from the feed and leaderboard.
-- Social WRITES are the backend's only authenticated surface (ed25519 wallet
-- signature — api/auth.ts); the backend still never signs transactions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  wallet TEXT PRIMARY KEY,                -- Solana pubkey (base58)
  handle TEXT UNIQUE,                     -- 3-20 chars [a-z0-9_], null until claimed
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  followee TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (follower, followee),
  CHECK (follower <> followee)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows(followee);

-- Thesis posts — trade-linked reasoning (fomo-style: the "why" layer over the
-- verified on-chain "what"). kind is an allowlist so future post types are a
-- migration, not a surprise.
CREATE TABLE IF NOT EXISTS posts (
  id BIGSERIAL PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('thesis')),
  basket TEXT REFERENCES baskets(pubkey) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS posts_wallet_ts_idx ON posts(wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS posts_ts_idx ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_likes (
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, wallet)
);

CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES profiles(wallet) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS comments_post_idx ON comments(post_id, created_at);

-- Per-wallet equity curve, written by workers/userSnapshot.ts (~5m) from
-- user_positions × latest nav share_price. Feeds profile charts and the
-- windowed leaderboard. Same integer-safety rules as nav_snapshots.
CREATE TABLE IF NOT EXISTS user_value_snapshots (
  wallet TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  value_usd NUMERIC NOT NULL,
  cost_basis NUMERIC,
  PRIMARY KEY (wallet, ts)
);
ALTER TABLE user_value_snapshots ADD COLUMN IF NOT EXISTS valuation_eligible BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE user_value_snapshots ADD COLUMN IF NOT EXISTS valuation_status TEXT NOT NULL DEFAULT 'legacy-unverified';
CREATE INDEX IF NOT EXISTS user_value_snapshots_ts_idx ON user_value_snapshots(wallet, ts DESC);

-- Per-wallet trade history/feed lookups over the existing events ledger —
-- the indexer already attributes Minted/Redeemed to data->>'user'.
CREATE INDEX IF NOT EXISTS events_user_ts_idx ON events ((data->>'user'), ts DESC);

-- Non-destructive recovery evidence. Staging never replaces current positions
-- or clears legacy quarantine; activation requires separate operator review.
CREATE TABLE IF NOT EXISTS position_rebuild_runs (
  run_id TEXT PRIMARY KEY,
  basket TEXT NOT NULL REFERENCES baskets(pubkey),
  chain_slot BIGINT NOT NULL,
  chain_supply NUMERIC NOT NULL,
  event_count INT NOT NULL,
  history_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'staged-pending-review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS position_rebuild_staging (
  run_id TEXT NOT NULL REFERENCES position_rebuild_runs(run_id),
  "user" TEXT NOT NULL,
  basket TEXT NOT NULL,
  share_balance NUMERIC NOT NULL,
  cost_basis NUMERIC,
  cost_basis_source TEXT,
  PRIMARY KEY (run_id, "user", basket)
);
CREATE TABLE IF NOT EXISTS position_rebuild_claims (
  run_id TEXT NOT NULL REFERENCES position_rebuild_runs(run_id),
  sig TEXT NOT NULL,
  log_index INT NOT NULL,
  kind TEXT NOT NULL,
  basket TEXT NOT NULL,
  PRIMARY KEY (run_id, sig, log_index)
);

-- Finalized indexer discovery checkpoints and durable retry queue. Checkpoints
-- advance only after every discovered signature in the page has been enqueued.
CREATE TABLE IF NOT EXISTS indexer_program_state (
  program_id TEXT PRIMARY KEY,
  head_signature TEXT,
  scan_before TEXT,
  scan_until TEXT,
  scan_head TEXT,
  history_complete BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE indexer_program_state ADD COLUMN IF NOT EXISTS finalized_through_slot BIGINT CHECK(finalized_through_slot >= 0);
CREATE TABLE IF NOT EXISTS indexer_signature_queue (
  program_id TEXT NOT NULL,
  sig TEXT NOT NULL,
  slot BIGINT NOT NULL,
  block_time TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','quarantined')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (program_id, sig)
);
ALTER TABLE indexer_signature_queue ADD COLUMN IF NOT EXISTS tx_index INT CHECK(tx_index >= 0);
CREATE INDEX IF NOT EXISTS indexer_signature_queue_pending_global_idx
  ON indexer_signature_queue(slot, tx_index) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS indexer_signature_queue_pending_idx
  ON indexer_signature_queue(program_id, slot, discovered_at) WHERE status = 'pending';
-- Per-basket finalized projection barrier and immutable activation evidence.
CREATE TABLE IF NOT EXISTS position_reconciliation_state (
  basket TEXT PRIMARY KEY REFERENCES baskets(pubkey), snapshot_slot BIGINT NOT NULL CHECK(snapshot_slot>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE position_rebuild_runs ADD COLUMN IF NOT EXISTS program_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE position_rebuild_runs ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
ALTER TABLE position_rebuild_runs ADD COLUMN IF NOT EXISTS activated_slot BIGINT CHECK(activated_slot >= 0);
ALTER TABLE position_rebuild_required ADD COLUMN IF NOT EXISTS activated_run_id TEXT REFERENCES position_rebuild_runs(run_id);
CREATE TABLE IF NOT EXISTS position_rebuild_positions_backup (
  run_id TEXT NOT NULL REFERENCES position_rebuild_runs(run_id), "user" TEXT NOT NULL, basket TEXT NOT NULL,
  share_balance NUMERIC NOT NULL, cost_basis NUMERIC, cost_basis_source TEXT, position_updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(run_id,"user",basket)
);
CREATE TABLE IF NOT EXISTS position_rebuild_claims_backup (
  run_id TEXT NOT NULL REFERENCES position_rebuild_runs(run_id), sig TEXT NOT NULL, log_index INT NOT NULL,
  kind TEXT NOT NULL, basket TEXT, claimed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(run_id,sig,log_index)
);
ALTER TABLE position_rebuild_claims_backup ADD COLUMN IF NOT EXISTS slot BIGINT CHECK(slot >= 0);
CREATE OR REPLACE FUNCTION guard_position_backup_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM position_rebuild_runs WHERE run_id=NEW.run_id AND status='staged-pending-review' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Activated position recovery backup cannot grow';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS closed_position_backup_insert ON position_rebuild_positions_backup;
CREATE TRIGGER closed_position_backup_insert BEFORE INSERT ON position_rebuild_positions_backup
  FOR EACH ROW EXECUTE FUNCTION guard_position_backup_insert();
DROP TRIGGER IF EXISTS closed_claim_backup_insert ON position_rebuild_claims_backup;
CREATE TRIGGER closed_claim_backup_insert BEFORE INSERT ON position_rebuild_claims_backup
  FOR EACH ROW EXECUTE FUNCTION guard_position_backup_insert();
-- Evidence cannot change after staging; only one publication status transition is allowed.
CREATE OR REPLACE FUNCTION guard_position_rebuild_run_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.run_id,NEW.basket,NEW.chain_slot,NEW.chain_supply,NEW.event_count,NEW.history_hash,NEW.program_ids,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.run_id,OLD.basket,OLD.chain_slot,OLD.chain_supply,OLD.event_count,OLD.history_hash,OLD.program_ids,OLD.created_at) THEN
    RAISE EXCEPTION 'Position recovery evidence is immutable';
  END IF;
  IF OLD.status <> 'staged-pending-review' OR NEW.status <> 'activated' OR
     OLD.activated_at IS NOT NULL OR OLD.activated_slot IS NOT NULL OR
     NEW.activated_at IS NULL OR NEW.activated_slot IS NULL OR NEW.activated_slot < NEW.chain_slot THEN
    RAISE EXCEPTION 'Invalid position recovery activation transition';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS immutable_recovery_run_evidence ON position_rebuild_runs;
CREATE TRIGGER immutable_recovery_run_evidence BEFORE UPDATE ON position_rebuild_runs
  FOR EACH ROW EXECUTE FUNCTION guard_position_rebuild_run_update();
CREATE OR REPLACE FUNCTION reject_position_backup_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Position recovery backups are immutable'; END $$;
DROP TRIGGER IF EXISTS immutable_position_backup ON position_rebuild_positions_backup;
CREATE TRIGGER immutable_position_backup BEFORE UPDATE OR DELETE OR TRUNCATE ON position_rebuild_positions_backup
  FOR EACH STATEMENT EXECUTE FUNCTION reject_position_backup_mutation();
DROP TRIGGER IF EXISTS immutable_claim_backup ON position_rebuild_claims_backup;
CREATE TRIGGER immutable_claim_backup BEFORE UPDATE OR DELETE OR TRUNCATE ON position_rebuild_claims_backup
  FOR EACH STATEMENT EXECUTE FUNCTION reject_position_backup_mutation();
COMMIT;

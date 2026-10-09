#!/usr/bin/env bash
# VPS-local preparation only. This creates isolated evidence, never deploys it.
set +x
set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage: deploy/prepare-candidate.sh --source-sha=<40 lowercase hex> --candidate-id=<a-z0-9_> --directory=<absolute private path>

Run on the existing VPS source tree. The directory must be new, outside that
tree, and its existing parent must be owned by you and not group/world writable
(for example /var/backups/basalt/<candidate>). Docker must use a local Unix socket.
Uses deploy/.env and the current Compose services. Retains source/runtime config,
the running backend image, and an online custom-format foliox dump; restores only
a separate restricted candidate database. No stop, restart, live schema write,
publication, cleanup or automatic activation occurs. Partial material remains on
failure. Candidate evidence is not deployment approval. Never publish its files.
USAGE
}
die() { printf 'prepare-candidate: %s\n' "$1" >&2; exit 1; }

source_sha='' candidate_id='' candidate_dir=''
for arg in "$@"; do
  case "$arg" in
    --source-sha=*) [[ -z "$source_sha" ]] || die 'duplicate source SHA'; source_sha="${arg#*=}" ;;
    --candidate-id=*) [[ -z "$candidate_id" ]] || die 'duplicate candidate ID'; candidate_id="${arg#*=}" ;;
    --directory=*) [[ -z "$candidate_dir" ]] || die 'duplicate directory'; candidate_dir="${arg#*=}" ;;
    --help|-h) usage; exit 0 ;;
    *) die 'unknown argument; use --help' ;;
  esac
done
[[ "$source_sha" =~ ^[0-9a-f]{40}$ ]] || die 'source SHA must be 40 lowercase hex characters'
[[ "$candidate_id" =~ ^[a-z0-9_]{1,40}$ ]] || die 'candidate ID must be 1-40 lowercase letters, digits or underscores'
[[ "$candidate_dir" == /* && "$candidate_dir" != */ && ! "$candidate_dir" =~ [[:cntrl:]] ]] ||
  die 'directory must be an absolute path without trailing slash or control characters'
[[ ! -e "$candidate_dir" && ! -L "$candidate_dir" ]] || die 'candidate directory already exists'
for command in docker openssl tar gzip sha256sum stat date; do
  command -v "$command" >/dev/null || die "required tool unavailable: $command"
done

deploy_dir="$(pwd -P)"
[[ "${deploy_dir##*/}" == deploy ]] || die 'run from the existing source tree deploy directory'
project_root="$(cd -- "$deploy_dir/.." && pwd -P)"
parent_dir="$(dirname -- "$candidate_dir")"
[[ -d "$parent_dir" && "$(cd -- "$parent_dir" && pwd -P)" == "$parent_dir" ]] ||
  die 'directory parent must exist and contain no symlink or relative components'
[[ "$candidate_dir" != "$project_root" && "$candidate_dir" != "$project_root/"* ]] ||
  die 'backup directory must be outside the source tree'
parent_stat="$(stat -c '%a %u' "$parent_dir" 2>/dev/null || stat -f '%Lp %u' "$parent_dir")"
read -r parent_mode parent_owner <<< "$parent_stat"
[[ "$parent_mode" =~ ^[0-7]+$ && "$parent_owner" == "$EUID" ]] ||
  die 'directory parent must be owned by the current user'
(( (8#$parent_mode & 8#022) == 0 )) || die 'directory parent must not be group/world writable'
for file in "$deploy_dir/.env" "$deploy_dir/docker-compose.yml" "$project_root/backend/.env.production"; do
  [[ -f "$file" && ! -L "$file" ]] || die 'required current Compose/runtime file missing or symlinked'
done

mkdir -m 700 -- "$candidate_dir"
exec 3>&2 4>&1
exec >>"$candidate_dir/preparation.log" 2>&1
stage='local preflight'
trap 'status=$?; if (( status != 0 )); then printf "prepare-candidate: failed during %s; private material retained at %s\n" "$stage" "$candidate_dir" >&3; fi' EXIT
database_name="basalt_candidate_$candidate_id"
backup_file='foliox.dump'
genesis_hash='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
program_ids='{"basket":"6Q43vFh4aqGxzvtU2vQwJX9PmX3skfYsGWZdA3fwJB9k","factory":"3hzoPep9JKgTmzLT6CNW5x3EN7WNYDevM6KHVM7pLgMF","whitelist":"FRavMcYQb2FVAHbbG6fGieQHdKk1UrQqgKsAAXTPRQeS"}'
# Compose must resolve the retained deploy/.env, never inherited alternate files.
unset POSTGRES_PASSWORD API_DOMAIN DATABASE_URL CANDIDATE_DATABASE_URL
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES COMPOSE_DISABLE_ENV_FILE
unset DOCKER_HOST DOCKER_CONTEXT
cd -- "$deploy_dir"
docker_endpoint="$(docker context inspect --format '{{(index .Endpoints "docker").Host}}')"
[[ "$docker_endpoint" == unix://* ]] || die 'Docker endpoint must be a local Unix socket'
docker_local() { docker --host "$docker_endpoint" "$@"; }
compose() {
  docker_local compose --project-directory "$deploy_dir" --env-file "$deploy_dir/.env" -f "$deploy_dir/docker-compose.yml" "$@"
}
psql_admin() { compose exec -T postgres psql -X -w -U basalt -d "$1" -v ON_ERROR_STOP=1 -At; }

stage='read-only database preflight'
source_identity="$(psql_admin foliox <<'SQL'
-- basalt:source-identity
SELECT current_database() || '|' || current_user;
SQL
)"
[[ "$source_identity" == 'foliox|basalt' ]] || die 'unexpected source database or administrator'
already_exists="$(psql_admin postgres <<SQL
-- basalt:candidate-exists
SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$database_name')
    OR EXISTS (SELECT 1 FROM pg_database WHERE datname = '$database_name');
SQL
)"
[[ "$already_exists" == 'f' ]] || die 'candidate role or database already exists'

stage='rollback capture'
backend_container="$(compose ps --status running -q backend)"
[[ "$backend_container" =~ ^[a-f0-9]{12,64}$ ]] || die 'expected exactly one running backend container'
backend_image="$(docker_local inspect --format '{{.Image}}' "$backend_container")"
[[ "$backend_image" =~ ^sha256:[a-f0-9]{64}$ ]] || die 'running backend image identity unavailable'
printf '%s\n' "$backend_image" > "$candidate_dir/backend-image-id.txt"
docker_local image inspect "$backend_image" > "$candidate_dir/backend-image-inspect.json"
docker_local image save "$backend_image" | gzip > "$candidate_dir/backend-image.tar.gz"
gzip -t "$candidate_dir/backend-image.tar.gz"
cp -- "$deploy_dir/docker-compose.yml" "$candidate_dir/docker-compose.yml"
cp -- "$deploy_dir/.env" "$candidate_dir/compose.env"
cp -- "$project_root/backend/.env.production" "$candidate_dir/backend.env.production"
if [[ -f "$project_root/release-source-sha" && ! -L "$project_root/release-source-sha" ]]; then
  cp -- "$project_root/release-source-sha" "$candidate_dir/previous-release-source-sha"
fi
# Archive application sources only. Explicit runtime copies above retain the
# private configuration needed for rollback, without archiving unrelated key dirs.
source_entries=()
for entry in .dockerignore .gitignore package.json package-lock.json tsconfig.json backend deploy vendor scripts app docs programs crates Anchor.toml Cargo.toml Cargo.lock release-source-sha; do
  [[ ! -e "$project_root/$entry" ]] || source_entries+=("$entry")
done
tar -czf "$candidate_dir/source.tar.gz" -C "$project_root" \
  --exclude=node_modules --exclude=release-backups --exclude=.git --exclude=.cache \
  --exclude=cache --exclude=.next --exclude=target --exclude=.vercel --exclude=.aws \
  --exclude=.ssh --exclude=.solana --exclude=.config --exclude=keys --exclude=keypairs \
  --exclude=.agents --exclude=.codex --exclude=.e2e --exclude=.e2e-devnet \
  --exclude=.mimosa --exclude=.anchor --exclude=id.json --exclude=test-ledger --exclude='.env*' \
  --exclude='*.pem' --exclude='*.key' --exclude='*keypair*.json' --exclude='*.log' \
  "${source_entries[@]}"
tar -tzf "$candidate_dir/source.tar.gz" > "$candidate_dir/source.toc"

stage='consistent online backup'
snapshot_at="$(date -u +'%Y-%m-%dT%H:%M:%S.000Z')"
compose exec -T postgres pg_dump -w -U basalt -d foliox --format=custom \
  --no-owner --no-privileges --lock-wait-timeout=10s > "$candidate_dir/$backup_file"
[[ -s "$candidate_dir/$backup_file" ]] || die 'empty source dump'
compose exec -T postgres pg_restore --list < "$candidate_dir/$backup_file" > "$candidate_dir/backup.toc"
[[ -s "$candidate_dir/backup.toc" ]] || die 'empty backup table of contents'
grep -Eq '^[0-9]+; .* TABLE public baskets ' "$candidate_dir/backup.toc" ||
  die 'backup lacks the expected public baskets table'
backup_sha256="$(sha256sum "$candidate_dir/$backup_file")"
backup_sha256="${backup_sha256%% *}"
[[ "$backup_sha256" =~ ^[a-f0-9]{64}$ ]] || die 'invalid backup checksum'
(
  cd -- "$candidate_dir"
  sha256sum "$backup_file" source.tar.gz backend-image.tar.gz > SHA256SUMS
  sha256sum --check SHA256SUMS
)

stage='restricted candidate role'
candidate_password="$(openssl rand -hex 32)"
[[ "$candidate_password" =~ ^[a-f0-9]{64}$ ]] || die 'candidate password generation failed'
printf 'CANDIDATE_DATABASE_URL=postgresql://%s:%s@postgres:5432/%s\nRELEASE_SOURCE_SHA=%s\n' \
  "$database_name" "$candidate_password" "$database_name" "$source_sha" > "$candidate_dir/candidate.env"
psql_admin postgres <<SQL
-- basalt:create-role
CREATE ROLE "$database_name" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD '$candidate_password';
SQL
unset candidate_password
source_read_only="$(psql_admin foliox <<SQL
-- basalt:source-write-guard
SELECT NOT has_database_privilege('$database_name', current_database(), 'CREATE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND has_schema_privilege('$database_name', n.oid, 'CREATE'))
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND ((c.relkind IN ('r','p','v','m','f')
        AND has_table_privilege('$database_name', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
        OR (c.relkind = 'S' AND has_sequence_privilege('$database_name', c.oid, 'USAGE,UPDATE'))))
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
      AND p.prosecdef AND has_function_privilege('$database_name', p.oid, 'EXECUTE'));
SQL
)"
[[ "$source_read_only" == 't' ]] || die 'inherited PUBLIC privileges allow source writes; live ACLs were not changed'

stage='isolated candidate database'
psql_admin postgres <<SQL
-- basalt:create-database
CREATE DATABASE "$database_name" OWNER basalt TEMPLATE template0;
REVOKE ALL ON DATABASE "$database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE "$database_name" TO "$database_name";
SQL
candidate_setup="$(psql_admin "$database_name" <<SQL
-- basalt:candidate-schema
ALTER SCHEMA public OWNER TO basalt;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO "$database_name";
SELECT current_database();
SQL
)"
[[ "${candidate_setup##*$'\n'}" == "$database_name" ]] || die 'candidate database setup identity mismatch'
stage='restricted restore'
# Never use --create/--clean: the archive may name foliox. Restore only the new
# explicit database, as its restricted role, ignoring original ownership/ACLs.
compose exec -T postgres pg_restore -w -U basalt -d "$database_name" \
  --exit-on-error --no-owner --no-privileges --no-comments --single-transaction \
  --role="$database_name" < "$candidate_dir/$backup_file"
(
  cd -- "$candidate_dir"
  sha256sum --check SHA256SUMS
)

stage='candidate identity'
restored_owners="$(psql_admin "$database_name" <<SQL
-- basalt:restored-owners
SELECT current_database() = '$database_name'
  AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$database_name'
    AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
  AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f')
      AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = '$database_name'));
SQL
)"
[[ "$restored_owners" == 't' ]] || die 'restored object ownership or role restrictions mismatch'
psql_admin "$database_name" <<SQL
-- basalt:identity-create
BEGIN;
CREATE TABLE public.release_candidate_identity (
  candidate_id TEXT PRIMARY KEY,
  database_name TEXT NOT NULL,
  source_database TEXT NOT NULL CHECK (source_database = 'foliox'),
  source_sha TEXT NOT NULL,
  backup_sha256 TEXT NOT NULL,
  genesis_hash TEXT NOT NULL,
  program_ids JSONB NOT NULL,
  CHECK (database_name = '$database_name')
);
ALTER TABLE public.release_candidate_identity OWNER TO basalt;
REVOKE ALL ON public.release_candidate_identity FROM PUBLIC;
GRANT SELECT ON public.release_candidate_identity TO "$database_name";
INSERT INTO public.release_candidate_identity
  (candidate_id,database_name,source_database,source_sha,backup_sha256,genesis_hash,program_ids)
VALUES ('$candidate_id',current_database(),'foliox','$source_sha','$backup_sha256','$genesis_hash','$program_ids'::jsonb);
COMMIT;
SQL
identity_verified="$(psql_admin "$database_name" <<SQL
-- basalt:identity-verify
SELECT current_database() = '$database_name'
  AND (SELECT COUNT(*) FROM public.release_candidate_identity) = 1
  AND (SELECT relowner = (SELECT oid FROM pg_roles WHERE rolname = 'basalt')
       FROM pg_class WHERE oid = 'public.release_candidate_identity'::regclass)
  AND has_table_privilege('$database_name','public.release_candidate_identity','SELECT')
  AND NOT has_table_privilege('$database_name','public.release_candidate_identity',
    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');
SQL
)"
[[ "$identity_verified" == 't' ]] || die 'candidate identity ownership or grants mismatch'
psql_admin "$database_name" <<SQL > "$candidate_dir/candidate.json"
-- basalt:manifest
SELECT json_build_object(
  'schemaVersion',1,'candidateId',candidate_id,'databaseName',current_database(),
  'sourceDatabase',source_database,'sourceSha',source_sha,'backupSha256',backup_sha256,
  'programIds',program_ids,'genesisHash',genesis_hash,
  'snapshotAt','$snapshot_at','backupFile','$backup_file')
FROM public.release_candidate_identity;
SQL
[[ -s "$candidate_dir/candidate.json" ]] || die 'candidate manifest missing'
chmod 600 "$candidate_dir"/*
printf 'Candidate prepared at %s; evidence only, not deployment approval. Private backups and credentials remain local.\n' \
  "$candidate_dir/candidate.json" >&4

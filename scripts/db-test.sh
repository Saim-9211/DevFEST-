#!/usr/bin/env bash
# Applies migrations + seed to a scratch Postgres database and runs the RLS test suite.
# Uses a plain PostgreSQL server (no Docker needed). Configure with:
#   PGHOST (default localhost), PGPORT (default 54329), PGUSER (default postgres), TEST_DB (default bb_test)
set -euo pipefail
cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
DB="${TEST_DB:-bb_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f supabase/tests/local_shim.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d "$DB" -f "$f"; done
"${PSQL[@]}" -d "$DB" -f supabase/seed.sql
"${PSQL[@]}" -d "$DB" -f supabase/tests/rls_test.sql

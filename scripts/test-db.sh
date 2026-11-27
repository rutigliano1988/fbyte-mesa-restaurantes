#!/usr/bin/env bash
# PostgreSQL 16 local para pruebas. Uso: scripts/test-db.sh start|reset|stop
# En CI se define PG_TEST_URL y PG_TEST_ADMIN_URL y no se arranca nada.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DIR="${PG_TEST_DIR:-/var/tmp/mesa-pgtest}"
PORT="${PG_TEST_PORT:-54329}"
DB=mesa_test
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob

run_pg() {
  # postgres no arranca como root
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

start() {
  if [ -n "${PG_TEST_URL:-}" ]; then return 0; fi
  if [ ! -d "$DIR/data" ]; then
    mkdir -p "$DIR"
    if [ "$(id -u)" = "0" ]; then chown postgres "$DIR"; fi
    run_pg "$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
  fi
  if ! run_pg "$PGBIN/pg_ctl" -D "$DIR/data" status >/dev/null 2>&1; then
    run_pg "$PGBIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR" -l "$DIR/log" -w start >/dev/null
  fi
}

db_url() { echo "${PG_TEST_URL:-postgresql://postgres@127.0.0.1:$PORT/$DB}"; }
admin_url() { echo "${PG_TEST_ADMIN_URL:-postgresql://postgres@127.0.0.1:$PORT/postgres}"; }

# La base de pruebas, en UTF-8 como en Supabase (initdb sin locale la dejaría en SQL_ASCII).
reset() {
  start
  psql "$(admin_url)" -q -v ON_ERROR_STOP=1 \
    -c "drop database if exists $DB with (force)" \
    -c "create database $DB template template0 encoding 'UTF8' locale 'C'"
  psql "$(db_url)" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/auth_shim.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql "$(db_url)" -q -v ON_ERROR_STOP=1 -f "$f"
  done
}

stop() {
  if [ -n "${PG_TEST_URL:-}" ]; then return 0; fi
  run_pg "$PGBIN/pg_ctl" -D "$DIR/data" stop >/dev/null 2>&1 || true
}

case "${1:-}" in
  start) start ;;
  reset) reset ;;
  stop) stop ;;
  *) echo "uso: $0 start|reset|stop" >&2; exit 1 ;;
esac

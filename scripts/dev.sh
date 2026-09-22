#!/usr/bin/env bash
#
# Run SoulLog locally: the Django API on :8000 and the Vite app on :5173,
# in one terminal. Ctrl+C stops both.
#
#   ./scripts/dev.sh
#
# Run ./scripts/setup-mac.sh once first.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

[ -x "$ROOT/backend/venv/bin/python" ] || {
  echo "Backend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || {
  echo "Frontend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }

# Postgres may have stopped since setup (a reboot does it).
if command -v brew >/dev/null 2>&1; then
  PG_BIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"
  if [ -x "$PG_BIN/pg_isready" ] && ! "$PG_BIN/pg_isready" -q -h localhost; then
    echo "Starting Postgres..."
    brew services start postgresql@16 >/dev/null
    sleep 2
  fi
fi

cleanup() {
  echo
  echo "Stopping..."
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(
  cd "$ROOT/backend"
  # shellcheck disable=SC1091
  source venv/bin/activate
  python manage.py migrate --noinput >/dev/null
  # Give existing accounts any badges they've already earned (safe to repeat).
  python manage.py award_badges >/dev/null 2>&1 || true
  exec python manage.py runserver 127.0.0.1:8000 2>&1 | awk '{ print "[api] " $0; fflush() }'
) &

(
  cd "$ROOT/frontend"
  exec npm run dev -- --host 127.0.0.1 --port 5173 2>&1 | awk '{ print "[web] " $0; fflush() }'
) &

echo
echo "  API  → http://localhost:8000/api/v1/"
echo "  App  → http://localhost:5173"
echo "  Demo login: sarah.demo / SoulLogDemo!2024   (Ctrl+C to stop)"
echo

wait

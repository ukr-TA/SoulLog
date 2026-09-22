#!/usr/bin/env bash
#
# Run SoulLog so a phone on the same Wi-Fi can open it — iPhone or Android.
#
#   ./scripts/dev-phone.sh
#
# Same as ./scripts/dev.sh, except the API and the app listen on your Wi-Fi
# address instead of only on this Mac, and the app is pointed at the API by
# that address (on a phone, "localhost" would mean the phone itself).
#
# Development only: anyone on the same Wi-Fi network can reach it while it
# runs. Use it at home, not on public Wi-Fi.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

[ -x "$ROOT/backend/venv/bin/python" ] || {
  echo "Backend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || {
  echo "Frontend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }

# This Mac's address on the Wi-Fi (en0), or on Ethernet (en1) as a fallback.
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$IP" ]; then
  echo "Couldn't find this Mac's Wi-Fi address. Is Wi-Fi on?"
  exit 1
fi

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

APP="http://$IP:5173"

(
  cd "$ROOT/backend"
  # shellcheck disable=SC1091
  source venv/bin/activate
  # These override backend/.env for this run only.
  export ALLOWED_HOSTS="localhost,127.0.0.1,$IP"
  export CORS_ALLOWED_ORIGINS="http://localhost:5173,http://127.0.0.1:5173,$APP"
  export CSRF_TRUSTED_ORIGINS="$CORS_ALLOWED_ORIGINS"
  export FRONTEND_BASE_URL="$APP"
  python manage.py migrate --noinput >/dev/null
  python manage.py award_badges >/dev/null 2>&1 || true
  exec python manage.py runserver 0.0.0.0:8000 2>&1 | awk '{ print "[api] " $0; fflush() }'
) &

(
  cd "$ROOT/frontend"
  # Overrides frontend/.env for this run only.
  export VITE_API_BASE_URL="http://$IP:8000/api/v1"
  exec npm run dev -- --host 0.0.0.0 --port 5173 2>&1 | awk '{ print "[web] " $0; fflush() }'
) &

echo
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "    On your phone (same Wi-Fi), open:   $APP"
echo "  └──────────────────────────────────────────────────────────┘"
echo "  On this Mac it's still http://localhost:5173 as well."
echo "  If macOS asks whether to allow incoming connections, choose Allow."
echo "  Demo login: sarah.demo / SoulLogDemo!2024   (Ctrl+C to stop)"
echo

wait

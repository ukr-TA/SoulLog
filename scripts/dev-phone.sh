#!/usr/bin/env bash
#
# Run SoulLog so you can open it on your phone — iPhone or Android.
#
#   ./scripts/dev-phone.sh
#
# Gives you two addresses:
#
#   1. A temporary https://….trycloudflare.com address (a free Cloudflare
#      tunnel, no account needed). It works from any network — any Wi-Fi,
#      or mobile data — because it doesn't depend on your router letting
#      the phone talk to this Mac. Scan the QR code or type it in.
#   2. This Mac's Wi-Fi address, for home networks that allow it.
#
# Everything goes through one address: the Vite dev server serves the app
# and forwards /api, /media and the WebSockets to Django (vite.config.ts).
#
# Development only. While this runs, anyone who has the tunnel address can
# open your local SoulLog, so stop it (Ctrl+C) when you're done. The
# address changes every time you start it.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

[ -x "$ROOT/backend/venv/bin/python" ] || {
  echo "Backend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }
[ -d "$ROOT/frontend/node_modules" ] || {
  echo "Frontend isn't set up yet — run ./scripts/setup-mac.sh first."; exit 1; }

# cloudflared makes the tunnel. Installed once, via Homebrew.
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared (one time only)..."
  brew install cloudflared
fi

# A small helper that draws a QR code in the terminal (one time only).
"$ROOT/backend/venv/bin/python" -c "import qrcode" 2>/dev/null \
  || "$ROOT/backend/venv/bin/python" -m pip install -q qrcode >/dev/null 2>&1 || true

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

# Postgres may have stopped since setup (a reboot does it).
if command -v brew >/dev/null 2>&1; then
  PG_BIN="$(brew --prefix postgresql@16 2>/dev/null)/bin"
  if [ -x "$PG_BIN/pg_isready" ] && ! "$PG_BIN/pg_isready" -q -h localhost; then
    echo "Starting Postgres..."
    brew services start postgresql@16 >/dev/null
    sleep 2
  fi
fi

TUNNEL_LOG="$(mktemp -t soullog-tunnel)"
cleanup() {
  echo
  echo "Stopping..."
  rm -f "$TUNNEL_LOG"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

(
  cd "$ROOT/backend"
  # shellcheck disable=SC1091
  source venv/bin/activate
  # For this run only (they override backend/.env): accept requests that
  # arrive through the Wi-Fi address or the tunnel, and trust the tunnel's
  # "this was https" header so links Django builds are https too.
  export ALLOWED_HOSTS="localhost,127.0.0.1${IP:+,$IP},.trycloudflare.com"
  export TRUST_X_FORWARDED_PROTO=1
  python manage.py migrate --noinput >/dev/null
  python manage.py award_badges >/dev/null 2>&1 || true
  exec python manage.py runserver 127.0.0.1:8000 2>&1 | awk '{ print "[api] " $0; fflush() }'
) &

(
  cd "$ROOT/frontend"
  # For this run only: talk to the API through this same address.
  export VITE_API_BASE_URL="/api/v1"
  exec npm run dev -- --host 0.0.0.0 --port 5173 2>&1 | awk '{ print "[web] " $0; fflush() }'
) &

cloudflared tunnel --no-autoupdate --url http://localhost:5173 >"$TUNNEL_LOG" 2>&1 &

# Wait for the tunnel address (usually a few seconds).
URL=""
for _ in $(seq 1 40); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done

# A brand-new tunnel address takes a little while to go live. A phone
# that opens it too early gets "site can't be reached" — and then keeps
# remembering that for several minutes. So only show the address once it
# actually answers here.
if [ -n "$URL" ]; then
  echo "Waiting for the phone address to go live..."
  READY=""
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 5 "$URL"; then READY=1; break; fi
    sleep 2
  done
  [ -z "$READY" ] && echo "  (It isn't answering yet — give it another minute before opening it.)"
fi

echo
echo "  ┌──────────────────────────────────────────────────────────────┐"
if [ -n "$URL" ]; then
  echo "    On your phone, open (any Wi-Fi or mobile data):"
  echo "      $URL"
else
  echo "    The tunnel didn't start (no internet?). Try the Wi-Fi address."
fi
[ -n "$IP" ] && echo "    Same Wi-Fi only:  http://$IP:5173"
echo "  └──────────────────────────────────────────────────────────────┘"
if [ -n "$URL" ]; then
  echo "  Or scan this with your phone's camera:"
  "$ROOT/backend/venv/bin/python" - "$URL" <<'PY' 2>/dev/null || true
import sys, qrcode
qr = qrcode.QRCode(border=1)
qr.add_data(sys.argv[1])
qr.print_ascii(invert=True)
PY
fi
echo "  Sign in or create an account.   (Ctrl+C to stop)"
echo "  The tunnel address is public while this runs and changes each time."
echo

wait

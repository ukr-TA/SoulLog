#!/usr/bin/env bash
#
# One-time local setup for SoulLog on macOS.
#
#   ./scripts/setup-mac.sh
#
# Safe to run more than once: every step checks before it acts, so a
# second run skips what's already done and repairs what isn't.
#
# What it does:
#   1. Checks for Homebrew, and installs Python 3.12, Node, and
#      PostgreSQL 16 through it if they're missing.
#   2. Starts Postgres and creates the `soullog` user and database.
#   3. Creates the backend virtualenv, installs requirements, writes
#      backend/.env (only if there isn't one), migrates, and seeds demo data.
#   4. Installs the frontend's packages and writes frontend/.env.
#
# Redis is deliberately not installed: local development uses Channels'
# in-memory layer, so live messages and notifications work without it.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"

DB_NAME="soullog_dev"
DB_USER="soullog"
DB_PASSWORD="soullog_dev_password"

bold()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()    { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn()  { printf "  \033[33m!\033[0m %s\n" "$*"; }
fail()  { printf "\n  \033[31m✗ %s\033[0m\n\n" "$*"; exit 1; }

# --- 1. Tools ----------------------------------------------------------------
bold "1/4  Checking tools"

if ! command -v brew >/dev/null 2>&1; then
  fail "Homebrew isn't installed. Install it from https://brew.sh (one command), then run this script again."
fi
ok "Homebrew"

brew_install() {
  local formula="$1"
  if brew list --formula "$formula" >/dev/null 2>&1; then
    ok "$formula already installed"
  else
    echo "  installing $formula…"
    brew install "$formula"
    ok "$formula installed"
  fi
}

brew_install python@3.12
brew_install node
brew_install postgresql@16

PY="$(brew --prefix python@3.12)/bin/python3.12"
PG_BIN="$(brew --prefix postgresql@16)/bin"
export PATH="$PG_BIN:$PATH"

"$PY" --version >/dev/null || fail "Python 3.12 didn't install correctly."
ok "$("$PY" --version)"
ok "node $(node --version)"

# --- 2. Postgres -------------------------------------------------------------
bold "2/4  PostgreSQL"

if ! pg_isready -q -h localhost; then
  brew services start postgresql@16 >/dev/null
  for _ in $(seq 1 20); do
    pg_isready -q -h localhost && break
    sleep 0.5
  done
fi
pg_isready -q -h localhost || fail "Postgres didn't start. Try: brew services restart postgresql@16"
ok "running"

if psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1; then
  ok "user $DB_USER exists"
else
  psql -h localhost -d postgres -qc "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD' CREATEDB;"
  ok "created user $DB_USER"
fi

if psql -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  ok "database $DB_NAME exists"
else
  psql -h localhost -d postgres -qc "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  ok "created database $DB_NAME"
fi

# --- 3. Backend --------------------------------------------------------------
bold "3/4  Backend"
cd "$BACKEND"

if [ ! -x venv/bin/python ]; then
  "$PY" -m venv venv
  ok "created virtualenv"
fi
# shellcheck disable=SC1091
source venv/bin/activate
pip install -q --upgrade pip
pip install -q -r requirements.txt
ok "requirements installed"

if [ ! -f .env ]; then
  SECRET="$(python -c 'import secrets; print(secrets.token_urlsafe(64))')"
  sed -e "s|^SECRET_KEY=.*|SECRET_KEY=$SECRET|" \
      -e "s|^DB_PASSWORD=.*|DB_PASSWORD=$DB_PASSWORD|" \
      .env.example > .env
  ok "wrote backend/.env"
else
  ok "backend/.env already exists (left as is)"
fi

python manage.py migrate --noinput >/dev/null
ok "database migrated"

# Demo data only once: a populated app is far easier to look at, but
# re-seeding on every run would be surprising.
if python manage.py shell -c "from users.models import User; import sys; sys.exit(0 if User.objects.filter(username='sarah.demo').exists() else 1)" 2>/dev/null; then
  ok "demo data already present"
else
  python manage.py seed_demo >/dev/null
  ok "seeded demo data"
fi
deactivate

# --- 4. Frontend -------------------------------------------------------------
bold "4/4  Frontend"
cd "$FRONTEND"
npm install --silent
ok "packages installed"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "wrote frontend/.env"
else
  ok "frontend/.env already exists (left as is)"
fi

bold "Done."
cat <<'MSG'
  Start the app with:

      ./scripts/dev.sh

  Then open http://localhost:5173 and sign in with any demo account,
  e.g.  sarah.demo  /  SoulLogDemo!2024
MSG

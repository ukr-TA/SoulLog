# SoulLog — Setup

## Quickest: macOS, two commands

```bash
./scripts/setup-mac.sh   # once — installs what's missing, creates the DB, seeds demo data
./scripts/dev.sh         # every time — API on :8000 and the app on :5173, Ctrl+C stops both
```

Then open <http://localhost:5173> and sign in as `sarah.demo` /
`SoulLogDemo!2024`. The setup script needs [Homebrew](https://brew.sh)
and is safe to re-run: each step checks before it acts.

The rest of this document is the same thing done by hand, and the Docker
route.

---

Two other ways to run it. Docker is fewer steps; the manual path is better
for day-to-day development because you get hot reload on both halves.

---

## Option A — Docker (everything at once)

```bash
docker compose up --build
```

That brings up Postgres, Redis, the backend (migrated and collected) and
the built frontend. When it settles:

* Frontend — <http://localhost:5173>
* API — <http://localhost:8000/api/v1/>
* Health — <http://localhost:8000/healthz>

To seed demo data once it's running:

```bash
docker compose exec backend python manage.py seed_demo
```

To stop, and to start over from an empty database:

```bash
docker compose down            # stop
docker compose down -v         # stop and delete the database and uploads
```

The compose file uses development defaults for every secret. A real
deployment supplies its own, and puts TLS in front.

---

## Option B — Local (hot reload)

### Prerequisites

- Python 3.11+ (built and tested on 3.11 and 3.12)
- Node.js 20+ (built and tested on v22) with npm
- PostgreSQL 16 (or any recent Postgres)
- Redis — **optional**, see step 2

```bash
python3 --version
node --version
npm --version
psql --version
```

### 1. PostgreSQL

Start Postgres (the exact command depends on your install — Homebrew on
macOS is usually `brew services start postgresql@16`). Then:

```bash
psql postgres -c "CREATE USER soullog WITH PASSWORD 'soullog_dev_password';"
psql postgres -c "CREATE DATABASE soullog_dev OWNER soullog;"
psql postgres -c "ALTER USER soullog CREATEDB;"
```

The `CREATEDB` grant is what lets the test runner create its own test
database.

### 2. Redis — optional, and here's when you need it

**You do not need Redis for local development.** With `REDIS_URL` unset,
Channels uses its in-memory layer, and WebSockets — live messages, typing
indicators, live notifications — all work in a single `runserver`
process.

Redis becomes **required** the moment the backend runs more than one
worker process, which is every real deployment: without it, a message
delivered by one worker never reaches a socket held by another, and the
failure is silent. If you want to develop against the same setup
production uses, start Redis and put this in `backend/.env`:

```
REDIS_URL=redis://127.0.0.1:6379/0
```

### 3. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env
# Edit .env: set SECRET_KEY to a random value, and confirm the DB_*
# values match what you created in step 1. Generate a key with:
#   python -c "import secrets; print(secrets.token_urlsafe(64))"

python manage.py migrate
python manage.py createsuperuser   # optional, for /admin/

python manage.py runserver
```

The API is now at `http://localhost:8000/api/v1/`.

`runserver` serves ASGI here, not WSGI — Daphne is first in
`INSTALLED_APPS` — so WebSockets work in development exactly as they do
in production. You do not need a second process for them.

### 4. Frontend

In a second terminal:

```bash
cd frontend
npm install

cp .env.example .env
# VITE_API_BASE_URL should already point at http://localhost:8000/api/v1

npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

---

## Seeing it with data

A brand new account is genuinely empty — no suggested people, no feed, no
insights — which is correct, and not much to look at. To get a populated
app:

```bash
cd backend
python manage.py seed_demo
```

Six accounts (`sarah.demo`, `michael.demo`, `lisa.demo`, `emma.demo`,
`david.demo`, `maya.demo`), all with the password `SoulLogDemo!2024`, and
between them journal entries, mood check-ins, connections, posts,
comments, reactions, library items and conversations spread over the last
six weeks.

```bash
python manage.py audit_demo_data   # report what's demo, and prove it's consistent
python manage.py clear_demo        # remove all of it — and only it
```

`audit_demo_data` exits non-zero if it finds anything wrong, so it can
gate a deploy. It's worth running before any showcase, and before pushing
to production.

---

## Verifying it actually works end-to-end

1. Sign up a new account, then log in.
2. You'll land on the profile form (it appears for anyone whose profile
   isn't filled in). Complete it or skip it.
3. Write a journal entry. Press **Photo** or **Voice** in the composer
   and attach something — the browser will ask for microphone permission
   for a voice note.
4. Refresh. The entry and its attachment are still there, which confirms
   it's really in the database rather than in component state.
5. Do a mood check-in.
6. Visit **Insights**. With one entry you'll see empty states saying
   there isn't enough to work from yet — that's correct behaviour, not a
   bug.
7. Open **Community → Souls**. With demo data seeded you'll see real
   suggestions, each with a reason that is true. Send a connection
   request from one account and accept it from another.
8. Open **Whispers** in two browsers signed in as two different demo
   accounts and send a message. It should appear on the other side
   without a refresh, and you should see the typing indicator while the
   other side types.
9. Like a post as one user; the bell badge should update for the other
   without a refresh.

Step 8 and 9 are the ones worth doing: they're the parts that depend on
the WebSocket layer, and they're where a misconfiguration shows up.

---

## Tests

```bash
cd backend
python manage.py test           # 221 tests
python manage.py test messaging # includes the real WebSocket tests
```

The WebSocket tests use `TransactionTestCase` and are slower than the
rest; that's expected. They run against the in-memory channel layer,
which is the same path a developer without Redis uses.

Frontend:

```bash
cd frontend
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm run build
```

`npm run lint` reports warnings and should report no errors. The warnings
are almost all `no-explicit-any` in the original UI code — see the note
in `eslint.config.js` for why that rule warns rather than fails.

---

## Building for mobile (Capacitor)

```bash
cd frontend
npm run build
npx cap sync
```

Opening or running on a device or simulator needs Android Studio or
Xcode. **Not verified in this environment** — no mobile SDKs available.
One thing to check when you do: voice recording uses `MediaRecorder`,
which both WebViews support, but microphone access on a device also needs
the platform permission declared in the native project
(`NSMicrophoneUsageDescription` on iOS, `RECORD_AUDIO` on Android).

---

## Deploying

The pieces are in place: Dockerfiles for both halves, Gunicorn with
Uvicorn workers for ASGI, WhiteNoise for static files, and security
headers, HSTS and secure cookies that switch on automatically when
`DEBUG=False`. The app refuses to start with `DEBUG=False` and the
default `SECRET_KEY`.

Before going live:

```bash
cd backend
DEBUG=False SECRET_KEY=<real> ALLOWED_HOSTS=<your-domain> \
  python manage.py check --deploy --fail-level WARNING
```

Then: set `REDIS_URL` (required with more than one worker), set
`USE_S3=True` with bucket credentials so uploads don't live on an
ephemeral container disk, set `EMAIL_HOST` so password resets actually
send, set `SENTRY_DSN` if you want error tracking, and run migrations as
a release step rather than on every worker's startup.

---

## Troubleshooting

**`django.db.utils.OperationalError: could not connect to server`**
Postgres isn't running, or `DB_HOST`/`DB_PORT` in `.env` don't match.
Confirm with `psql -h localhost -U soullog -d soullog_dev`.

**`relation "..." does not exist`**
Migrations haven't been applied. Run `python manage.py migrate`.

**CORS errors in the browser console**
`CORS_ALLOWED_ORIGINS` in `backend/.env` must include the exact origin
Vite is serving on — check the port Vite printed.

**Frontend shows data but nothing persists after refresh**
Check the Network tab. If requests are going to the wrong host or port,
fix `VITE_API_BASE_URL` in `frontend/.env` and restart `npm run dev`
(Vite only reads `.env` at startup).

**401 errors immediately after logging in**
The access token may have a very short lifetime if you changed
`SIMPLE_JWT` in `config/settings.py`. The default is 60 minutes. Note
that a single 401 is no longer fatal — the frontend attempts a token
refresh first and only signs you out if that also fails.

**Messages don't arrive live, but do appear after a refresh**
The WebSocket isn't connecting. Check the browser console for the socket
URL: it's derived from `VITE_API_BASE_URL`, so a wrong API URL breaks
both. If you're running several backend workers, `REDIS_URL` must be set
— this is the exact failure that happens without it.

**WebSocket handshake fails with "Origin header invalid" or 403**
`AllowedHostsOriginValidator` checks the socket's origin against
`ALLOWED_HOSTS`. Add the host your frontend is served from.

**Voice recording does nothing**
Browsers only allow microphone access on `https://` or `localhost`. If
you're testing over a LAN IP, it will be blocked — this is the browser,
not the app.

**`manage.py test` fails to create the test database**
The `soullog` user needs `CREATEDB` — see step 1.

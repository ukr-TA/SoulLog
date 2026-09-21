# SoulLog — Architecture

This document describes the system as it actually exists, verified
end-to-end and covered by 178 automated tests. Where something is
deferred or deliberately not built, that's stated explicitly — see
`docs/NOT-BUILT-OR-DEFERRED.md` for the full inventory.

## High-level shape

```
React + TypeScript + Vite (frontend/)
        │
        │  fetch() with JWT bearer tokens        ── history, writes, everything durable
        │  WebSocket with the same JWT           ── live messages, typing, notifications
        ▼
Django + DRF + Channels, served over ASGI (backend/)
        │
        ├── PostgreSQL          the source of truth
        └── Redis (optional)    the channel layer, only for cross-process delivery
```

No microservices, no message queue, no cache layer. Per spec §115 ("do
not overengineer"), one Django project talking to one Postgres database
is the right amount of architecture for this product.

Redis is the one addition, and it earns its place narrowly: it carries
WebSocket events between worker processes and nothing else. No data lives
there. With `REDIS_URL` unset the in-memory channel layer is used, which
is correct for a single development process and means `manage.py
runserver` needs no extra infrastructure. Consumers cannot tell the
difference.

## Backend apps

- **`users`** — custom `User` model, `UserProfile` (bio, location,
  visibility settings, interests), `UserSettings` (preference groups).
  Auth (JWT via `djangorestframework-simplejwt`), password reset,
  change-password, account deletion, data export, the Settings API and
  the profile API. Also `presence.py` (deriving "active now" from
  `last_seen`), `public.py` (the one public-user shape every social
  screen consumes) and `ws_auth.py` (JWT for WebSocket handshakes).
- **`journal`** — `JournalEntry`, `JournalMedia` (photos and voice
  notes), `JournalComment` (one level of replies),
  `JournalCommentReaction`, `JournalEntryReaction` (hearts on shared
  entries). Owner-scoped CRUD, soft delete, visibility enforcement,
  share settings, dashboard stats, and a paginated list whose search,
  mood filter and sort run in SQL rather than in the client.
- **`moods`** — `MoodCheckIn`. The mood vocabulary is the exact 12 values
  `MoodCheckin.tsx` offers.
- **`insights`** — no models. `engine.py` holds pluggable analyzer
  functions reading real journal/mood data.
- **`social`** — `Connection` (one row per pair) and `Follow` (one-way).
  `relations.py` answers every relationship question the rest of the app
  asks.
- **`notifications`** — `Notification`, with creation, storage and
  delivery separated (spec §89).
- **`messaging`** — `Conversation`, `ConversationParticipant`, `Message`,
  `MessageAttachment`, plus the consumer for live delivery.
- **`sanctuary`** — `SanctuaryPost`, `PostMedia`, `PostComment`,
  `PostReaction`, `PostBookmark`, `PostShare`.
- **`content`** — `Content` and its categories, views, reactions, saves,
  shares and comments.
- **`community`** — `SearchQuery` and `Topic`. Discovery, not a second
  feed (see below).
- **`achievements`** — `Badge` and `UserBadge`. Badges are rows, awarded
  once from real activity and never removed, so one bad week cannot take
  back a streak someone actually completed. `services.py` holds one
  function per metric and an idempotent `check_and_award`.
- **`core`** — not a Django app. `uploads.py`, the single upload pipeline
  every media feature goes through, and `editing.py`, the shared rules
  for correcting something you wrote (author only, visibly, with a
  window) so that "edit" means the same thing in all four places the app
  lets you write text.

## Decisions worth knowing about

### One post model, not two

The deferred-work inventory listed "Sanctuary" and "Community" as
separate subsystems each needing their own post, comment, reaction and
bookmark models. Reading the actual frontend showed Community is not a
second feed: `Community.tsx` is a tab container whose three tabs are
Sanctuary (the feed), Souls (connections) and Videos (the library).

Building a second, near-identical post table to satisfy the inventory
would have meant two places to fix every future privacy bug for no
user-visible difference. So there is one post model, in `sanctuary`, and
the `community` app does discovery across posts, people and content
instead.

### One row per connection pair

`Connection` has a `requester` and an `addressee`, not two directed rows.
Two rows can disagree with each other; one row cannot disagree with
itself. A database constraint enforces one row per pair in either
direction, so a simultaneous "A adds B" and "B adds A" cannot produce two
competing requests — the second is treated as accepting the first. The
cost is that queries need the `involving()` / `between()` helpers rather
than a naive filter, and that cost is paid in one module.

Following is a separate model on purpose. A connection is mutual and
gates access to `visibility='connections'` content; a follow is one-way,
needs no consent, and only affects a feed. Merging them would mean
someone could see connections-only content by following.

### Conversations have participants, not two user columns

Whispers is one-to-one today and modelled as N participants anyway. That
isn't speculative generality — it's the one place where retrofitting is
genuinely expensive: a `user_a`/`user_b` table cannot become a group chat
without rewriting every query, index and read-state record. A participant
table costs one join now and nothing later.

Read state lives on the participant row as a single `last_read_at`
timestamp, not a per-message read table. Unread counts are then one
indexed COUNT rather than a row per message per person.

### Notification delivery is separable

    notify()   decide → store          synchronous, in-request
    deliver()  store  → open socket    best-effort
    <future>   store  → APNs / FCM     a new function; nothing else changes

Every one of the ~15 call sites calls `notify()` and nothing else. Adding
mobile push later is adding one function, not touching any call site. The
database row is the truth and the socket push is an optimisation on top,
so a Redis failure costs latency, never a notification.

### Settings as JSON, profile fields as columns

`UserSettings.notifications/journaling/social/appearance` are each a
single `JSONField`. These are preference flags with no query needs of
their own; normalising them into ~25 boolean columns would be schema
churn for no benefit (spec §115).

Profile fields and visibility settings *do* get dedicated columns,
because they drive enforced behaviour that must be queried and joined
against: journal visibility, comment permission, message permission,
mentor availability. The same test applies to the journal share settings
— `identity`, `include_mood`, `include_date` and `allow_comments` are
columns because each one changes what an endpoint does.

## Privacy enforcement — the rule that matters most

A private `JournalEntry` is invisible to anyone but its owner. This is
enforced in `get_queryset()` on every journal view — not in a serializer
field, not in the frontend, not as an afterthought. A user guessing
another user's entry ID gets a `404`, not a `403`; the response doesn't
even confirm the entry exists.

Three things extend that rule now that there is a social layer:

**`connections` visibility is real.** It used to behave identically to
`community`, because no connection model existed to check against — a gap
that was documented rather than hidden. It now requires an *accepted*
connection. Following is explicitly not enough, because following needs
no consent and consent is the entire point of the setting.

**Blocking is symmetric in effect.** Whoever pressed the button, the two
stop seeing each other's content and stop being able to message or
connect, in every feed and every search. Only the blocker can undo it.

**Search reuses the feeds' own querysets.** `community/views.py` calls
`sanctuary.views.visible_posts()` and `content.views.library_queryset()`
rather than writing its own filters. A search index that outlives a
privacy change is a real failure mode in social products; reusing the
live queryset avoids it structurally rather than by discipline.

The same shape is used everywhere: a conversation you aren't in is a 404,
a private profile is a 404, a post you can't see is a 404.

## Uploads

Every upload in the product — journal photos and voice notes, Sanctuary
media, message attachments, library media, avatars and covers — goes
through `core/uploads.py`. One module means a limit or an allowed type
changes in one place, and, more importantly, that no feature can skip
validation by writing its own half-version of it.

What is checked, and why: size, because a client-side check is a
convenience and not a control; extension, cheaply, first; **content**,
because the browser-supplied Content-Type is attacker-controlled — images
are verified by actually opening them with Pillow, audio and video by
their file signature; and the filename is discarded entirely and replaced
with a random one, which removes path traversal, overwriting someone
else's file, and filenames that leak personal information.

Files are written through Django's configured default storage, so local
disk and S3 are the same code path.

## Authentication

JWT access + refresh tokens. `Signin.tsx`/`Signup.tsx` were built first
against a specific response shape (`{access_token, refresh_token,
token_type, expires_in}`); rather than rewrite working frontend code,
`SoulLogTokenObtainSerializer` reshapes simplejwt's default response to
match. Access tokens expire in 60 minutes, refresh in 14 days, with
rotation enabled.

WebSocket handshakes carry the same access token as a query parameter,
because a browser cannot set an `Authorization` header on a handshake.
The token is validated by the same simplejwt machinery, not a parallel
weaker path.

## Frontend → backend wiring

Every API call goes through `src/api.ts`. Before it existed, each screen
repeated the same block — read the token, build a header, check
`response.ok`, and on a 401 clear storage and reload. With a dozen
screens that becomes a dozen places to fix the same bug and a dozen
slightly different ideas of what a 401 means.

Three things it adds beyond tidiness: a 401 now attempts a token refresh
before ending the session, so a user who left the app open for an hour
isn't silently signed out mid-sentence; concurrent 401s share one
in-flight refresh, because the backend rotates refresh tokens and ten
simultaneous attempts would mean nine failures; and errors carry the
status and parsed body, so forms can show the field errors DRF returned.

`openSocket()` derives its URL from the API base URL — one environment
variable rather than two that can drift apart — reconnects with
exponential backoff, and deliberately stops retrying on 4401 and 4403,
which are answers rather than outages.

## Real-time, and what happens without it

REST carries history and writes; the socket carries live delivery,
typing and read receipts. Each does what it is good at: doing both over
REST means polling, and doing both over the socket means a client with a
dropped connection can't read its own message history.

If the socket never connects, the app still works. Messages arrive when
the thread is reopened, and a slow poll keeps the conversation list and
notification badge current. That is a degradation, not a breakage — which
is the property that makes it safe to depend on Redis in production
without Redis becoming a single point of failure for the whole product.

## Insight Engine

Each analyzer is a plain function `(user, now) -> list[dict]`;
`run_insight_engine()` calls each and concatenates. No class hierarchy:
there's no shared state or polymorphism to justify one (spec §115).
Adding an analyzer means adding a function and registering it.

The rule every analyzer follows is that silence is a valid output. An
analyzer that can't say something true from the data says nothing. That
restraint is the only reason a user should believe the cards that do
appear — and it is why an even spread of writing times produces no "time
pattern" card, and why two of the six originally-fabricated insight
categories are still absent rather than approximated.

Insights are computed per request rather than stored. At current data
volumes this is fast and always current; the extension point for caching
is documented in `engine.py`.

## What is deliberately NOT here

See `docs/NOT-BUILT-OR-DEFERRED.md` — voice and video calling, sleep and
weather insights, payments, and full groups, each with the reasoning and,
where the decision has since been revisited, the plan.

## Reciprocity as a privacy pattern

Profile views are worth singling out, because the shape generalises.

The feature is "see who viewed your profile", and the usual version of it
records everyone and shows the list only to people who pay. SoulLog's
version records a view only when *both* people have the setting on. Turn
it off and nothing is recorded in either direction: nobody is told you
looked at them, and nobody who looks at you is recorded either.

Two things follow from that, and both are deliberate. The rule is
enforced on **write**, in `users/profile_views_service.py`, not on read —
so a user with the setting off has no rows about them to leak, rather
than rows that are merely hidden. And rows expire: `ProfileView` keeps 30
days, pruned by `manage.py prune_profile_views`.

Anywhere else this product is tempted to record what one user does to
another, this is the shape to reach for first.

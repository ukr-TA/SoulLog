# SoulLog — API Reference

Base URL: `http://localhost:8000/api/v1/`

All endpoints except registration, login, token refresh and password
reset require `Authorization: Bearer <access_token>`.

Two conventions hold throughout, and they are worth stating once:

* **404, not 403, for anything you aren't entitled to see.** A private
  journal entry, a conversation you're not in, a private profile — all
  return 404. A 403 would confirm the thing exists, which is itself
  information the owner didn't share. 403 is used only where existence is
  already known to the caller (commenting on an entry whose author turned
  comments off, for example).
* **Empty is a real answer.** Feeds, insights, suggestions and search all
  return empty rather than padding with something plausible.

---

## Auth — `/api/v1/auth/`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `register` | No | `{fullname, username, email, password}` → 201, or 400 with field errors |
| POST | `login` | No | `{username, password}` → `{access_token, refresh_token, token_type, expires_in}` |
| POST | `refresh` | No | `{refresh}` → `{access}` |
| GET | `me` | Yes | Current user's safe fields (no password hash) |
| POST | `password-reset/request/` | No | `{username}` → always the same generic response, real or fake username (spec §13 — no account enumeration) |
| POST | `password-reset/confirm/` | No | `{uid, token, new_password}` → resets password; token is single-use |
| POST | `change-password/` | Yes | `{current_password, new_password}` |
| DELETE | `account/` | Yes | `{password}` → deletes the account; cascades to all owned data |
| GET | `export/` | Yes | The user's own journal entries + mood check-ins as JSON |

## Journal — `/api/v1/journal/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `?limit=&offset=&q=&mood=&sort=newest\|oldest\|mood` | Yes | The caller's own, non-deleted entries: `{entries, total, offset, limit, hasMore}`. Search, mood filter and sort are applied in SQL over the whole journal, not over the page |
| POST | `` | Yes | Create. `visibility` defaults to `private` |
| GET/PATCH/DELETE | `<id>/` | Yes | Owner-only. Others get 404. DELETE is a soft delete |
| GET | `stats/` | Yes | `{total_entries, shared_entries, likes_received, current_streak_days, insights_gained, community_posts, mood_checkins}`. `likes_received` excludes your own hearts |
| GET | `shared/` | Yes | Entries others have shared with you — community from anyone, connections from your connections. Honours `identity`, `include_mood`, `include_date` |
| GET/POST | `<id>/media/` | Yes | Photo and voice attachments. Owner only. Multipart `file`, optional `duration_seconds`, `caption` |
| DELETE | `<id>/media/<pk>/` | Yes | Removes the row *and* the stored file |
| GET/POST | `<id>/comments/` | Yes | Private: owner only. Connections: accepted connections only. Community: any signed-in user. 403 if the author turned comments off |
| PATCH/DELETE | `<id>/comments/<pk>/` | Yes | Your own comment only. PATCH sets `editedAt`; author-only, 7-day window — see `core/editing.py` |
| POST | `<id>/comments/<pk>/react/` | Yes | Toggles your heart on a comment |
| POST | `<id>/react/` | Yes | Toggles your heart on a shared entry. An entry you can't see gives 404, not 403 |

Share settings on an entry — `identity` (`username`/`anonymous`),
`include_mood`, `include_date`, `allow_comments` — are enforced, not just
stored. An anonymous entry's author id is absent from the payload
entirely rather than returned with a request not to render it.

## Mood — `/api/v1/mood/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET/POST | `` | Yes | Check-ins, scoped to the caller. `mood` must be one of the 12 real frontend values |

## Insights — `/api/v1/insights/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `` | Yes | Real per-user insights, computed live. `[]` for a user with no data — never fabricated cards |
| GET | `summary/?days=30` | Yes | `{moodDistribution, timePatterns, commonThemes}` — the three panels that used to be hardcoded. Any of them can be empty |

## Settings — `/api/v1/settings/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `` | Yes | `{profile, privacy, notifications, journaling, social, appearance}` |
| PATCH | `` | Yes | Partial update of any group. `email` is intentionally not updatable here |

## Profiles — `/api/v1/profile/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `` | Yes | Your own profile, with stats and `onboardingCompleted` |
| PATCH | `` | Yes | Update. JSON or multipart (`profile_image`, `cover_image`). Accepts camelCase or snake_case. Replacing an image deletes the old file |
| DELETE | `image/?field=avatar\|cover` | Yes | Remove an image and its stored file |
| GET | `mentors/` | Yes | Everyone who switched on "available to mentor" |
| GET | `<username>/` | Yes | Someone else's. Private → 404. Connections-only and not connected → identity only, `restricted: true` |
| GET | `<username>/posts/` | Yes | Their posts, through the feed's own visibility queryset |
| GET | `views/` | Yes | Who viewed your profile: `{enabled, count, retentionDays, viewers}`. Empty with `enabled: false` when the setting is off, because with it off nothing is recorded |
| GET | `achievements/` | Yes | Your earned badges and the next few within reach |

Contact details are absent from the payload unless the user set
`show_email` / `show_phone` — not blank, absent, so a client can't render
an empty row implying something is being withheld.

**Profile views are reciprocal.** Viewing `<username>/` records a view
only when *both* parties have `show_profile_views` on. Turning the setting
off means nobody is told you looked at them and nobody who looks at you is
recorded — see and be seen, or neither. Views are deduplicated per viewer
per day and pruned after 30 days
(`manage.py prune_profile_views`).

**Achievements** are rows, not a computation. A badge is awarded once,
carries the date it was earned, and is never taken away — so a 100-day
streak you completed does not disappear the first day you miss.

## Connections — `/api/v1/social/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `connections/` | Yes | Accepted connections, most recently active first |
| DELETE | `connections/<user_id>/` | Yes | Remove a connection or withdraw a request |
| GET | `requests/?direction=incoming\|outgoing` | Yes | Pending requests |
| POST | `requests/create/` | Yes | `{user_id}` or `{username}`. Requesting someone who already requested you accepts theirs |
| POST | `requests/<pk>/respond/` | Yes | `{action: accept\|decline}` — addressee only |
| POST/DELETE | `block/<user_id>/` | Yes | Block / unblock. Only the blocker can unblock. Blocking drops any connection and follows in both directions |
| GET | `blocked/` | Yes | Everyone you've blocked |
| POST/DELETE | `follow/<user_id>/` | Yes | One-way follow |
| GET | `suggestions/?location=&interests=&activity=&mutualFriends=&q=` | Yes | Ranked by mutual connections, shared interests, same location, recent activity, mentor availability. Each result carries the single factor that contributed most as `reason` — and that reason is true |
| GET | `search/?q=` | Yes | People search. Needs 2+ characters. Excludes private profiles and blocked users |

## Whispers — `/api/v1/messages/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `conversations/?q=` | Yes | Your conversations with unread counts and real presence |
| POST | `conversations/` | Yes | `{user_id}` or `{username}` — opens or reuses the direct thread. 403 if their `allowMessages` refuses |
| GET | `conversations/<pk>/` | Yes | Header + messages, and marks the thread read |
| DELETE | `conversations/<pk>/` | Yes | Leave. History survives for the other participant |
| POST | `conversations/<pk>/messages/` | Yes | `{body}`, or multipart with `files`. Permission is rechecked on every send |
| PATCH/DELETE | `conversations/<pk>/messages/<id>/` | Yes | Your own message only. PATCH sets `edited_at` and pushes an `edited` frame down the conversation socket; refused on a deleted message or one carrying only an attachment |
| POST | `conversations/<pk>/read/` | Yes | Mark read |
| POST | `conversations/<pk>/mute/` | Yes | `{muted}` |
| GET | `recipients/?q=` | Yes | Who you can start a conversation with — filtered by their settings, so you can't compose a message that will be refused |
| GET | `unread/` | Yes | Total unread, for the nav badge |

## Sanctuary — `/api/v1/sanctuary/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `posts/?scope=all\|connections\|mine\|bookmarked&tag=&q=&limit=&offset=` | Yes | The feed |
| POST | `posts/` | Yes | `{content, tags, visibility}`, or multipart with `media` (up to 4) |
| GET/DELETE | `posts/<pk>/` | Yes | Detail with comments; delete is author-only and soft |
| GET/POST | `posts/<pk>/comments/` | Yes | Comments, one level of replies |
| PATCH/DELETE | `posts/<pk>/comments/<id>/` | Yes | DELETE: comment author or post author. PATCH: comment author only — a post owner may remove a comment, never rewrite it |
| POST | `posts/<pk>/like/` | Yes | Toggles |
| POST | `comments/<id>/like/` | Yes | Toggles |
| POST | `posts/<pk>/bookmark/` | Yes | Toggles. Private — the author is never told |
| POST | `posts/<pk>/share/` | Yes | Records a share |
| POST | `share-entry/` | Yes | `{entry_id}` — shares a journal entry that is already non-private. Refuses a private entry |
| GET | `tags/` | Yes | Tags really in use, counted |

A post created from a journal entry disappears from the feed if that entry
is later made private or deleted. Un-sharing really un-shares.

## Content library — `/api/v1/content/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `` | Yes | `?category=&q=&scope=all\|saved\|mine\|continue&limit=&offset=` |
| POST | `` | Yes | Upload a file, link an external URL, or write an article |
| GET/DELETE | `<pk>/` | Yes | Detail; delete is author-only |
| POST | `<pk>/progress/` | Yes | `{seconds, completed}`. Counts a view once per person, not per play |
| POST | `<pk>/like/` `<pk>/save/` `<pk>/share/` | Yes | Toggles / records |
| GET/POST | `<pk>/comments/` | Yes | Flat comments |
| PATCH/DELETE | `<pk>/comments/<id>/` | Yes | DELETE: comment author or content author. PATCH: comment author only |
| GET | `categories/` | Yes | Categories with real item counts |

## Community — `/api/v1/community/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `search/?q=&scope=all\|people\|posts\|videos\|articles` | Yes | Across people, posts and library content, reusing each subsystem's own visibility queryset so search can't surface what a feed would hide |
| GET | `search/suggestions/` | Yes | `{recent, trending}` — your own history, and terms searched by at least 3 distinct people in 14 days |
| DELETE | `search/suggestions/` | Yes | Clear your search history |
| GET | `topics/` | Yes | Topics with real follower counts |
| POST | `topics/<slug>/follow/` | Yes | Toggles |

## Notifications — `/api/v1/notifications/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `?filter=all\|unread\|engagement\|social\|community\|insights\|achievements&limit=` | Yes | `{notifications, counts}` — both at once, because the screen renders both |
| POST | `<pk>/read/` | Yes | Mark one read |
| POST | `read-all/` | Yes | Mark all read |
| DELETE | `<pk>/` | Yes | Dismiss |
| DELETE | `clear/` | Yes | Clear all |
| GET | `unread-count/` | Yes | Just the number, for cheap polling |

Notifications are only ever created by real actions, never across a block,
never for your own action, and never against the recipient's own
notification settings.

## WebSockets

| Path | Description |
|---|---|
| `ws/notifications/?token=<access>` | Live notifications for the signed-in user, across all their devices |
| `ws/conversations/<id>/?token=<access>` | Live messages, typing indicators and read receipts |

The access token travels as a query parameter because a browser can't set
an `Authorization` header on a handshake; it is validated by the same
simplejwt code the REST layer uses.

Close codes: **4401** the token is invalid or missing, **4403** you aren't
a participant. Both are delivered by accepting the socket and then closing
with the code — a refused handshake reaches a browser as a bare 1006,
indistinguishable from a dropped connection, and the client would retry
forever.

Sending a message over the socket goes through exactly the same
permission checks as the HTTP endpoint. There is no looser path here.

## Operations

| Path | Description |
|---|---|
| `/healthz` | Unauthenticated liveness probe. Checks the database; 503 when it's unreachable |
| `/admin/` | Django admin. Journal content, message bodies, notification bodies and search terms are deliberately excluded from list views (spec §81, least privilege) |

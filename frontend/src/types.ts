/**
 * The shapes the API actually returns.
 *
 * These were `any` everywhere, which is how the app ended up with a
 * Journal screen sorting on `entry.date` and `entry.time` — fields this
 * API has never sent. Every comparison was against `undefined`, so the
 * sort control did nothing at all, silently, for as long as the screen
 * has existed. `any` does not make that kind of mistake impossible to
 * make; it makes it impossible to find.
 *
 * Two conventions worth knowing before reading further:
 *
 *   Field names are the server's. The API sends camelCase for newer
 *   payloads and snake_case for the ones that were shaped around
 *   Django's serializers early on. Renaming them here would mean a
 *   translation layer for its own sake, so the types say what the wire
 *   says, mixed casing and all.
 *
 *   Optional means optional. A field marked `?` is one the server may
 *   legitimately omit, not one nobody got round to checking.
 */

/* --- people -------------------------------------------------------------- */

/**
 * `PublicUser` already lives in `api.ts`, beside the calls that return
 * it, and is re-exported here so a screen can import its types from one
 * place.
 */
export type { PublicUser } from './api';
import type { PublicUser } from './api';

export interface ProfileStats {
  entries?: number;
  posts?: number;
  followers?: number;
  following?: number;
  connections?: number;
  /** Hearts received from other people. Never your own. */
  reactionsReceived?: number;
  /** Own profile only, and only when profile views are switched on. */
  profileViews?: number;
  bestStreak?: number;
}

/** A badge the user has earned. Earned badges are never taken away. */
export interface Achievement {
  slug: string;
  name: string;
  icon: string;
  description: string;
  /** Human-readable month and year, e.g. "March 2026". */
  earned: string;
  earnedAt: string;
  value: number;
}

/** The next badge within reach for one metric. */
export interface AchievementProgress {
  slug: string;
  name: string;
  icon: string;
  description: string;
  current: number;
  threshold: number;
  percent: number;
}

/**
 * `GET /profile/` — the viewer's own profile.
 *
 * Extends `Partial<PublicUser>` rather than `PublicUser`: this endpoint
 * and the public one overlap but neither sends every field of the other,
 * and claiming otherwise would just move the lie from `any` into a type.
 */
export interface MyProfile extends Partial<PublicUser> {
  id: number;
  username: string;
  name: string;
  email?: string;
  phone?: string | null;
  bio?: string;
  tagline?: string;
  location?: string;
  website?: string;
  joined?: string;
  interests?: string[];
  current_focus?: string;
  growth_areas?: string;
  values?: string;
  avatar_url?: string | null;
  coverUrl?: string | null;
  onboardingCompleted?: boolean;
  showEmail?: boolean;
  showPhone?: boolean;
  showProfileViews?: boolean;
  stats?: ProfileStats;
  achievements?: Achievement[];
  achievementProgress?: AchievementProgress[];
}

/** `GET /profile/<username>/` — someone else's. */
export interface PublicProfile extends Partial<PublicUser> {
  id: number;
  username: string;
  name: string;
  bio?: string;
  tagline?: string;
  location?: string;
  joined?: string;
  interests?: string[];
  stats?: ProfileStats;
  achievements?: Achievement[];
  mutual_connections?: number;
  /** True when their privacy settings hide most of this. */
  restricted?: boolean;
}

/** One row of `GET /profile/views/`. */
export interface ProfileViewer extends Partial<PublicUser> {
  id: number;
  username: string;
  name: string;
  lastSeenAt?: string;
}

/* --- journal ------------------------------------------------------------- */

export interface JournalMedia {
  id: number;
  url: string;
  kind: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds?: number | null;
  caption?: string;
}

export interface JournalEntry {
  id: number;
  title: string;
  content: string;
  entry_type: 'text' | 'voice' | 'photo' | string;
  mood: string;
  tags: string[];
  visibility: 'private' | 'connections' | 'community' | string;
  prompt_used?: string;
  word_count?: number;
  identity?: string;
  include_mood?: boolean;
  include_date?: boolean;
  allow_comments?: boolean;
  media?: JournalMedia[];
  /** Derived from `visibility`: anything not private. */
  shared?: boolean;
  likes?: number;
  liked?: boolean;
  comments?: number;
  created_at: string;
  updated_at?: string;
}

/**
 * `GET /journal/` — a page, not the whole journal.
 *
 * The bare array this used to be is why the Journal screen searched only
 * the entries it happened to be holding.
 */
export interface Paginated<T> {
  entries: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

/** `GET /journal/stats/` — the Journal and Dashboard tiles. */
export interface JournalStats {
  total_entries: number;
  shared_entries: number;
  likes_received: number;
  current_streak_days: number;
  insights_gained: number;
  community_posts: number;
  mood_checkins: number;
}

/** A comment on a journal entry. */
export interface JournalComment {
  id: number;
  author: string;
  avatar: string;
  time: string;
  content: string;
  hearts: number;
  reacted: boolean;
  parent?: number | null;
  replies?: JournalComment[];
  /** Set once it has been edited. The UI shows "(edited)". */
  editedAt?: string | null;
  isOwn?: boolean;
}

/* --- moods and insights -------------------------------------------------- */

export interface MoodCheckIn {
  id: number;
  mood: string;
  intensity?: number;
  note?: string;
  triggers?: string[];
  created_at: string;
}

export interface Insight {
  id?: string;
  kind?: string;
  title: string;
  body?: string;
  detail?: string;
  confidence?: string;
}

/* --- notifications ------------------------------------------------------- */

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body?: string;
  read: boolean;
  createdAt: string;
  timestamp?: string;
  actor?: PublicUser | null;
  targetLabel?: string;
  targetUrl?: string | null;
}

/* --- library ------------------------------------------------------------- */

export interface LibraryComment {
  id: number;
  author: string;
  avatar: string;
  content: string;
  timestamp: string;
  editedAt?: string | null;
  isOwn?: boolean;
}

/* --- shared UI props ----------------------------------------------------- */

export type { Theme } from './theme';

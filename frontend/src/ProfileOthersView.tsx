/**
 * Someone else's profile.
 *
 * Like the onboarding form, this component was built and then never
 * reachable — nothing imported it. It rendered one invented person,
 * "Emma Rodriguez", with 4,521 followers and 542 entries, and its
 * buttons were `alert()` and `prompt()` calls: following someone popped
 * up "You are now following Emma Rodriguez!", and "Block User" popped up
 * "User blocked successfully" without blocking anyone.
 *
 * It now shows a real person, loaded by username, and the buttons do
 * what they say. Follow follows. Message opens a real conversation.
 * Block blocks — and asks first, because it isn't reversible by the
 * person on the receiving end.
 *
 * Visibility is respected: a profile set to "connections only" that you
 * aren't connected to shows its name and nothing else, and a private one
 * isn't reachable at all.
 */

import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Calendar, MessageCircle, Heart, Share2, Award, BookOpen, Target, TrendingUp, Sparkles, Phone, Mail, User, MoreHorizontal, UserPlus, UserCheck, UserX, Clock, BellPlus, BellRing, Ban, ArrowLeft, ChevronRight } from 'lucide-react';
import { ApiError, del, get, post } from './api';
import { profileShare, shareOrCopy } from './links';
import { buildTheme } from './theme';
import type { Theme } from './theme';
import type { Achievement, PublicProfile } from './types';

interface OthersProfileProps {
  theme?: Partial<Theme>;
  darkMode?: boolean;
  /** Whose profile to show. */
  username?: string;
  onBack?: () => void;
  onOpenConversation?: (conversationId: number) => void;
  /** Open one of their posts in the Sanctuary, comments open. */
  onOpenPost?: (postId: number) => void;
}

/**
 * `GET /profile/<username>/` as this screen reads it.
 *
 * `PublicProfile` plus the handful of fields this endpoint also sends and
 * the shared type doesn't list. They're declared here rather than added
 * to `types.ts` so the shared type keeps saying only what every caller
 * can rely on.
 */
type ViewedProfile = PublicProfile & {
  email?: string;
  phone?: string;
  current_focus?: string;
  growth_areas?: string;
  values?: string;
  cover_url?: string | null;
};

/** A post's first line, when the post has more than one; otherwise nothing. */
function postHeading(content: string): string {
  const [first, ...rest] = content.trim().split('\n');
  return rest.join('').trim() ? first.slice(0, 80) : '';
}

/** One row of `GET /profile/<username>/posts/`, narrowed to what's read here. */
interface ProfilePostRow {
  id: number;
  content?: string;
  timestamp?: string;
  tags?: string[];
  likes: number;
  comments: number;
  liked?: boolean;
  /** Only ever tested for presence, to pick an emoji. */
  media?: unknown;
}

interface ProfilePostsResponse {
  posts?: ProfilePostRow[];
}

/** A post as this screen displays it. */
interface TopJournal {
  id: number;
  title: string;
  excerpt: string;
  date?: string;
  emoji: string;
  tags: string[];
  interactions: { reactions: number; comments: number };
  isHighlighted: boolean;
  liked?: boolean;
}

/** Everything this screen holds about the person it is showing. */
interface ViewedUser {
  id: number;
  name: string;
  username: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  joinDate: string;
  followers: number;
  following: number;
  about: string;
  currentFocus: string;
  growthAreas: string;
  values: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  stats: { totalEntries: number; totalReactions: number };
  topJournals: TopJournal[];
  favoriteTopics: string[];
  achievements: Achievement[];
  mutualConnections: number;
  isOnline: boolean;
  lastActive: string;
  restricted: boolean;
  relationship: { state: string; direction: string | null; connection_id: number | null };
}

interface ProfileCardProps {
  children: React.ReactNode;
  className?: string;
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

const EMPTY: ViewedUser = {
  id: 0,
  name: '',
  username: '',
  title: '',
  email: '',
  phone: '',
  location: '',
  joinDate: '',
  followers: 0,
  following: 0,
  about: '',
  currentFocus: '',
  growthAreas: '',
  values: '',
  avatarUrl: null,
  coverUrl: null,
  stats: { totalEntries: 0, totalReactions: 0 },
  topJournals: [],
  favoriteTopics: [],
  achievements: [],
  mutualConnections: 0,
  isOnline: false,
  lastActive: '',
  restricted: false,
  relationship: { state: 'none', direction: null, connection_id: null },
};

const SoulLogOthersProfile = ({ theme: themeProp, darkMode: darkModeProp, username, onBack, onOpenConversation, onOpenPost }: OthersProfileProps) => {
  const [darkMode] = useState(darkModeProp ?? true);
  const [isFollowing, setIsFollowing] = useState(false);
  // The ⋯ menu (remove friend, block), closed by a tap anywhere else.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: Event) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  // The photo URL that failed to load, so the initial shows instead.
  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  const [userData, setUserData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reactions, setReactions] = useState<Record<number, { liked: boolean; count: number }>>({});

  const load = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    try {
      const profile = await get<ViewedProfile>(`/profile/${encodeURIComponent(username)}/`);

      // A restricted profile returns identity only — there are no posts
      // to ask for, and asking would just be a 200 with an empty list.
      const posts: ProfilePostsResponse = profile.restricted
        ? { posts: [] }
        : await get<ProfilePostsResponse>(`/profile/${encodeURIComponent(username)}/posts/?limit=50`).catch(
            (): ProfilePostsResponse => ({ posts: [] }),
          );

      setIsFollowing(Boolean(profile.is_following));
      setUserData({
        id: profile.id,
        name: profile.name,
        username: profile.username,
        title: profile.tagline || profile.current_focus || '',
        email: profile.email || '',
        phone: profile.phone || '',
        location: profile.location || '',
        joinDate: profile.joined
          ? new Date(profile.joined).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
          : '',
        followers: profile.stats?.followers || 0,
        following: profile.stats?.following || 0,
        about: profile.bio || '',
        currentFocus: profile.current_focus || '',
        growthAreas: profile.growth_areas || '',
        values: profile.values || '',
        avatarUrl: profile.avatar_url || null,
        coverUrl: profile.cover_url || null,
        // Only what this viewer is entitled to know about them: the
        // entries and posts they've shared. A streak is private, and
        // "mentoring sessions" was a number nothing in SoulLog records.
        stats: {
          totalEntries: profile.stats?.entries || 0,
          // Hearts this person has received, not posts they've written —
          // the tile below says 'Reactions' and now means it.
          totalReactions: profile.stats?.reactionsReceived || 0,
        },
        // All the posts loaded, not four: "View All Posts" reveals the rest.
        topJournals: (posts.posts || []).map((row): TopJournal => ({
          id: row.id,
          // Posts have no title. The card used to print the first 60
          // characters as a heading and then the same text again below it.
          // The first line is the heading only when there's more after it.
          title: postHeading(row.content || ''),
          excerpt: (row.content || '').slice(0, 200),
          date: row.timestamp,
          emoji: row.media ? '🖼️' : '📝',
          tags: row.tags || [],
          interactions: { reactions: row.likes, comments: row.comments },
          isHighlighted: false,
          liked: row.liked,
        })),
        favoriteTopics: profile.interests || [],
        // Badges this person has actually earned, with the date. Empty
        // is a perfectly good answer, and is what a new account shows —
        // this screen used to invent three for everyone.
        achievements: profile.achievements || [],
        mutualConnections: profile.mutual_connections || 0,
        isOnline: profile.presence === 'active',
        lastActive: profile.presence_label || '',
        restricted: Boolean(profile.restricted),
        relationship: profile.relationship || EMPTY.relationship,
      });

      const seeded: Record<number, { liked: boolean; count: number }> = {};
      for (const row of posts.posts || []) {
        seeded[row.id] = { liked: Boolean(row.liked), count: row.likes };
      }
      setReactions(seeded);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "That profile isn't available."
          : 'Could not load that profile.',
      );
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    load();
  }, [load]);

  const handleFollowToggle = async () => {
    const next = !isFollowing;
    setIsFollowing(next);
    try {
      if (next) await post(`/social/follow/${userData.id}/`);
      else await del(`/social/follow/${userData.id}/`);
      setUserData((current) => ({
        ...current,
        followers: current.followers + (next ? 1 : -1),
      }));
    } catch (err) {
      setIsFollowing(!next);
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  const handleConnect = async () => {
    try {
      await post('/social/requests/create/', { user_id: userData.id });
      setNotice('Connection request sent.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that request.');
    }
  };

  // Removing a connection is asked twice, inline: the first tap turns the
  // button into "Tap again to remove". A browser confirm() box would do
  // the same job less gracefully.
  const [confirmRemove, setConfirmRemove] = useState(false);

  /** Withdraw a request you sent, or remove an existing connection. */
  const handleRemoveConnection = async (kind: 'withdraw' | 'remove') => {
    if (kind === 'remove' && !confirmRemove) {
      setConfirmRemove(true);
      window.setTimeout(() => setConfirmRemove(false), 4000);
      return;
    }
    try {
      await del(`/social/connections/${userData.id}/`);
      setConfirmRemove(false);
      setNotice(kind === 'withdraw' ? 'Request withdrawn.' : 'Connection removed.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  /** Answer a request this person sent you. */
  const handleRespond = async (action: 'accept' | 'decline') => {
    const connectionId = userData.relationship.connection_id;
    if (!connectionId) return;
    try {
      await post(`/social/requests/${connectionId}/respond/`, { action });
      setNotice(action === 'accept' ? `You're now connected with ${userData.name}.` : 'Request declined.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  const handleSendMessage = async () => {
    try {
      const conversation = await post<{ id: number }>('/messages/conversations/', {
        user_id: userData.id,
      });
      onOpenConversation?.(conversation.id);
    } catch (err) {
      // The refusal message here comes from the backend and deliberately
      // doesn't distinguish "blocked you" from "accepts nobody".
      setError(err instanceof ApiError ? err.message : 'Could not open a conversation.');
    }
  };

  const handleShareProfile = async () => {
    const result = await shareOrCopy(profileShare(userData.username, userData.name));
    if (result === 'copied') setNotice('Profile link copied — anyone who opens it lands on this profile.');
    else if (result === 'failed') setNotice(`Share @${userData.username} so people can find them on SoulLog.`);
  };

  const handleBlock = async () => {
    // Confirmed, because blocking removes the connection and any follows
    // in both directions, and the other person cannot undo it.
    const confirmed = window.confirm(
      `Block ${userData.name}? You'll stop seeing each other's posts and messages, and any connection between you will be removed.`,
    );
    if (!confirmed) return;

    try {
      await post(`/social/block/${userData.id}/`);
      setNotice(`${userData.name} is blocked.`);
      onBack?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not block that person.');
    }
  };

  const handleReaction = async (postId: number) => {
    const current = reactions[postId] || { liked: false, count: 0 };
    setReactions((rows) => ({
      ...rows,
      [postId]: { liked: !current.liked, count: current.count + (current.liked ? -1 : 1) },
    }));
    try {
      const result = await post<{ liked: boolean; likes: number }>(
        `/sanctuary/posts/${postId}/like/`,
      );
      setReactions((rows) => ({ ...rows, [postId]: { liked: result.liked, count: result.likes } }));
    } catch {
      setReactions((rows) => ({ ...rows, [postId]: current }));
    }
  };

  // "View All Posts" used to announce that all posts were shown below —
  // while four were. It now shows the rest, and can collapse them again.
  const [showAllPosts, setShowAllPosts] = useState(false);
  const handleViewAllPosts = () => setShowAllPosts((all) => !all);

  const handleSharePost = async (journalId: number) => {
    const url = `${window.location.origin}/#/sanctuary/${journalId}`;
    try {
      await post(`/sanctuary/posts/${journalId}/share/`);
      if (navigator.clipboard) await navigator.clipboard.writeText(url).catch(() => {});
      setNotice('Link copied.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not share that.');
    }
  };

  const handleContactClick = (type: string, value: string) => {
    if (type === 'email') window.location.href = `mailto:${value}`;
    else if (type === 'phone') window.location.href = `tel:${value}`;
  };

  // The app supplies a theme; the fallback keeps this component usable on
  // its own, which is how it was originally written.
  const theme: Theme = { ...buildTheme(darkMode), ...(themeProp ?? {}) };

  const ProfileCard = ({ children, className = "" }: ProfileCardProps) => (
    <div 
      className={`rounded-2xl shadow-lg border p-5 mb-5 transition-all duration-300 text-left ${className}`}
      style={{ 
        backgroundColor: theme.cardBg, 
        borderColor: theme.border,
        color: theme.text
      }}
    >
      {children}
    </div>
  );

  const Button = ({ children, variant = "primary", size = "md", className = "", onClick }: ButtonProps) => {
    const variants: Record<ButtonVariant, React.CSSProperties> = {
      primary: { backgroundColor: theme.accent, color: '#FFFFFF' },
      secondary: { backgroundColor: theme.secondary, color: '#FFFFFF' },
      outline: { backgroundColor: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}` },
      ghost: { backgroundColor: 'transparent', color: theme.text }
    };
    
    const sizes: Record<ButtonSize, string> = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2'
    };

    return (
      <button 
        className={`rounded-lg font-medium transition-all duration-200 hover:shadow-lg hover:scale-105 ${sizes[size]} ${className}`}
        style={variants[variant]}
        onClick={onClick}
      >
        {children}
      </button>
    );
  };

  // A profile that can't be shown says so plainly rather than rendering a
  // skeleton of someone who isn't there.
  if (loading || error) {
    return (
      <div style={{ backgroundColor: theme.background, minHeight: '100vh', color: theme.text, fontFamily: "'Poppins', sans-serif" }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          {onBack && (
            <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
          )}
          <div className="text-center py-24 opacity-75">
            {loading ? 'Loading…' : error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: theme.background, minHeight: '100vh', color: theme.text, fontFamily: "'Merriweather', sans-serif" }}>
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="flex items-center justify-between mb-3" style={{ minHeight: '2rem' }}>
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Back"
              title="Back"
              className="flex items-center justify-center"
              style={{ width: '2.25rem', height: '2.25rem', padding: 0, borderRadius: '9999px', background: 'transparent', border: 'none', color: theme.text, opacity: 0.75 }}
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : <span />}
          {notice && <span className="text-sm opacity-75">{notice}</span>}
        </div>

        {/* A connections-only profile shows identity and nothing else —
            the server withholds the rest, and this says why rather than
            rendering a page of blanks. */}
        {userData.restricted && (
          <ProfileCard>
            <div className="text-center py-8">
              <h2 className="text-2xl font-bold mb-2">{userData.name}</h2>
              <p className="opacity-75 mb-4">
                This profile is visible to {userData.name.split(' ')[0]}'s connections.
              </p>
              {userData.relationship.state === 'none' && (
                <Button onClick={handleConnect}>Send a connection request</Button>
              )}
              {userData.relationship.state === 'pending' && (
                <p className="opacity-75">Your request is pending.</p>
              )}
            </div>
          </ProfileCard>
        )}

        {!userData.restricted && <>
        
        {/* Two columns with room (profile + side panel), one on a phone. */}
        <div className="grid" style={{ gap: '1.25rem', alignItems: 'start' }}>
          {/* Main Content */}
          <div className="min-w-0">
            {/* Hero Section */}
            <ProfileCard>
              <div className="relative">
                {/* Cover, fading into the card */}
                <div
                  className="rounded-xl relative overflow-hidden"
                  style={{
                    height: '8.5rem',
                    backgroundImage: userData.coverUrl
                      ? `linear-gradient(to bottom, transparent 45%, ${theme.cardBg}), url(${userData.coverUrl})`
                      : `linear-gradient(135deg, ${theme.secondary}40, ${theme.accent}33)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />

                {/* Photo, with a live dot when they're here now */}
                <div className="relative flex justify-center" style={{ marginTop: '-3rem' }}>
                  <div className="relative">
                    <div
                      className="rounded-full flex items-center justify-center font-bold relative overflow-hidden"
                      style={{
                        width: '6rem', height: '6rem', fontSize: '2rem',
                        backgroundColor: theme.secondary,
                        border: `4px solid ${theme.cardBg}`,
                        color: '#FFFFFF',
                        boxShadow: `0 8px 32px ${theme.secondary}4d`,
                      }}
                    >
                      {(userData.name || '?').trim().charAt(0).toUpperCase() || '?'}
                      {userData.avatarUrl && brokenAvatar !== userData.avatarUrl && (
                        <img
                          src={userData.avatarUrl}
                          alt={userData.name}
                          onError={() => setBrokenAvatar(userData.avatarUrl)}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                    </div>
                    {userData.isOnline && (
                      <span
                        aria-label="Online now"
                        className="absolute rounded-full"
                        style={{ right: '0.3rem', bottom: '0.3rem', width: '1.1rem', height: '1.1rem', backgroundColor: '#4ECDC4', border: `3px solid ${theme.cardBg}` }}
                      />
                    )}
                  </div>
                </div>

                {/* Who they are */}
                <div className="text-center mt-3">
                  <h1 className="font-semibold leading-tight" style={{ fontSize: '1.5rem', margin: 0 }}>{userData.name}</h1>
                  {userData.username && <p className="text-sm opacity-60 mt-0.5">@{userData.username}</p>}
                  {userData.title && <p className="text-sm opacity-90 mt-2 px-4">{userData.title}</p>}

                  {/* Where you stand with them, in words */}
                  <div className="flex flex-wrap items-center justify-center gap-2 mt-3 text-xs">
                    {userData.relationship.state === 'accepted' && (
                      <span className="flex items-center gap-1 font-medium" style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', backgroundColor: `${theme.secondary}22`, color: theme.secondary }}>
                        <UserCheck className="w-3.5 h-3.5" /> Friends
                      </span>
                    )}
                    {userData.relationship.state === 'pending' && userData.relationship.direction === 'outgoing' && (
                      <span className="flex items-center gap-1 font-medium" style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', backgroundColor: `${theme.accent}1f`, color: theme.accent }}>
                        <Clock className="w-3.5 h-3.5" /> Request sent
                      </span>
                    )}
                    {isFollowing && userData.relationship.state !== 'accepted' && (
                      <span className="flex items-center gap-1 font-medium" style={{ padding: '0.2rem 0.65rem', borderRadius: '9999px', backgroundColor: `${theme.accent}1f`, color: theme.accent }}>
                        <BellRing className="w-3.5 h-3.5" /> Following
                      </span>
                    )}
                    <span className="flex items-center gap-1 opacity-70">
                      {userData.isOnline
                        ? <><span className="inline-block rounded-full" style={{ width: 7, height: 7, backgroundColor: '#4ECDC4' }} /> Online now</>
                        : userData.lastActive}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs opacity-60">
                    {userData.location && (
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{userData.location}</span>
                    )}
                    {userData.joinDate && (
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Joined {userData.joinDate}</span>
                    )}
                  </div>
                </div>

                {/* Numbers */}
                <div
                  className="flex mt-4 rounded-xl"
                  style={{ backgroundColor: `${theme.secondary}10`, border: `1px solid ${theme.secondary}26` }}
                >
                  {[
                    { value: userData.followers, label: userData.followers === 1 ? 'Follower' : 'Followers' },
                    { value: userData.following, label: 'Following' },
                    { value: userData.mutualConnections, label: 'Mutual' },
                  ].map((item, index) => (
                    <div
                      key={item.label}
                      className="text-center py-3"
                      style={{ flex: 1, minWidth: 0, borderLeft: index ? `1px solid ${theme.secondary}26` : 'none' }}
                    >
                      <div className="text-lg font-semibold" style={{ color: theme.secondary }}>{item.value.toLocaleString()}</div>
                      <div className="text-xs opacity-65">{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* They asked to connect: the one thing to answer, in words */}
                {userData.relationship.state === 'pending' && userData.relationship.direction === 'incoming' && (
                  <div
                    className="flex items-center justify-between gap-3 mt-4 rounded-xl flex-wrap"
                    style={{ padding: '0.75rem 1rem', backgroundColor: `${theme.accent}14`, border: `1px solid ${theme.accent}40` }}
                  >
                    <span className="text-sm">{userData.name.split(' ')[0]} wants to connect</span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => handleRespond('accept')}
                        className="text-sm font-semibold"
                        style={{ padding: '0.35rem 0.9rem', borderRadius: '9999px', backgroundColor: theme.accent, color: theme.background, border: 'none' }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleRespond('decline')}
                        className="text-sm"
                        style={{ padding: '0.35rem 0.9rem', borderRadius: '9999px', backgroundColor: 'transparent', color: theme.text, border: `1px solid ${theme.border}` }}
                      >
                        Decline
                      </button>
                    </span>
                  </div>
                )}

                {/* Actions — icons; Message is the main one */}
                <div className="flex items-center justify-center mt-5" style={{ gap: '0.9rem' }}>
                  {(() => {
                    const state = userData.relationship.state;
                    const outgoing = state === 'pending' && userData.relationship.direction === 'outgoing';
                    const actions: { label: string; icon: React.ReactNode; onClick: () => void; primary?: boolean; active?: boolean }[] = [];
                    if (state === 'none') actions.push({ label: 'Connect', icon: <UserPlus className="w-5 h-5" />, onClick: handleConnect });
                    if (outgoing) actions.push({ label: 'Withdraw request', icon: <UserX className="w-5 h-5" />, onClick: () => handleRemoveConnection('withdraw') });
                    if (state !== 'accepted') actions.push({ label: isFollowing ? 'Unfollow' : 'Follow', icon: isFollowing ? <BellRing className="w-5 h-5" /> : <BellPlus className="w-5 h-5" />, onClick: handleFollowToggle, active: isFollowing });
                    actions.splice(Math.min(1, actions.length), 0, { label: 'Send message', icon: <MessageCircle className="w-6 h-6" />, onClick: handleSendMessage, primary: true });
                    actions.push({ label: 'Share profile', icon: <Share2 className="w-5 h-5" />, onClick: handleShareProfile });
                    return actions.map((action) => (
                      <button
                        key={action.label}
                        onClick={action.onClick}
                        aria-label={action.label}
                        title={action.label}
                        className="flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-95"
                        style={{
                          borderRadius: '9999px',
                          width: action.primary ? '3.5rem' : '2.75rem',
                          height: action.primary ? '3.5rem' : '2.75rem',
                          padding: 0,
                          flexShrink: 0,
                          backgroundColor: action.primary ? theme.secondary : action.active ? `${theme.accent}33` : `${theme.accent}14`,
                          color: action.primary ? '#FFFFFF' : theme.accent,
                          border: action.primary ? 'none' : `1px solid ${theme.accent}40`,
                          boxShadow: action.primary ? `0 6px 20px ${theme.secondary}55` : 'none',
                        }}
                      >
                        {action.icon}
                      </button>
                    ));
                  })()}

                  {/* More: the rarer, heavier choices */}
                  <div className="relative" ref={moreRef}>
                    <button
                      onClick={() => { setMoreOpen((open) => !open); setConfirmRemove(false); }}
                      aria-label="More options"
                      aria-expanded={moreOpen}
                      title="More options"
                      className="flex items-center justify-center"
                      style={{
                        borderRadius: '9999px', width: '2.75rem', height: '2.75rem', padding: 0,
                        backgroundColor: `${theme.accent}14`, color: theme.accent, border: `1px solid ${theme.accent}40`,
                      }}
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                    {moreOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 bottom-full mb-2 z-50 rounded-xl shadow-lg overflow-hidden text-sm text-left"
                        style={{ background: theme.surface, border: `1px solid ${theme.border}`, minWidth: '12rem' }}
                      >
                        {userData.relationship.state === 'accepted' && (
                          <button
                            role="menuitem"
                            className="w-full text-left flex items-center gap-2"
                            style={{ padding: '0.75rem 1rem', color: '#ff6b6b', background: 'transparent', borderRadius: 0 }}
                            onClick={() => {
                              if (!confirmRemove) { setConfirmRemove(true); return; }
                              setMoreOpen(false);
                              handleRemoveConnection('remove');
                            }}
                          >
                            <UserX className="w-4 h-4" />
                            {confirmRemove ? `Tap again to remove ${userData.name.split(' ')[0]}` : 'Remove friend'}
                          </button>
                        )}
                        <button
                          role="menuitem"
                          className="w-full text-left flex items-center gap-2"
                          style={{ padding: '0.75rem 1rem', color: '#ff6b6b', background: 'transparent', borderRadius: 0 }}
                          onClick={() => { setMoreOpen(false); handleBlock(); }}
                        >
                          <Ban className="w-4 h-4" />
                          Block {userData.name.split(' ')[0]}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* About */}
            {(userData.about || userData.currentFocus || userData.growthAreas || userData.values) && (
            <ProfileCard>
              <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.accent}22` }}>
                  <Target className="w-4 h-4" style={{ color: theme.accent }} />
                </span>
                About {userData.name.split(' ')[0]}
              </h3>
              {userData.about && (
                <p className="leading-relaxed text-sm whitespace-pre-line" style={{ opacity: 0.9 }}>{userData.about}</p>
              )}
              {/* Only the ones they've filled in */}
              <div className="flex flex-col" style={{ gap: '0.6rem', marginTop: userData.about ? '1rem' : 0 }}>
                {[
                  { label: 'Current Focus', value: userData.currentFocus, icon: <Target className="w-4 h-4" />, color: theme.accent },
                  { label: 'Growth Areas', value: userData.growthAreas, icon: <TrendingUp className="w-4 h-4" />, color: theme.secondary },
                  { label: 'Core Values', value: userData.values, icon: <Heart className="w-4 h-4" />, color: theme.accent },
                ].filter((item) => item.value).map((item) => (
                  <div key={item.label} className="flex items-start gap-3 rounded-lg" style={{ padding: '0.7rem 0.85rem', backgroundColor: `${item.color}12`, border: `1px solid ${item.color}2e` }}>
                    <span className="flex mt-0.5" style={{ color: item.color }}>{item.icon}</span>
                    <span className="min-w-0">
                      <span className="block text-xs font-medium opacity-70">{item.label}</span>
                      <span className="block text-sm break-words">{item.value}</span>
                    </span>
                  </div>
                ))}
              </div>
            </ProfileCard>
            )}

            {/* Their journals */}
            <ProfileCard>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.secondary}22` }}>
                  <BookOpen className="w-4 h-4" style={{ color: theme.secondary }} />
                </span>
                Popular Journals
              </h3>
                {userData.topJournals.length > 4 && (
                  <button
                    onClick={handleViewAllPosts}
                    className="flex items-center gap-1 text-sm font-medium mb-4 flex-shrink-0"
                    style={{ padding: '0.4rem 0.8rem', borderRadius: '9999px', backgroundColor: `${theme.accent}14`, border: `1px solid ${theme.accent}40`, color: theme.accent }}
                  >
                    {showAllPosts ? 'Fewer' : `All ${userData.topJournals.length}`} <ChevronRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              {userData.topJournals.length === 0 && (
                <p className="text-sm opacity-60">{userData.name.split(' ')[0]} hasn't shared any entries yet.</p>
              )}

              <div className="flex flex-col" style={{ gap: '0.8rem' }}>
                {userData.topJournals.slice(0, showAllPosts ? undefined : 4).map((journal, index) => {
                  const edge = index === 0 ? theme.accent : theme.secondary;
                  const liked = reactions[journal.id]?.liked;
                  return (
                    <div
                      key={journal.id}
                      className="relative rounded-xl overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                      style={{ padding: '0.95rem 1rem 0.8rem 1.15rem', backgroundColor: `${edge}10`, border: `1px solid ${edge}2e` }}
                    >
                      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0" style={{ width: '4px', backgroundColor: edge }} />
                      <div className="flex items-start gap-3">
                        <div className="flex items-center justify-center flex-shrink-0 text-xl" style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.8rem', backgroundColor: `${edge}22` }}>
                          {journal.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          {journal.title && <h4 className="font-semibold text-base leading-snug break-words">{journal.title}</h4>}
                          <p className="text-xs opacity-55 mt-0.5">{journal.date}</p>
                        </div>
                        {journal.isHighlighted && (
                          <span className="text-xs font-bold flex-shrink-0" style={{ padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: `${theme.accent}26`, color: theme.accent }}>
                            ⭐ Top
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed opacity-85 mt-3" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {journal.excerpt}
                      </p>
                      {journal.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {journal.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="text-xs font-medium" style={{ padding: '0.15rem 0.6rem', borderRadius: '9999px', backgroundColor: `${theme.secondary}22`, color: theme.secondary }}>
                              #{tag.replace(/^#/, '')}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${theme.border}` }}>
                        <div className="flex items-center gap-4 text-sm">
                          <button
                            onClick={() => handleReaction(journal.id)}
                            aria-label={liked ? 'Unlike' : 'Like'}
                            title={liked ? 'Unlike' : 'Like'}
                            className="flex items-center gap-1.5 transition-all hover:scale-110"
                            style={{ padding: 0, background: 'transparent', border: 'none', color: theme.text }}
                          >
                            <Heart className="w-4 h-4" style={{ color: liked ? '#ff4757' : theme.accent, fill: liked ? '#ff4757' : 'none' }} />
                            <span className="font-medium">{reactions[journal.id]?.count ?? journal.interactions.reactions}</span>
                          </button>
                          <span className="flex items-center gap-1.5 opacity-80">
                            <MessageCircle className="w-4 h-4" />
                            <span className="font-medium">{journal.interactions.comments}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {[
                            { label: 'Comment', icon: <MessageCircle className="w-4 h-4" />, onClick: () => onOpenPost?.(journal.id) },
                            { label: 'Share', icon: <Share2 className="w-4 h-4" />, onClick: () => handleSharePost(journal.id) },
                          ].map((item) => (
                            <button
                              key={item.label}
                              onClick={item.onClick}
                              aria-label={item.label}
                              title={item.label}
                              className="flex items-center justify-center transition-all hover:scale-105"
                              style={{ width: '2.2rem', height: '2.2rem', padding: 0, borderRadius: '9999px', backgroundColor: `${theme.accent}12`, border: `1px solid ${theme.accent}40`, color: theme.accent }}
                            >
                              {item.icon}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ProfileCard>
          </div>

          {/* Side panel */}
          <div className="min-w-0">
            {/* Numbers not already in the header strip */}
            <ProfileCard>
              <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.accent}22` }}>
                  <TrendingUp className="w-4 h-4" style={{ color: theme.accent }} />
                </span>
                Journey
              </h3>
              <div className="flex" style={{ gap: '0.6rem' }}>
                {[
                  { icon: <BookOpen className="w-4 h-4" />, value: userData.stats.totalEntries, label: 'Entries', color: theme.secondary },
                  { icon: <Heart className="w-4 h-4" />, value: userData.stats.totalReactions, label: 'Reactions', color: theme.accent },
                ].map((tile) => (
                  <div key={tile.label} className="flex-1 text-center rounded-xl" style={{ padding: '0.75rem 0.5rem', backgroundColor: `${tile.color}12`, border: `1px solid ${tile.color}2e` }}>
                    <span className="flex justify-center" style={{ color: tile.color }}>{tile.icon}</span>
                    <div className="text-lg font-semibold mt-1" style={{ color: tile.color }}>{tile.value.toLocaleString()}</div>
                    <div className="text-xs opacity-65">{tile.label}</div>
                  </div>
                ))}
              </div>
            </ProfileCard>

            {userData.achievements.length > 0 && (
              <ProfileCard>
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.accent}22` }}>
                  <Award className="w-4 h-4" style={{ color: theme.accent }} />
                </span>
                Achievements
              </h3>
                <div className="flex flex-wrap" style={{ gap: '0.6rem' }}>
                  {userData.achievements.map((achievement, index) => (
                    <div
                      key={index}
                      title={`Earned ${achievement.earned}`}
                      className="flex items-center gap-2 rounded-xl min-w-0"
                      style={{ flex: '1 1 calc(50% - 0.3rem)', padding: '0.6rem 0.7rem', backgroundColor: `${theme.accent}10`, border: `1px solid ${theme.accent}26` }}
                    >
                      <span className="text-xl flex-shrink-0">{achievement.icon}</span>
                      <span className="text-xs font-medium leading-tight">{achievement.name}</span>
                    </div>
                  ))}
                </div>
              </ProfileCard>
            )}

            {userData.favoriteTopics.length > 0 && (
              <ProfileCard>
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.accent}22` }}>
                  <Sparkles className="w-4 h-4" style={{ color: theme.accent }} />
                </span>
                Interests
              </h3>
                <div className="flex flex-wrap gap-2">
                  {userData.favoriteTopics.map((topic) => (
                    <span key={topic} className="text-sm font-medium" style={{ padding: '0.3rem 0.8rem', borderRadius: '9999px', backgroundColor: `${theme.secondary}20`, color: theme.secondary, border: `1px solid ${theme.secondary}30` }}>
                      #{topic.replace(/^#/, '')}
                    </span>
                  ))}
                </div>
              </ProfileCard>
            )}

            {/* Contact — only what they chose to show */}
            {(userData.email || userData.phone) && (
              <ProfileCard>
                <h3 className="font-semibold text-lg flex items-center gap-2 mb-4">
                <span className="flex items-center justify-center" style={{ width: '2.2rem', height: '2.2rem', borderRadius: '0.7rem', backgroundColor: `${theme.accent}22` }}>
                  <User className="w-4 h-4" style={{ color: theme.accent }} />
                </span>
                Contact
              </h3>
                <div className="flex flex-col" style={{ gap: '0.5rem' }}>
                  {userData.email && (
                    <button onClick={() => handleContactClick('email', userData.email)} className="flex items-center gap-3 rounded-lg text-left" style={{ padding: '0.65rem 0.8rem', backgroundColor: `${theme.accent}10`, border: 'none', color: theme.text }}>
                      <Mail className="w-4 h-4 flex-shrink-0" style={{ color: theme.accent }} />
                      <span className="text-sm truncate">{userData.email}</span>
                    </button>
                  )}
                  {userData.phone && (
                    <button onClick={() => handleContactClick('phone', userData.phone)} className="flex items-center gap-3 rounded-lg text-left" style={{ padding: '0.65rem 0.8rem', backgroundColor: `${theme.secondary}10`, border: 'none', color: theme.text }}>
                      <Phone className="w-4 h-4 flex-shrink-0" style={{ color: theme.secondary }} />
                      <span className="text-sm">{userData.phone}</span>
                    </button>
                  )}
                </div>
              </ProfileCard>
            )}
          </div>
        </div>
        </>}
      </div>
    </div>
  );
};

export default SoulLogOthersProfile;
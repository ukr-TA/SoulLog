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
import { useCallback, useEffect, useState } from 'react';
import { MapPin, Calendar, MessageCircle, Users, Heart, Share2, Award, BookOpen, Target, TrendingUp, Sparkles, Phone, Mail, User, MoreHorizontal } from 'lucide-react';
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
      className={`rounded-xl shadow-lg border p-6 mb-6 transition-all duration-300 ${className}`}
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
    <div style={{ backgroundColor: theme.background, minHeight: '100vh', color: theme.text, fontFamily: "'Poppins', sans-serif" }}>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4">
          {onBack ? (
            <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
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
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Hero Section */}
            <ProfileCard>
              <div className="relative">
                {/* Cover Image */}
                <div 
                  className="h-48 md:h-56 rounded-xl mb-6 relative overflow-hidden flex items-center justify-center"
                  style={{ 
                    // Their cover photo when they have one. Longhand
                    // properties only: mixing `background` with
                    // `backgroundSize` made React warn on every re-render.
                    backgroundImage: userData.coverUrl ? `url(${userData.coverUrl})` : theme.gradient,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                />

                {/* Profile Picture */}
                <div className="relative -mt-20 md:-mt-24 mb-6 flex justify-center lg:justify-start">
                  <div className="relative">
                    <div 
                      className="w-32 h-32 md:w-36 md:h-36 rounded-full border-4 flex items-center justify-center text-4xl font-bold relative overflow-hidden"
                      style={{ 
                        backgroundColor: theme.secondary, 
                        borderColor: theme.cardBg,
                        color: '#FFFFFF',
                        boxShadow: `0 8px 32px rgba(44, 171, 164, 0.3)`
                      }}
                    >
                      {(userData.name || '?').trim().charAt(0).toUpperCase() || '?'}
                      <div className="absolute inset-0 bg-gradient-to-tr from-transparent to-white opacity-20"></div>
                      {/* Their photo sits over the initial, and simply
                          disappears if it fails to load. */}
                      {userData.avatarUrl && brokenAvatar !== userData.avatarUrl && (
                        <img
                          src={userData.avatarUrl}
                          alt={userData.name}
                          onError={() => setBrokenAvatar(userData.avatarUrl)}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      )}
                    </div>
                    
                    {/* Online Status */}
                    {userData.isOnline && (
                      <div 
                        className="absolute bottom-2 right-2 w-5 h-5 rounded-full border-2"
                        style={{ 
                          backgroundColor: '#4ECDC4',
                          borderColor: theme.cardBg
                        }}
                      />
                    )}
                  </div>
                </div>

                {/* Profile Info */}
                <div className="text-center lg:text-left">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between mb-6">
                    <div>
                      <h1 className="text-3xl md:text-4xl font-bold mb-3">
                        {userData.name}
                      </h1>
                      
                      <p className="text-xl mb-4 opacity-90 flex items-center justify-center lg:justify-start gap-2">
                        <Sparkles className="w-5 h-5" style={{ color: theme.accent }} />
                        {userData.title}
                      </p>
                      
                      <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 text-sm opacity-75 mb-6">
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.secondary}15` }}>
                          <Calendar className="w-4 h-4" />
                          Joined {userData.joinDate}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.secondary}15` }}>
                          <MapPin className="w-4 h-4" />
                          {userData.location}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.accent}15` }}>
                          <Users className="w-4 h-4" />
                          {userData.followers.toLocaleString()} followers
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full" style={{ backgroundColor: `${theme.accent}15` }}>
                          <span>👥</span>
                          {userData.mutualConnections} mutual connections
                        </div>
                      </div>
                      
                      {/* Last Active */}
                      <p className="text-sm opacity-60 mb-4 text-center lg:text-left">
                        {userData.isOnline ? '🟢 Online now' : userData.lastActive}
                      </p>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-3 justify-center lg:justify-start">
                    {/* Friends already follow each other (they count in each
                        other's followers and following), so there's
                        nothing separate to follow or unfollow. */}
                    {userData.relationship.state !== 'accepted' && (
                      <Button
                        variant="primary"
                        onClick={handleFollowToggle}
                        className={isFollowing ? 'bg-opacity-80' : ''}
                      >
                        <Users className="w-4 h-4 mr-2" />
                        {isFollowing ? 'Following ✓' : 'Follow'}
                      </Button>
                    )}
                    {userData.relationship.state === 'none' && (
                      <Button variant="outline" onClick={handleConnect}>Connect</Button>
                    )}
                    {/* These two used to be labels drawn as buttons. They now
                        do what their state suggests: withdraw the request,
                        or (after a second tap) remove the connection. */}
                    {userData.relationship.state === 'pending' &&
                      userData.relationship.direction === 'outgoing' && (
                      <Button variant="ghost" onClick={() => handleRemoveConnection('withdraw')}>
                        Requested · Withdraw
                      </Button>
                    )}
                    {userData.relationship.state === 'pending' &&
                      userData.relationship.direction === 'incoming' && (
                      <>
                        <Button variant="primary" onClick={() => handleRespond('accept')}>Accept request</Button>
                        <Button variant="ghost" onClick={() => handleRespond('decline')}>Decline</Button>
                      </>
                    )}
                    {userData.relationship.state === 'accepted' && (
                      <Button variant="ghost" onClick={() => handleRemoveConnection('remove')}>
                        {confirmRemove ? 'Tap again to remove' : 'Connected ✓'}
                      </Button>
                    )}
                    <Button variant="secondary" onClick={handleSendMessage}>
                      <MessageCircle className="w-4 h-4 mr-2" />
                      Send Message
                    </Button>
                    <Button variant="outline" onClick={handleShareProfile}>
                      <Share2 className="w-4 h-4 mr-2" />
                      Share Profile
                    </Button>
                    <Button variant="outline" onClick={handleBlock}>
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* About Section */}
            <ProfileCard>
              <div className="flex items-center mb-6">
                <h2 className="text-2xl font-semibold flex items-center gap-2">
                  <Target className="w-6 h-6" style={{ color: theme.accent }} />
                  About {userData.name.split(' ')[0]}
                </h2>
              </div>
              
              <div className="relative p-6 rounded-xl mb-6" style={{ backgroundColor: `${theme.secondary}10`, border: `1px solid ${theme.secondary}20` }}>
                <p className="leading-relaxed text-lg">
                  {userData.about}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex items-center p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                  <Target className="w-4 h-4 mr-2 flex-shrink-0" style={{ color: theme.accent }} />
                  <div>
                    <p className="font-medium text-xs mb-0.5">Current Focus</p>
                    <p className="text-xs opacity-75">{userData.currentFocus}</p>
                  </div>
                </div>
                <div className="flex items-center p-3 rounded-lg" style={{ backgroundColor: `${theme.secondary}15`, border: `1px solid ${theme.secondary}30` }}>
                  <TrendingUp className="w-4 h-4 mr-2 flex-shrink-0" style={{ color: theme.secondary }} />
                  <div>
                    <p className="font-medium text-xs mb-0.5">Growth Areas</p>
                    <p className="text-xs opacity-75">{userData.growthAreas}</p>
                  </div>
                </div>
                <div className="flex items-center p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                  <Heart className="w-4 h-4 mr-2 flex-shrink-0" style={{ color: theme.accent }} />
                  <div>
                    <p className="font-medium text-xs mb-0.5">Core Values</p>
                    <p className="text-xs opacity-75">{userData.values}</p>
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* Popular Journals */}
            <ProfileCard>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold flex items-center gap-2">
                  <BookOpen className="w-6 h-6" style={{ color: theme.secondary }} />
                  Popular Journals
                </h2>
                {userData.topJournals.length > 4 && (
                  <Button variant="outline" size="sm" onClick={handleViewAllPosts}>
                    {showAllPosts ? 'Show fewer' : `View all ${userData.topJournals.length} posts`}
                  </Button>
                )}
              </div>
              
              <div className="space-y-6">
                {userData.topJournals.slice(0, showAllPosts ? undefined : 4).map((journal) => (
                  <div 
                    key={journal.id}
                    className={`relative p-6 rounded-xl border-l-4 transition-all duration-300 hover:shadow-lg hover:scale-[1.02] ${journal.isHighlighted ? 'ring-2' : ''}`} 
                    style={{ 
                      borderColor: journal.isHighlighted ? theme.accent : theme.secondary,
                      backgroundColor: journal.isHighlighted ? `${theme.accent}12` : `${theme.secondary}08`,
                      border: `1px solid ${journal.isHighlighted ? theme.accent : theme.secondary}20`,
                      outlineColor: journal.isHighlighted ? `${theme.accent}40` : 'transparent'
                    }}
                  >
                    {journal.isHighlighted && (
                      <div className="absolute top-3 right-3">
                        <div 
                          className="px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1"
                          style={{ backgroundColor: theme.accent, color: '#FFFFFF' }}
                        >
                          ⭐ Most Popular
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="text-3xl">{journal.emoji}</span>
                        <div className="flex-1">
                          {journal.title && <h3 className="font-semibold text-xl mb-1">{journal.title}</h3>}
                          <span className="text-sm opacity-60">{journal.date}</span>
                        </div>
                      </div>
                    </div>
                    
                    <p className="text-base leading-relaxed mb-4 opacity-90">{journal.excerpt}</p>
                    
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-wrap gap-2">
                        {journal.tags.map((tag) => (
                          <span 
                            key={tag}
                            className="px-3 py-1 rounded-full text-sm font-medium transition-all"
                            style={{ backgroundColor: `${theme.secondary}25`, color: theme.secondary }}
                          >
                            #{tag.replace(/^#/, '')}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    {/* Interaction Stats */}
                    <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: theme.border }}>
                      <div className="flex items-center gap-6 text-sm">
                        <button 
                          className="flex items-center gap-1 transition-all hover:scale-110"
                          onClick={() => handleReaction(journal.id)}
                        >
                          <Heart 
                            className="w-4 h-4" 
                            style={{ 
                              color: reactions[journal.id]?.liked ? '#ff4757' : theme.accent,
                              fill: reactions[journal.id]?.liked ? '#ff4757' : 'none'
                            }} 
                          />
                          <span className="font-medium">{reactions[journal.id]?.count ?? journal.interactions.reactions}</span>
                        </button>
                        <div className="flex items-center gap-1">
                          <MessageCircle className="w-4 h-4 opacity-75" />
                          <span className="font-medium">{journal.interactions.comments}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button variant="outline" size="sm" onClick={() => handleSharePost(journal.id)}>
                          <Share2 className="w-4 h-4" />
                        </Button>
                        {/* Used to share the post, like the button beside it. */}
                        <Button variant="outline" size="sm" onClick={() => onOpenPost?.(journal.id)}>
                          <MessageCircle className="w-4 h-4 mr-1" />
                          Comment
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ProfileCard>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Contact Info */}
            <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <User className="w-5 h-5" style={{ color: theme.accent }} />
                Contact Info
              </h3>
              <div className="space-y-3">
                {userData.email && (
                  <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-opacity-80 transition-all cursor-pointer" style={{ backgroundColor: `${theme.accent}08` }} onClick={() => handleContactClick('email', userData.email)}>
                    <Mail className="w-4 h-4" style={{ color: theme.accent }} />
                    <span className="text-sm">{userData.email}</span>
                  </div>
                )}
                {userData.phone && (
                  <div className="flex items-center gap-3 p-3 rounded-lg hover:bg-opacity-80 transition-all cursor-pointer" style={{ backgroundColor: `${theme.secondary}08` }} onClick={() => handleContactClick('phone', userData.phone)}>
                    <Phone className="w-4 h-4" style={{ color: theme.secondary }} />
                    <span className="text-sm">{userData.phone}</span>
                  </div>
                )}
                {userData.location && (
                  <div className="flex items-center gap-3 p-3 rounded-lg transition-all" style={{ backgroundColor: `${theme.accent}08` }}>
                    <MapPin className="w-4 h-4" style={{ color: theme.accent }} />
                    <span className="text-sm">{userData.location}</span>
                  </div>
                )}
                {!userData.email && !userData.phone && !userData.location && (
                  <p className="text-sm opacity-60">
                    {userData.name.split(' ')[0]} hasn't shared contact details.
                  </p>
                )}
              </div>
            </ProfileCard>

            {/* Journey Stats */}
            <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <TrendingUp className="w-4 h-4" style={{ color: theme.accent }} />
                Journey Stats
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center p-2 rounded-lg" style={{ backgroundColor: `${theme.secondary}10` }}>
                  <BookOpen className="w-4 h-4 mr-2" style={{ color: theme.secondary }} />
                  <div>
                    <p className="font-bold text-sm" style={{ color: theme.secondary }}>{userData.stats.totalEntries}</p>
                    <p className="text-xs opacity-75">Entries</p>
                  </div>
                </div>
                <div className="flex items-center p-2 rounded-lg" style={{ backgroundColor: `${theme.accent}10` }}>
                  <Users className="w-4 h-4 mr-2" style={{ color: theme.accent }} />
                  <div>
                    <p className="font-bold text-sm" style={{ color: theme.accent }}>{userData.followers}</p>
                    <p className="text-xs opacity-75">Followers</p>
                  </div>
                </div>
                <div className="flex items-center p-2 rounded-lg" style={{ backgroundColor: `${theme.secondary}10` }}>
                  <Heart className="w-4 h-4 mr-2" style={{ color: theme.secondary }} />
                  <div>
                    <p className="font-bold text-sm" style={{ color: theme.secondary }}>{userData.stats.totalReactions.toLocaleString()}</p>
                    <p className="text-xs opacity-75">Reactions</p>
                  </div>
                </div>
                <div className="flex items-center p-2 rounded-lg" style={{ backgroundColor: `${theme.accent}10` }}>
                  <Sparkles className="w-4 h-4 mr-2" style={{ color: theme.accent }} />
                  <div>
                    <p className="font-bold text-sm" style={{ color: theme.accent }}>{userData.mutualConnections}</p>
                    <p className="text-xs opacity-75">Mutual</p>
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* Achievements — rendered only when there are any, so a new
                account shows nothing rather than an empty heading. This section is
                simply absent rather than showing three invented badges
                the way it used to. */}
            {userData.achievements.length > 0 && <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Award className="w-5 h-5" style={{ color: theme.accent }} />
                Recent Achievements
              </h3>
              <div className="space-y-3">
                {userData.achievements.map((achievement, index) => (
                  <div 
                    key={index}
                    className="flex items-center gap-3 p-3 rounded-lg transition-all"
                    style={{ backgroundColor: `${index % 2 === 0 ? theme.accent : theme.secondary}10` }}
                  >
                    <span className="text-2xl">{achievement.icon}</span>
                    <div>
                      <p className="font-medium text-sm">{achievement.name}</p>
                      <p className="text-xs opacity-60">Earned {achievement.earned}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ProfileCard>}

            {/* Favorite Topics */}
            <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5" style={{ color: theme.accent }} />
                Interests
              </h3>
              <div className="flex flex-wrap gap-2">
                {userData.favoriteTopics.map((topic) => (
                  <span 
                    key={topic}
                    className="px-3 py-2 rounded-full text-sm font-medium transition-all hover:shadow-lg"
                    style={{ 
                      backgroundColor: `${theme.secondary}20`, 
                      color: theme.secondary,
                      border: `1px solid ${theme.secondary}30`
                    }}
                  >
                    #{topic}
                  </span>
                ))}
              </div>
            </ProfileCard>

            {/* Mutual Connections */}
            <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Users className="w-5 h-5" style={{ color: theme.accent }} />
                Connections
              </h3>
              <div className="text-center py-4">
                <div 
                  className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-bold"
                  style={{ backgroundColor: `${theme.secondary}20`, color: theme.secondary }}
                >
                  {userData.mutualConnections}
                </div>
                <p className="text-sm mb-3">Mutual connections</p>
              </div>
            </ProfileCard>
          </div>
        </div>
        </>}
      </div>
    </div>
  );
};

export default SoulLogOthersProfile;
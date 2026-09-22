/**
 * Your own profile.
 *
 * The screen existed; the person on it did not. It rendered "Alex
 * Johnson", 2,847 followers, 387 entries, a 67-day streak, 12,450 views,
 * two sample journal entries and three achievements — identical for
 * every account, including one created a minute ago. The image pickers
 * read files into base64 in component state, so a new avatar survived
 * until the next refresh.
 *
 * Everything here is now this user's own: their name, bio, focus areas,
 * interests, counts and most-engaged entries. Avatars and covers upload
 * for real. Achievements are the ones they have actually earned, derived
 * from their own activity — an empty list is the right answer on day one.
 */

import { goBack } from './nav';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, MapPin, Calendar, MessageCircle, Heart, Share2, Award, BookOpen, Target, TrendingUp, Sparkles, Edit3, Eye, ArrowLeft, NotebookPen, UserPen, BarChart3, UserPlus, ChevronRight } from 'lucide-react';
import { ApiError, api, get, post } from './api';
import { profileShare, shareOrCopy } from './links';
import type { Theme } from './theme';
import type {
  Achievement,
  AchievementProgress,
  JournalEntry,
  JournalStats,
  MyProfile,
  Paginated,
} from './types';

/** The app's twelve moods — the same list the server accepts. */
const MOODS: { value: string; emoji: string }[] = [
  { value: 'Happy', emoji: '😊' }, { value: 'Calm', emoji: '😌' }, { value: 'Grateful', emoji: '🙏' },
  { value: 'Hopeful', emoji: '🌱' }, { value: 'Content', emoji: '🙂' }, { value: 'Excited', emoji: '🤩' },
  { value: 'Anxious', emoji: '😰' }, { value: 'Stressed', emoji: '😣' }, { value: 'Sad', emoji: '😢' },
  { value: 'Lonely', emoji: '😔' }, { value: 'Frustrated', emoji: '😤' }, { value: 'Angry', emoji: '😠' },
];

/** Where the quick-entry draft lives on this device. See saveDraft below. */
const DRAFT_KEY = 'soullog.profileEntryDraft';

interface ProfilePageProps {
  theme: Theme;
  darkMode?: boolean;
  /**
   * Both are called unguarded below, so they are required here rather
   * than optional — the screen has never worked without them.
   */
  setActiveTab: (tab: string) => void;
  setHideExtra: (hide: boolean) => void;
  /** Open the profile form as an editor, returning here when done. */
  onEditProfile?: () => void;
  /** Open one journal entry in the Journal screen, for editing or sharing. */
  onOpenJournalEntry?: (entryId: number, action: 'edit' | 'share') => void;
  /** Open Community on the Souls (people) tab. */
  onFindConnections?: () => void;
  /** Phone layout: stats, badges and interests are left out (they're in Insights). */
  isMobile?: boolean;
  onOpenInsights?: () => void;
}

/** One card in "My Top Journals", built from the user's own entries. */
interface TopJournal {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  emoji: string;
  tags: string[];
  interactions: { reactions: number; comments: number };
  isHighlighted: boolean;
}

/** What this screen renders — the API payloads flattened for display. */
interface ProfileView {
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
  stats: {
    totalEntries: number;
    streakDays: number;
    totalReactions: number;
    profileViews: number;
    showProfileViews: boolean;
  };
  topJournals: TopJournal[];
  favoriteTopics: string[];
  recentAchievements: Achievement[];
  achievementProgress: AchievementProgress[];
}

const EMPTY_PROFILE: ProfileView = {
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
  stats: {
    totalEntries: 0, streakDays: 0, totalReactions: 0, profileViews: 0, showProfileViews: false,
  },
  topJournals: [],
  favoriteTopics: [],
  recentAchievements: [],
  achievementProgress: [],
};

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

interface StatCardProps {
  /**
   * Either an emoji string or a lucide icon element, which is cloned
   * below with the size and colour this tile wants.
   */
  icon: string | React.ReactElement<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string | number;
  color: string;
  bgColor: string;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
}

/**
 * Achievements are stored now, not derived at render time.
 *
 * They used to be computed from the current numbers, which meant a badge
 * appeared while the streak held and quietly vanished when it broke —
 * the 100-day streak you actually completed stopped existing the first
 * day you missed. They are rows now: awarded once, with the date they
 * were earned, and never taken away. The server decides what has been
 * earned; this screen only shows it.
 */

const EMPTY_ENTRY = { title: '', content: '', tags: '', mood: '', visibility: 'private' };

const ProfileCard = ({ children, className = "", theme }: { children?: React.ReactNode; className?: string; theme: Theme }) => (
  <div 
    className={`rounded-xl shadow-lg border p-5 transition-all duration-300 ${className} text-left`}
    style={{ 
      backgroundColor: theme.surface, 
      borderColor: theme.border,
      color: theme.text
    }}
  >
    {children}
  </div>
);

const Button = ({ children, variant = "primary", size = "md", className = "", onClick, theme }: ButtonProps & { theme: Theme }) => {
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
      className={`rounded-lg flex justify-center items-center gap-2 font-medium transition-all duration-200 hover:shadow-lg hover:scale-101 ${sizes[size]} ${className}`}
      style={variants[variant]}
      onClick={onClick}
    >
      {children}
    </button>
  );
};

const StatCard = ({ icon, label, value, color, bgColor, onClick }: StatCardProps) => (
  <div 
    className="text-center p-2 rounded-lg transition-all duration-300 hover:scale-101 cursor-pointer flex flex-col justify-center gap-1"
    style={{ 
      backgroundColor: bgColor, 
      border: `1px solid ${color}30`
    }}
    onClick={onClick}
  >
    <div className="flex items-center justify-center mb-1">
      {typeof icon === 'string' ? (
        <span className="w-4 h-4">{icon}</span>
      ) : (
        React.cloneElement(icon, { className: "w-4 h-4", style: { color } })
      )}
    </div>
    <p className="font-bold text-sm" style={{ color }}>{value}</p>
    <p className="text-xs opacity-75">{label}</p>
  </div>
);

const SoulLogOwnProfile = ({
  theme,
  setActiveTab,
  setHideExtra,
  onEditProfile,
  onOpenJournalEntry,
  onFindConnections,
  isMobile = false,
  onOpenInsights,
}: ProfilePageProps) => {
  const [showJournalModal, setShowJournalModal] = useState(false);
  // The quick-entry form. `mood` and `visibility` used to be a decorative
  // emoji picker and an unbound Public/Private switch — neither was ever
  // sent, so every entry saved as private and moodless whatever you chose.
  const [journalEntry, setJournalEntry] = useState(EMPTY_ENTRY);
  const [notice, setNotice] = useState<string | null>(null);

  // About Me and Interests edit in place.
  const [editingInterests, setEditingInterests] = useState(false);
  const [interestsDraft, setInterestsDraft] = useState('');
  const [savingField, setSavingField] = useState(false);

  const [userData, setUserData] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
  // A photo that fails to load falls back to the initial, not a blank circle.
  const profileImage = userData.avatarUrl && brokenAvatar !== userData.avatarUrl ? userData.avatarUrl : null;
  const coverImage = userData.coverUrl;

  const load = useCallback(async () => {
    try {
      const [profile, stats, page] = await Promise.all([
        get<MyProfile>('/profile/'),
        get<JournalStats>('/journal/stats/'),
        // One page, not the whole journal: this list shows five.
        get<Paginated<JournalEntry>>('/journal/?limit=50'),
      ]);
      const entries = page.entries || [];

      // "Top journals" are the user's own most-engaged shared entries,
      // not two invented ones. Private entries are excluded because the
      // engagement numbers beside them would always be zero. Ranked by
      // hearts and comments, so "top" means top rather than "newest".
      const shared: TopJournal[] = entries
        .filter((entry) => entry.visibility !== 'private')
        .sort((a, b) => ((b.likes ?? 0) + (b.comments ?? 0)) - ((a.likes ?? 0) + (a.comments ?? 0)))
        .slice(0, 5)
        .map((entry) => ({
          id: entry.id,
          title: entry.title || (entry.content || '').slice(0, 60),
          excerpt: (entry.content || '').slice(0, 160),
          date: new Date(entry.created_at).toLocaleDateString(),
          emoji: entry.entry_type === 'voice' ? '🎙️' : entry.entry_type === 'photo' ? '📷' : '📝',
          tags: entry.tags || [],
          interactions: { reactions: entry.likes ?? 0, comments: entry.comments ?? 0 },
          isHighlighted: false,
        }));

      setUserData({
        name: profile.name || profile.username,
        username: profile.username,
        // The line under your name: your tagline, or your current focus
        // if you haven't written one.
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
        coverUrl: profile.coverUrl || null,
        stats: {
          totalEntries: stats.total_entries || 0,
          streakDays: stats.current_streak_days || 0,
          // Hearts other people left on this user's posts, comments and
          // entries — their own don't count towards it.
          totalReactions: profile.stats?.reactionsReceived || 0,
          profileViews: profile.stats?.profileViews || 0,
          showProfileViews: !!profile.showProfileViews,
        },
        topJournals: shared,
        favoriteTopics: profile.interests || [],
        recentAchievements: profile.achievements || [],
        achievementProgress: profile.achievementProgress || [],
      });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Briefly confirm something happened, then clear. */
  // One timer at a time: an earlier message's timer used to clear a newer
  // message early (share, then save, and "About Me updated" vanished).
  const flashTimer = useRef<number | undefined>(undefined);
  const flash = (message: string) => {
    setNotice(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setNotice(null), 3000);
  };

  /**
   * Share Profile.
   *
   * SoulLog has no public web page per profile to link to, so what is
   * shared is how to find you: your @username. On a phone this opens the
   * system share sheet; elsewhere it is copied to the clipboard. Either
   * way the button now says what it did.
   */
  const handleShareProfile = async () => {
    const result = await shareOrCopy(profileShare(userData.username, userData.name));
    if (result === 'copied') flash('Profile link copied — anyone who opens it lands on your profile.');
    else if (result === 'failed') flash(`Your username is @${userData.username} — share it so people can find you.`);
  };

  /** Save one or more profile fields and reload. */
  const saveProfileFields = async (fields: Record<string, string | string[]>) => {
    setSavingField(true);
    try {
      await api('/profile/', { method: 'PATCH', body: fields });
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not save.');
      return false;
    } finally {
      setSavingField(false);
    }
  };

  /** Current Focus, Growth Areas, Core Values — one field at a time. */
  const saveAboutField = async (field: 'bio' | 'current_focus' | 'growth_areas' | 'values', value: string, label: string) => {
    const ok = await saveProfileFields({ [field]: value.trim() });
    if (ok) flash(value.trim() ? `${label} updated.` : `${label} cleared.`);
    return ok;
  };

  const saveInterests = async () => {
    const interests = interestsDraft.split(',').map((tag) => tag.trim()).filter(Boolean);
    if (await saveProfileFields({ interests })) {
      setEditingInterests(false);
      flash('Interests updated.');
    }
  };

  /**
   * Drafts, kept on this device.
   *
   * "Save as Draft" was a button with no handler. A draft now means what
   * it says: the unfinished entry is kept on this device, the form closes,
   * and it's all there again the next time you open it. It never leaves
   * the device until you actually save the entry — which is the point of
   * a draft in a private journal.
   */
  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(journalEntry));
      setShowJournalModal(false);
      flash('Draft kept on this device. Open "Write Journal" to pick it up.');
    } catch {
      setError('This browser would not keep the draft. Copy your text somewhere safe.');
    }
  };

  const openJournalModal = () => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setJournalEntry({ ...EMPTY_ENTRY, ...JSON.parse(saved) });
    } catch {
      // An unreadable draft is not worth blocking a new entry over.
    }
    setShowJournalModal(true);
  };

  const handleSaveJournal = async () => {
    if (!journalEntry.title || !journalEntry.content) {
      setError('A title and some words, please.');
      return;
    }

    setSaving(true);
    try {
      await post('/journal/', {
        title: journalEntry.title,
        content: journalEntry.content,
        mood: journalEntry.mood,
        visibility: journalEntry.visibility,
        tags: journalEntry.tags
          ? journalEntry.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [],
      });
      setShowJournalModal(false);
      setJournalEntry(EMPTY_ENTRY);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* nothing to clear */ }
      setError(null);
      flash('Entry saved.');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That entry did not save.');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = (type: 'profile' | 'cover') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (event: Event) => {
      // `event.target` is typed `EventTarget | null` on a bare DOM Event;
      // this listener is only ever attached to the input created above.
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const form = new FormData();
      form.append(type === 'profile' ? 'profile_image' : 'cover_image', file);

      try {
        // Uploaded and stored, not held as base64 in component state —
        // the old version lost the image on every refresh.
        const updated = await api<MyProfile>('/profile/', { method: 'PATCH', formData: form });
        setUserData((current) => ({
          ...current,
          avatarUrl: updated.avatar_url || current.avatarUrl,
          coverUrl: updated.coverUrl || current.coverUrl,
        }));
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'That image did not upload.');
      }
    };
    input.click();
  };

  const renderStatusBanner = () =>
    error || loading || saving || notice ? (
      <div
        role="status"
        className="mx-4 mb-2 rounded-lg px-3 py-2 text-sm"
        style={{
          backgroundColor: theme.surface,
          border: `1px solid ${notice && !error ? theme.secondary : theme.border}`,
          color: theme.text,
        }}
      >
        {error || (saving ? 'Saving…' : notice || 'Loading your profile…')}
      </div>
    ) : null;




  useEffect(() => {
    setHideExtra(true);
    return () => setHideExtra(false);
    // Runs once, on mount. `setHideExtra` is a setter owned by the
    // parent and stable in practice; listing it would re-run this
    // effect on every parent render, which is not what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ backgroundColor: theme.background, color: theme.text, fontFamily: "'Merriweather', sans-serif" }}>
      <div className='header px-3 py-4' style={{backgroundColor: theme.background}}>
        <ArrowLeft className='opacity-70 w-5 h-5 cursor-pointer' onClick={() => goBack(() => setActiveTab("Dashboard"))} />
      </div>
      {renderStatusBanner()}
      <div className="mx-auto p-4">
        
        <div className="grid grid-cols-1 gap-8">
          {/* Main Content */}
          <div className="space-y-6">
            {/* Hero Section */}
            <ProfileCard theme={theme}>
              <div className="relative">
                {/* Cover — full strength, fading into the card so the
                    name below always reads cleanly. */}
                <div
                  className="rounded-xl relative overflow-hidden"
                  style={{
                    height: '8.5rem',
                    backgroundColor: theme.background,
                    backgroundImage: coverImage
                      ? `linear-gradient(to bottom, transparent 45%, ${theme.surface}), url(${coverImage})`
                      : `linear-gradient(135deg, ${theme.accent}40, ${theme.secondary}33)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <button
                    onClick={() => handleImageUpload('cover')}
                    aria-label="Change cover photo"
                    title="Change cover photo"
                    className="absolute top-2 right-2 rounded-full flex items-center justify-center"
                    style={{ width: '2rem', height: '2rem', padding: 0, borderRadius: '9999px', background: 'rgba(0,0,0,0.45)', color: '#fff', border: 'none' }}
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>

                {/* Photo */}
                <div className="relative flex justify-center" style={{ marginTop: '-3rem' }}>
                  <div className="relative">
                    <div
                      className="rounded-full flex items-center justify-center font-bold relative overflow-hidden"
                      style={{
                        width: '6rem', height: '6rem', fontSize: '2rem',
                        border: `4px solid ${theme.surface}`,
                        backgroundColor: profileImage ? 'transparent' : theme.accent,
                        color: theme.background,
                        boxShadow: `0 8px 32px ${theme.accent}4d`,
                      }}
                    >
                      {profileImage ? (
                        <img
                          src={profileImage}
                          alt={userData.name}
                          onError={() => setBrokenAvatar(profileImage)}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        (userData.name || '?').trim().charAt(0).toUpperCase() || '?'
                      )}
                    </div>
                    <button
                      onClick={() => handleImageUpload('profile')}
                      aria-label="Change profile photo"
                      title="Change profile photo"
                      className="absolute rounded-full flex items-center justify-center hover:scale-110 transition-all"
                      style={{
                        right: 0, bottom: 0, width: '1.9rem', height: '1.9rem', padding: 0, borderRadius: '9999px',
                        backgroundColor: theme.secondary, border: `3px solid ${theme.surface}`, color: theme.text,
                      }}
                    >
                      <Camera className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Name, handle, tagline */}
                <div className="text-center mt-3">
                  <h3 className="text-2xl font-semibold leading-tight">{userData.name}</h3>
                  {userData.username && <p className="text-sm opacity-60 mt-0.5">@{userData.username}</p>}
                  {userData.title && <p className="text-sm opacity-90 mt-2 px-4">{userData.title}</p>}
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 mt-2 text-xs opacity-65">
                    {userData.location && (
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{userData.location}</span>
                    )}
                    {userData.joinDate && (
                      <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />Joined {userData.joinDate}</span>
                    )}
                  </div>
                </div>

                {/* The numbers people look for, in one strip */}
                <div
                  className="flex mt-4 rounded-xl"
                  style={{
                    backgroundColor: `${theme.accent}0f`, border: `1px solid ${theme.accent}26`,
                  }}
                >
                  {[
                    { value: userData.stats.totalEntries, label: 'Entries' },
                    { value: userData.followers, label: 'Followers' },
                    { value: userData.following, label: 'Following' },
                  ].map((item, index) => (
                    <div
                      key={item.label}
                      className="text-center py-3"
                      style={{ flex: 1, minWidth: 0, borderLeft: index ? `1px solid ${theme.accent}26` : 'none' }}
                    >
                      <div className="text-lg font-semibold" style={{ color: theme.accent }}>{item.value.toLocaleString()}</div>
                      <div className="text-xs opacity-65">{item.label}</div>
                    </div>
                  ))}
                </div>

                {/* Actions — icons only. Each says what it does on hover
                    and to screen readers; Write is the main one. */}
                <div className="flex items-center justify-center mt-5" style={{ gap: '0.9rem' }}>
                  {[
                    { label: 'Edit profile', icon: <UserPen className="w-5 h-5" />, onClick: () => onEditProfile?.() },
                    { label: 'Share profile', icon: <Share2 className="w-5 h-5" />, onClick: handleShareProfile },
                    { label: 'Write journal', icon: <NotebookPen className="w-6 h-6" />, onClick: openJournalModal, primary: true },
                    { label: 'View analytics', icon: <BarChart3 className="w-5 h-5" />, onClick: () => setActiveTab('Insights') },
                    { label: 'Find connections', icon: <UserPlus className="w-5 h-5" />, onClick: () => (onFindConnections ? onFindConnections() : setActiveTab('Community')) },
                  ].map((action) => (
                    <button
                      key={action.label}
                      onClick={action.onClick}
                      aria-label={action.label}
                      title={action.label}
                      className="rounded-full flex items-center justify-center transition-all hover:-translate-y-0.5 active:scale-95"
                      style={{
                        borderRadius: '9999px',
                        width: action.primary ? '3.5rem' : '2.75rem',
                        height: action.primary ? '3.5rem' : '2.75rem',
                        padding: 0,
                        flexShrink: 0,
                        backgroundColor: action.primary ? theme.accent : `${theme.accent}14`,
                        color: action.primary ? theme.background : theme.accent,
                        border: action.primary ? 'none' : `1px solid ${theme.accent}40`,
                        boxShadow: action.primary ? `0 6px 20px ${theme.accent}55` : 'none',
                      }}
                    >
                      {action.icon}
                    </button>
                  ))}
                </div>
              </div>
            </ProfileCard>

            {/* About Section */}
            <ProfileCard theme={theme} className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <p className="text-xl font-semibold flex items-center gap-2">
                  <Target className="w-6 h-6" style={{ color: theme.accent }} />
                  About Me
                </p>
              </div>

              {/* Each one edits in place: tap it, type, Enter (or Save). */}
              <div className="flex flex-col" style={{ gap: '0.75rem' }}>
                <AboutItem
                  theme={theme}
                  color={theme.secondary}
                  icon={<BookOpen className="w-4 h-4" />}
                  label="Bio"
                  value={userData.about}
                  prompt="A few lines about you and what you're working on."
                  example="A few lines about you"
                  multiline
                  max={2000}
                  onSave={(value) => saveAboutField('bio', value, 'Bio')}
                />
                <AboutItem
                  theme={theme}
                  color={theme.accent}
                  icon={<Target className="w-4 h-4" />}
                  label="Current Focus"
                  value={userData.currentFocus}
                  prompt="What are you working on in yourself right now?"
                  example="e.g. Sleeping before midnight"
                  onSave={(value) => saveAboutField('current_focus', value, 'Current focus')}
                />
                <AboutItem
                  theme={theme}
                  color={theme.secondary}
                  icon={<TrendingUp className="w-4 h-4" />}
                  label="Growth Areas"
                  value={userData.growthAreas}
                  prompt="Where would you like to grow?"
                  example="e.g. Patience, public speaking"
                  onSave={(value) => saveAboutField('growth_areas', value, 'Growth areas')}
                />
                <AboutItem
                  theme={theme}
                  color={theme.accent}
                  icon={<Heart className="w-4 h-4" />}
                  label="Core Values"
                  value={userData.values}
                  prompt="What matters most to you?"
                  example="e.g. Honesty, family, curiosity"
                  onSave={(value) => saveAboutField('values', value, 'Core values')}
                />
              </div>
            </ProfileCard>

            {/* Phone: stats & achievements (in Insights) sit above your journals. */}
            {isMobile && (
              <button
                onClick={onOpenInsights}
                className="w-full flex items-center gap-3 rounded-xl text-left"
                style={{
                  padding: '0.9rem 1rem',
                  background: `linear-gradient(135deg, ${theme.accent}22, ${theme.secondary}1a)`,
                  border: `1px solid ${theme.accent}44`,
                  color: theme.text,
                }}
              >
                <span className="text-2xl">🏅</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-sm">Stats & achievements</span>
                  <span className="block text-xs opacity-70 truncate">
                    {userData.recentAchievements.length > 0
                      ? `${userData.recentAchievements.length} earned · see them in Insights`
                      : 'Your journey stats and badges are in Insights'}
                  </span>
                </span>
                <span style={{ color: theme.accent }}>›</span>
              </button>
            )}

            {/* My Top Journals — your most-loved shared entries, ranked. */}
            <ProfileCard theme={theme}>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: '2.5rem', height: '2.5rem', borderRadius: '0.75rem', backgroundColor: `${theme.secondary}22` }}
                  >
                    <BookOpen className="w-5 h-5" style={{ color: theme.secondary }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-lg leading-tight whitespace-nowrap">My Top Journals</h3>
                    <p className="text-xs opacity-60 truncate">Your most-loved shared entries</p>
                  </div>
                </div>
                <button
                  onClick={() => setActiveTab('Journal')}
                  aria-label="Manage your journal"
                  title="Manage your journal"
                  className="flex items-center gap-1 flex-shrink-0 text-sm font-medium transition-all hover:gap-2"
                  style={{
                    padding: '0.45rem 0.85rem', borderRadius: '9999px',
                    backgroundColor: `${theme.accent}14`, border: `1px solid ${theme.accent}40`, color: theme.accent,
                  }}
                >
                  Manage <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {userData.topJournals.length === 0 && (
                <div className="text-center rounded-xl py-8 px-4" style={{ border: `1px dashed ${theme.border}` }}>
                  <p className="text-3xl mb-2">📝</p>
                  <p className="text-sm opacity-75 mb-3">Share an entry and the ones people love most show up here.</p>
                  <button
                    onClick={openJournalModal}
                    className="text-sm font-medium"
                    style={{ padding: '0.5rem 1.1rem', borderRadius: '9999px', backgroundColor: theme.accent, color: theme.background, border: 'none' }}
                  >
                    Write an entry
                  </button>
                </div>
              )}

              <div className="flex flex-col" style={{ gap: '0.9rem' }}>
                {userData.topJournals.map((journal, index) => {
                  const rankColor = index === 0 ? theme.accent : theme.secondary;
                  return (
                    <div
                      key={journal.id}
                      className="relative rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg overflow-hidden"
                      style={{
                        padding: '1rem 1rem 0.85rem 1.15rem',
                        backgroundColor: index === 0 ? `${theme.accent}10` : `${theme.secondary}12`,
                        border: `1px solid ${rankColor}2e`,
                      }}
                    >
                      {/* Rank edge */}
                      <span aria-hidden="true" className="absolute left-0 top-0 bottom-0" style={{ width: '4px', backgroundColor: rankColor }} />

                      <div className="flex items-start gap-3">
                        <div
                          className="flex items-center justify-center flex-shrink-0 text-xl"
                          style={{ width: '2.6rem', height: '2.6rem', borderRadius: '0.8rem', backgroundColor: `${rankColor}22` }}
                        >
                          {journal.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="font-semibold text-base leading-snug break-words">{journal.title}</h4>
                            <span
                              className="flex-shrink-0 text-xs font-bold"
                              style={{ padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: `${rankColor}26`, color: rankColor }}
                            >
                              #{index + 1}
                            </span>
                          </div>
                          <p className="text-xs opacity-55 mt-0.5">{journal.date}</p>
                        </div>
                      </div>

                      <p
                        className="text-sm leading-relaxed opacity-85 mt-3"
                        style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {journal.excerpt}
                      </p>

                      {journal.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {journal.tags.slice(0, 4).map((tag) => (
                            <span
                              key={tag}
                              className="text-xs font-medium"
                              style={{ padding: '0.15rem 0.6rem', borderRadius: '9999px', backgroundColor: `${theme.secondary}22`, color: theme.secondary }}
                            >
                              #{tag.replace(/^#/, '')}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${theme.border}` }}>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="flex items-center gap-1.5" title="Reactions">
                            <Heart className="w-4 h-4" style={{ color: theme.accent }} />
                            <span className="font-medium">{journal.interactions.reactions}</span>
                          </span>
                          <span className="flex items-center gap-1.5 opacity-80" title="Comments">
                            <MessageCircle className="w-4 h-4" />
                            <span className="font-medium">{journal.interactions.comments}</span>
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {[
                            { label: 'Edit entry', icon: <Edit3 className="w-4 h-4" />, action: 'edit' as const },
                            { label: 'Share entry', icon: <Share2 className="w-4 h-4" />, action: 'share' as const },
                          ].map((item) => (
                            <button
                              key={item.label}
                              aria-label={item.label}
                              title={item.label}
                              onClick={() => onOpenJournalEntry ? onOpenJournalEntry(journal.id, item.action) : setActiveTab('Journal')}
                              className="flex items-center justify-center transition-all hover:scale-105"
                              style={{
                                width: '2.2rem', height: '2.2rem', padding: 0, borderRadius: '9999px',
                                backgroundColor: `${theme.accent}12`, border: `1px solid ${theme.accent}40`, color: theme.accent,
                              }}
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

          {/* Sidebar */}
          <div className="space-y-6">
            {/* On a phone, Journey Stats and Achievements live in Insights
                and My Interests is left out, to keep Profile short. */}
            {!isMobile && (
              <>
            {/* Journey Stats */}
            <ProfileCard theme={theme}>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <TrendingUp className="w-4 h-4" style={{ color: theme.accent }} />
                My Journey Stats
              </h3>
              <div className="grid !grid-cols-2 !gap-3">
                <StatCard 
                  icon={<BookOpen />}
                  label="Total Entries"
                  value={userData.stats.totalEntries}
                  color={theme.secondary}
                  bgColor={`${theme.secondary}15`}
                  onClick={() => setActiveTab?.('Journal')}
                />
                <StatCard 
                  icon="🔥"
                  label="Current Streak"
                  value={`${userData.stats.streakDays}`}
                  color={theme.accent}
                  bgColor={`${theme.accent}15`}
                  onClick={() => setActiveTab?.('Journal')}
                />
                {/* Both of these are real counts now.
                    'Total Reactions' is hearts other people left on this
                    user's posts, comments and shared entries — their own
                    don't count, because a number you can raise yourself
                    isn't worth showing.
                    'Profile Views' only exists when the user has the
                    setting on, and the setting is reciprocal: with it off
                    nothing is recorded about who looked at them *and*
                    nothing is recorded about the profiles they look at.
                    So with it off the tile offers the setting rather than
                    showing a zero that would look like nobody visited. */}
                <StatCard 
                  icon={<Heart />}
                  label="Total Reactions"
                  value={userData.stats.totalReactions.toLocaleString()}
                  color={theme.secondary}
                  bgColor={`${theme.secondary}15`}
                  onClick={() => setActiveTab?.('Community')}
                />
                {userData.stats.showProfileViews ? (
                  <StatCard
                    icon={<Eye />}
                    label="Profile Views (30 days)"
                    value={userData.stats.profileViews.toLocaleString()}
                    color={theme.accent}
                    bgColor={`${theme.accent}15`}
                    onClick={() => setActiveTab?.('Settings')}
                  />
                ) : (
                  <StatCard
                    icon={<Eye />}
                    label="Profile Views"
                    value="Off"
                    color={theme.accent}
                    bgColor={`${theme.accent}15`}
                    onClick={() => setActiveTab?.('Settings')}
                  />
                )}
              </div>
            </ProfileCard>

            {/* Recent Achievements */}
            <ProfileCard theme={theme}>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Award className="w-5 h-5" style={{ color: theme.accent }} />
                Recent Achievements
              </h3>
              <div className="space-y-3">
                {userData.recentAchievements.length === 0 && (
                  <p className="text-sm opacity-60">
                    Nothing earned yet. Badges appear here once you've actually
                    earned them — never before.
                  </p>
                )}
                {userData.recentAchievements.map((achievement) => (
                  <div 
                    key={achievement.slug}
                    title={achievement.description}
                    className="flex items-center gap-3 p-3 rounded-lg transition-all"
                    style={{ backgroundColor: `${theme.accent}10` }}
                  >
                    <span className="text-2xl">{achievement.icon}</span>
                    <div>
                      <p className="font-medium text-sm">{achievement.name}</p>
                      {/* The date it was earned, because a badge is a
                          record of something you did, not a status you
                          currently hold. */}
                      <p className="text-xs opacity-60">Earned {achievement.earned}</p>
                    </div>
                  </div>
                ))}

                {/* What's within reach — the next one per metric only.
                    A full list of everything unearned reads as a list of
                    ways you're falling short. */}
                {userData.achievementProgress.length > 0 && (
                  <div className="pt-2">
                    <p className="text-xs uppercase tracking-wide opacity-50 mb-2">
                      Within reach
                    </p>
                    {userData.achievementProgress.map((next) => (
                      <div key={next.slug} className="mb-3" title={next.description}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="opacity-80">{next.icon} {next.name}</span>
                          <span className="opacity-60">{next.current} / {next.threshold}</span>
                        </div>
                        <div
                          className="h-1.5 rounded-full overflow-hidden"
                          style={{ backgroundColor: `${theme.accent}20` }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${next.percent}%`, backgroundColor: theme.accent }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ProfileCard>

              </>
            )}

            {!isMobile && (<>
            {/* Favorite Topics */}
            <ProfileCard theme={theme}>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5" style={{ color: theme.accent }} />
                My Interests
              </h3>
              <div className="flex flex-wrap gap-2">
                {userData.favoriteTopics.map((topic) => (
                  <span 
                    key={topic}
                    className="px-3 py-2 rounded-full text-sm font-medium transition-all"
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
              {editingInterests ? (
                <div className="flex flex-col gap-2 mt-4">
                  <input
                    autoFocus
                    value={interestsDraft}
                    onChange={(e) => setInterestsDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveInterests(); }}
                    placeholder="mindfulness, sleep, gratitude"
                    className="w-full p-2 rounded-lg border text-sm"
                    style={{ backgroundColor: theme.background, borderColor: theme.border, color: theme.text }}
                  />
                  <p className="text-xs opacity-60">Separate interests with commas.</p>
                  <div className="flex gap-2 justify-end">
                    <Button theme={theme} variant="outline" size="sm" onClick={() => setEditingInterests(false)}>Cancel</Button>
                    <Button theme={theme} variant="primary" size="sm" onClick={saveInterests}>{savingField ? 'Saving…' : 'Save'}</Button>
                  </div>
                </div>
              ) : (
                <Button theme={theme}
                  variant="outline"
                  size="sm"
                  className="w-full mt-4 flex justify-center items-center gap-2"
                  onClick={() => { setInterestsDraft(userData.favoriteTopics.join(', ')); setEditingInterests(true); }}
                >
                  <Edit3 className="w-4 h-4 mr-2" />
                  {userData.favoriteTopics.length ? 'Edit Interests' : 'Add Interests'}
                </Button>
              )}
            </ProfileCard>
            </>)}
          </div>
        </div>
      </div>

      {/* Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-10 flex items-center justify-center p-4 z-50">
          <div 
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-auto"
            style={{ backgroundColor: theme.surface, color: theme.text }}
          >
            <div className="p-6 border-b" style={{ borderColor: theme.border }}>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <BookOpen className="w-6 h-6" style={{ color: theme.accent }} />
                  New Journal Entry
                </h2>
                <button 
                  onClick={() => setShowJournalModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Emoji and Title */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Mood</label>
                  <select 
                    value={journalEntry.mood}
                    onChange={(e) => setJournalEntry({ ...journalEntry, mood: e.target.value })}
                    className="w-full p-3 rounded-lg border transition-all"
                    style={{ 
                      backgroundColor: theme.background, 
                      borderColor: theme.border,
                      color: theme.text
                    }}
                  >
                    <option value="">— none —</option>
                    {MOODS.map((mood) => (
                      <option key={mood.value} value={mood.value}>{mood.emoji} {mood.value}</option>
                    ))}
                  </select>
                </div>
                
                <div className="md:col-span-3">
                  <label className="block text-sm font-medium mb-2">Title</label>
                  <input
                    type="text"
                    value={journalEntry.title}
                    onChange={(e) => setJournalEntry({...journalEntry, title: e.target.value})}
                    placeholder="What's on your mind today?"
                    className="w-full p-3 rounded-lg border transition-all focus:ring-2"
                    style={{ 
                      backgroundColor: theme.background, 
                      borderColor: theme.border,
                      color: theme.text,
                    }}
                  />
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="block text-sm font-medium mb-2">Your thoughts</label>
                <textarea
                  value={journalEntry.content}
                  onChange={(e) => setJournalEntry({...journalEntry, content: e.target.value})}
                  placeholder="Express yourself freely... What happened today? How are you feeling? What are you learning?"
                  rows={8}
                  className="w-full p-4 rounded-lg border transition-all focus:ring-2 resize-none"
                  style={{ 
                    backgroundColor: theme.background, 
                    borderColor: theme.border,
                    color: theme.text,
                  }}
                />
                <div className="text-sm opacity-60 mt-2">
                  {journalEntry.content.length} characters
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium mb-2">Tags (optional)</label>
                <input
                  type="text"
                  value={journalEntry.tags}
                  onChange={(e) => setJournalEntry({...journalEntry, tags: e.target.value})}
                  placeholder="mindfulness, growth, gratitude (separate with commas)"
                  className="w-full p-3 rounded-lg border transition-all focus:ring-2"
                  style={{ 
                    backgroundColor: theme.background, 
                    borderColor: theme.border,
                    color: theme.text,
                  }}
                />
              </div>

              {/* Privacy Settings */}
              <div className="p-4 rounded-lg" style={{ backgroundColor: `${theme.accent}10`, border: `1px solid ${theme.accent}20` }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">Who can see this</span>
                  <select
                    value={journalEntry.visibility}
                    onChange={(e) => setJournalEntry({ ...journalEntry, visibility: e.target.value })}
                    className="px-3 py-1 rounded-lg border text-sm"
                    style={{ backgroundColor: theme.background, borderColor: theme.border, color: theme.text }}
                  >
                    <option value="private">Only me</option>
                    <option value="connections">My connections</option>
                    <option value="community">Everyone on SoulLog</option>
                  </select>
                </div>
                {/* The old switch here said "Public entries can be seen by
                    your followers" and wasn't connected to anything. These
                    are the app's three real levels, and the choice is saved. */}
                <p className="text-sm opacity-75">
                  {journalEntry.visibility === 'private' && 'Private. Nobody else can see this entry.'}
                  {journalEntry.visibility === 'connections' && 'Visible to people you have connected with. Following you is not enough.'}
                  {journalEntry.visibility === 'community' && 'Visible to anyone signed in to SoulLog, who can also comment unless you turn comments off.'}
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t flex gap-3 justify-end" style={{ borderColor: theme.border }}>
              <Button theme={theme} variant="outline" onClick={() => setShowJournalModal(false)}>
                Cancel
              </Button>
              <Button theme={theme} variant="secondary" onClick={saveDraft}>
                Save as Draft
              </Button>
              <Button theme={theme} variant="primary" onClick={handleSaveJournal}>
                <BookOpen className="w-4 h-4 mr-2" />
                {journalEntry.visibility === 'private' ? 'Save Entry' : 'Publish Entry'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};


/**
 * One line of About Me (Current Focus, Growth Areas, Core Values).
 *
 * These used to be labels with nothing you could do to them. Now the card
 * is the button: tap it to edit in place, Enter or Save to keep, Escape or
 * Cancel to leave it. An empty one asks its question instead of showing a
 * blank line.
 */
const ABOUT_MAX = 200;

const AboutItem = ({
  theme, color, icon, label, value, prompt, example, onSave, multiline = false, max = ABOUT_MAX,
}: {
  multiline?: boolean;
  max?: number;
  theme: Theme;
  color: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  prompt: string;
  example: string;
  onSave: (value: string) => Promise<boolean>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(value);
    setEditing(true);
  };
  const save = async () => {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    if (ok) setEditing(false);
  };

  const box = {
    backgroundColor: `${color}15`,
    border: `1px solid ${editing ? color : `${color}30`}`,
  };

  if (editing) {
    return (
      <div className="p-3 rounded-lg text-left" style={box}>
        <p className="font-medium text-xs mb-2 flex items-center gap-2" style={{ color }}>
          {icon}
          <span style={{ color: theme.text }}>{label}</span>
        </p>
{multiline ? (
          <textarea
            autoFocus
            value={draft}
            maxLength={max}
            rows={4}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter makes a new line here; Ctrl/Cmd+Enter saves.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={example}
            aria-label={label}
            className="w-full p-2.5 rounded-lg border text-sm outline-none resize-none"
            style={{ backgroundColor: theme.background, borderColor: theme.border, color: theme.text }}
          />
        ) : (
        <input
            autoFocus
            value={draft}
            maxLength={max}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); save(); }
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={example}
            aria-label={label}
            className="w-full p-2.5 rounded-lg border text-sm outline-none"
            style={{ backgroundColor: theme.background, borderColor: theme.border, color: theme.text }}
          />
        )}
        <div className="flex items-center justify-between gap-2 mt-2">
          <span className="text-xs opacity-50">{draft.length}/{max}</span>
          <div className="flex gap-2">
            <Button theme={theme} variant="outline" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
            <Button theme={theme} variant="primary" size="sm" onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      className="group w-full flex items-center gap-3 rounded-lg text-left transition-all hover:-translate-y-0.5"
      style={{ ...box, color: theme.text, padding: '0.75rem' }}
      aria-label={`Edit ${label}`}
    >
      <span className="flex-shrink-0 flex" style={{ color }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-xs mb-0.5">{label}</span>
        {value ? (
          <span className="block text-sm opacity-85 break-words whitespace-pre-line">{value}</span>
        ) : (
          <span className="block text-xs opacity-55 italic">{prompt} Tap to add.</span>
        )}
      </span>
      <Edit3 className="w-3.5 h-3.5 flex-shrink-0 opacity-40 group-hover:opacity-90 transition-opacity" />
    </button>
  );
};

export default SoulLogOwnProfile;
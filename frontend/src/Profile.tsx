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

import React, { useCallback, useEffect, useState } from 'react';
import { Camera, MapPin, Calendar, MessageCircle, Users, Heart, Share2, Award, BookOpen, Target, TrendingUp, Sparkles, Edit3, Eye, MoreHorizontal, ArrowLeft } from 'lucide-react';
import { ApiError, api, get, post } from './api';
import type { Theme } from './theme';
import type {
  Achievement,
  AchievementProgress,
  JournalEntry,
  JournalStats,
  MyProfile,
  Paginated,
} from './types';

interface ProfilePageProps {
  theme: Theme;
  darkMode?: boolean;
  /**
   * Both are called unguarded below, so they are required here rather
   * than optional — the screen has never worked without them.
   */
  setActiveTab: (tab: string) => void;
  setHideExtra: (hide: boolean) => void;
}

/** One card in "My Top Journals", built from the user's own entries. */
interface TopJournal {
  id: number;
  title: string;
  excerpt: string;
  date: string;
  emoji: string;
  tags: string[];
  interactions: { views: number; reactions: number; comments: number };
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

const SoulLogOwnProfile = ({ theme, setActiveTab, setHideExtra }: ProfilePageProps) => {
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [journalEntry, setJournalEntry] = useState({
    title: '',
    content: '',
    emoji: '📝',
    tags: '',
    mood: 'neutral'
  });

  const [userData, setUserData] = useState(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const profileImage = userData.avatarUrl;
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
      // engagement numbers beside them would always be zero.
      const shared: TopJournal[] = entries
        .filter((entry) => entry.visibility !== 'private')
        .slice(0, 5)
        .map((entry) => ({
          id: entry.id,
          title: entry.title || (entry.content || '').slice(0, 60),
          excerpt: (entry.content || '').slice(0, 160),
          date: new Date(entry.created_at).toLocaleDateString(),
          emoji: entry.entry_type === 'voice' ? '🎙️' : entry.entry_type === 'photo' ? '📷' : '📝',
          tags: entry.tags || [],
          interactions: { views: 0, reactions: 0, comments: 0 },
          isHighlighted: false,
        }));

      setUserData({
        name: profile.name || profile.username,
        username: profile.username,
        title: profile.current_focus || '',
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
        tags: journalEntry.tags
          ? journalEntry.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : [],
      });
      setShowJournalModal(false);
      setJournalEntry({ title: '', content: '', emoji: '📝', tags: '', mood: 'neutral' });
      setError(null);
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

  const StatusBanner = () =>
    error || loading || saving ? (
      <div
        className="mx-4 mb-2 rounded-lg px-3 py-2 text-sm"
        style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, color: theme.text }}
      >
        {error || (saving ? 'Saving…' : 'Loading your profile…')}
      </div>
    ) : null;

  const ProfileCard = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
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
        <ArrowLeft className='opacity-70 w-5 h-5 cursor-pointer' onClick={() => setActiveTab("Accounts")} />
      </div>
      <StatusBanner />
      <div className="mx-auto p-4">
        
        <div className="grid grid-cols-1 gap-8">
          {/* Main Content */}
          <div className="space-y-6">
            {/* Hero Section */}
            <ProfileCard>
              <div className="relative">
                {/* Cover Image */}
                <div 
                  className="h-35 rounded-xl mb-6 relative overflow-hidden flex items-center justify-center opacity-50"
                  style={{ 
                    background: coverImage ? `url(${coverImage})` : theme.background,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center'
                  }}
                >
                  <Button variant="outline" size="sm" className="absolute top-2 right-2 bg-black bg-opacity-30 text-white !text-xs" onClick={() => handleImageUpload('cover')}>
                    <Camera className="w-3 h-3" />
                    Edit
                  </Button>
                </div>

                {/* Profile Picture */}
                <div className="relative mb-4 -mt-16 flex justify-center">
                  <div className="relative">
                    <div 
                      className="w-20 h-20 rounded-full border-4 flex items-center justify-center text-lg font-bold relative overflow-hidden"
                      style={{ 
                        backgroundColor: profileImage ? 'transparent' : theme.accent, 
                        borderColor: theme.surface,
                        color: theme.text,
                        boxShadow: `0 8px 32px rgba(207, 174, 97, 0.3)`,
                        backgroundImage: profileImage ? `url(${profileImage})` : 'none',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center'
                      }}
                    >
                      {!profileImage && (
                        (userData.name || '?').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    
                    <div 
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center border-2 cursor-pointer hover:scale-110 transition-all"
                      style={{ 
                        backgroundColor: theme.secondary,
                        borderColor: theme.surface,
                        color: theme.text
                      }}
                      onClick={() => handleImageUpload('profile')}
                    >
                      <Camera className="w-3 h-3" />
                    </div>
                  </div>
                </div>

                {/* Profile Info */}
                <div className="text-center">
                  <div className="flex flex-col justify-center items-center mb-4 gap-3">
                    <h3 className="text-xl font-normal">
                      {userData.name}
                    </h3>
                    
                    <p className="text-sm opacity-90 flex items-start justify-center">
                      {userData.title}
                    </p>
                    
                    <div className="flex flex-wrap items-center justify-center lg:justify-start gap-4 text-sm opacity-75">
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
                        <Users className="w-4 h-4" />
                        {userData.following.toLocaleString()} following
                      </div>
                    </div>

                    <div className='flex gap-2 w-full'>
                      <Button className="flex justify-center items-center gap-2 w-full" variant="outline" size="sm" onClick={() => {}}>
                        <Edit3 className="w-4 h-4 mr-2" />
                        Edit Profile
                      </Button>
                      <Button className="w-full" variant="outline">
                        <Share2 className="w-4 h-4 mr-2" />
                        Share Profile
                      </Button>
                    </div>
                    
                  </div>

                  {/* Action Buttons */}
                  <div className="grid grid-cols-1 !gap-3 md:!grid-cols-3">
                    <Button variant="primary" onClick={() => setShowJournalModal(true)}>
                      <BookOpen className="w-4 h-4 mr-2" />
                      Write Journal
                    </Button>
                    <Button variant="secondary">
                      <TrendingUp className="w-4 h-4 mr-2" />
                      View Analytics
                    </Button>
                    <Button variant="outline">
                      <TrendingUp className="w-4 h-4 mr-2" />
                      Find Connections
                    </Button>
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* About Section */}
            <ProfileCard className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <p className="text-xl font-semibold flex items-center gap-2">
                  <Target className="w-6 h-6" style={{ color: theme.accent }} />
                  About Me
                </p>
                <Button variant="ghost" size="sm" onClick={() => {}}>
                  <Edit3 className="w-4 h-4" />
                </Button>
              </div>
              
              <div className="relative p-6 rounded-xl" style={{ backgroundColor: `${theme.accent}10`, border: `1px solid ${theme.accent}20` }}>
                <p className="leading-relaxed text-md">
                  {userData.about}
                </p>
              </div>

              <div className="grid grid-cols-1 !gap-5">
                <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                  <Target className="w-4 h-4 flex-shrink-0" style={{ color: theme.accent }} />
                  <div className="min-w-0">
                    <p className="font-medium text-xs mb-0.5">Current Focus</p>
                    <p className="text-xs opacity-75 truncate">{userData.currentFocus}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: `${theme.secondary}15`, border: `1px solid ${theme.secondary}30` }}>
                  <TrendingUp className="w-4 h-4 flex-shrink-0" style={{ color: theme.secondary }} />
                  <div className="min-w-0">
                    <p className="font-medium text-xs mb-0.5">Growth Areas</p>
                    <p className="text-xs opacity-75 truncate">{userData.growthAreas}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg" style={{ backgroundColor: `${theme.accent}15`, border: `1px solid ${theme.accent}30` }}>
                  <Heart className="w-4 h-4 flex-shrink-0" style={{ color: theme.accent }} />
                  <div className="min-w-0">
                    <p className="font-medium text-xs mb-0.5">Core Values</p>
                    <p className="text-xs opacity-75 truncate">{userData.values}</p>
                  </div>
                </div>
              </div>
            </ProfileCard>

            {/* My Top Journals */}
            <ProfileCard>
              <div className="flex items-center justify-between mb-5">

                <h3 className="font-semibold mb-3 text-lg flex items-center gap-2">
                  <BookOpen className="w-6 h-6" style={{ color: theme.secondary }} />
                  My Top Journals
                </h3>
                <Button variant="outline" size="sm">
                  Manage Posts
                </Button>
              </div>
              
              <div className="space-y-5">
                {userData.topJournals.map((journal) => (
                  <div 
                    key={journal.id}
                    className={`relative p-5 rounded-xl transition-all duration-300 hover:shadow-lg hover:scale-[1.02]`} 
                    style={{ 
                      backgroundColor: journal.isHighlighted ? `${theme.accent}12` : `${theme.secondary}20`,
                      border: `1px solid ${theme.surface}20`,
                    }}
                  >
                    {journal.isHighlighted && (
                      <div className="absolute top-1 right-1">
                        <div 
                          className="px-2 py-1 rounded-full text-xs font-bold flex items-center gap-1"
                          style={{ backgroundColor: theme.accent, color: theme.text }}
                        >
                          ⭐ Featured
                        </div>
                      </div>
                    )}
                    
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 flex-1">
                        <span className="text-3xl">{journal.emoji}</span>
                        <div className="flex-1">
                          <h3 className="font-semibold text-xl mb-1">{journal.title}</h3>
                          <span className="text-sm opacity-60">{journal.date}</span>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="opacity-50 hover:opacity-100">
                        <MoreHorizontal className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    <p className="text-base leading-relaxed mb-4 opacity-90">{journal.excerpt}</p>
                    
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex flex-wrap gap-2">
                        {journal.tags.map((tag) => (
                          <span 
                            key={tag}
                            className="px-3 py-1 rounded-full text-sm font-medium transition-all hover:scale-105 cursor-pointer"
                            style={{ backgroundColor: `${theme.secondary}25`, color: theme.secondary }}
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    {/* Performance Stats */}
                    <div className="flex items-center justify-between pt-4 border-t" style={{ borderColor: theme.border }}>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="flex items-center gap-1">
                          <Eye className="w-4 h-4 opacity-75" />
                          <span className="font-medium">{journal.interactions.views.toLocaleString()}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Heart className="w-4 h-4 opacity-75" style={{ color: theme.accent }} />
                          <span className="font-medium">{journal.interactions.reactions}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <MessageCircle className="w-4 h-4 opacity-75" />
                          <span className="font-medium">{journal.interactions.comments}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm">
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <Share2 className="w-4 h-4" />
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
            {/* Journey Stats */}
            <ProfileCard>
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
            <ProfileCard>
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
                    className="flex items-center gap-3 p-3 rounded-lg transition-all hover:scale-105 cursor-pointer"
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

            {/* Favorite Topics */}
            <ProfileCard>
              <h3 className="font-semibold mb-4 text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5" style={{ color: theme.accent }} />
                My Interests
              </h3>
              <div className="flex flex-wrap gap-2">
                {userData.favoriteTopics.map((topic) => (
                  <span 
                    key={topic}
                    className="px-3 py-2 rounded-full text-sm font-medium cursor-pointer transition-all hover:scale-110"
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
              <Button variant="outline" size="sm" className="w-full mt-4 flex justify-center items-center gap-2" onClick={() => {}}>
                <Edit3 className="w-4 h-4 mr-2" />
                Edit Interests
              </Button>
            </ProfileCard>
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
                    value={journalEntry.emoji}
                    onChange={(e) => setJournalEntry({...journalEntry, emoji: e.target.value})}
                    className="w-full p-3 text-2xl text-center rounded-lg border transition-all"
                    style={{ 
                      backgroundColor: theme.background, 
                      borderColor: theme.border,
                      color: theme.text
                    }}
                  >
                    <option value="📝">📝 Reflective</option>
                    <option value="😊">😊 Happy</option>
                    <option value="🌅">🌅 Peaceful</option>
                    <option value="💭">💭 Thoughtful</option>
                    <option value="🌱">🌱 Growing</option>
                    <option value="⭐">⭐ Inspired</option>
                    <option value="🔥">🔥 Motivated</option>
                    <option value="🧠">🧠 Learning</option>
                    <option value="❤️">❤️ Grateful</option>
                    <option value="🌈">🌈 Hopeful</option>
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
                  <span className="font-medium">Privacy Settings</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm opacity-75">Public</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                    <span className="text-sm opacity-75">Private</span>
                  </div>
                </div>
                <p className="text-sm opacity-75">
                  Public entries can be seen by your followers and may appear in community feeds.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t flex gap-3 justify-end" style={{ borderColor: theme.border }}>
              <Button variant="outline" onClick={() => setShowJournalModal(false)}>
                Cancel
              </Button>
              <Button variant="secondary">
                Save as Draft
              </Button>
              <Button variant="primary" onClick={handleSaveJournal}>
                <BookOpen className="w-4 h-4 mr-2" />
                Publish Entry
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SoulLogOwnProfile;
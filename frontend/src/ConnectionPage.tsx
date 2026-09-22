/**
 * Connections ("Souls").
 *
 * The layout, class names and styling below are unchanged — this screen
 * was already designed. What changed is everything underneath it: the
 * three tabs used to render hardcoded arrays (24 invented suggestions, 18
 * invented friends), the four filters filtered fake data, and every
 * button was decorative. All of it is now real.
 *
 * Two notes on the filters, because they are the part where it would be
 * easy to look real without being real:
 *
 *   Location  "Same city" sends the caller's own location, so it means
 *             something specific rather than being a mood. If the user
 *             hasn't set a location, the option is disabled rather than
 *             silently matching nothing.
 *   Interests The options come from the topics the backend actually
 *             knows, not a list typed into this file that could drift
 *             away from the data.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, UserPlus, Check, X, MessageCircle, MoreHorizontal, Users, Bell, Heart, Filter } from 'lucide-react';
import { ApiError, del, get, post, type PublicUser } from './api';
import { Avatar } from './ui';
import { relativeTime } from './time';
import type { Theme } from './theme';
import type { MyProfile } from './types';

interface ConnectionsPageProps {
  theme: Theme;
  darkMode?: boolean;
  isMobile?: boolean;
  setHideExtra?: (hidden: boolean) => void;
  setDarkMode?: (dark: boolean) => void;
  setActiveTab?: (tab: string) => void;
  onOpenConversation?: (userId: number) => void;
  onViewProfile?: (username: string) => void;
  /** Which list to open on (e.g. Requests, from a notification). */
  initialTab?: Tab;
  /** Called after answering a request, so badges elsewhere update. */
  onRequestsChanged?: () => void;
}

type Tab = 'suggestions' | 'requests' | 'friends';

/**
 * The two card components below take a person and the list they were
 * found in; the list decides which action button is drawn.
 */
type CardType = 'suggestion' | 'request' | 'friend';

interface UserCardProps {
  user: PublicUser;
  type: CardType;
}


const ConnectionsPage = ({ theme, darkMode, onOpenConversation, onViewProfile, initialTab, onRequestsChanged }: ConnectionsPageProps) => {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? 'suggestions');

  // The "⋯" menu on a friend's card: which card it's open on, and whether
  // "Remove friend" has been tapped once (it asks before removing).
  const [friendMenu, setFriendMenu] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const friendMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (friendMenu === null) return;
    const close = (event: MouseEvent | TouchEvent) => {
      if (friendMenuRef.current?.contains(event.target as Node)) return;
      setFriendMenu(null);
      setConfirmRemove(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [friendMenu]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode] = useState<'grid' | 'list'>('grid');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    location: '',
    mutualFriends: '',
    interests: '',
    activity: '',
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  // The filter panel behaves like a popover: a click anywhere outside it
  // (or Escape) closes it and throws away choices that weren't applied —
  // the same as pressing Cancel. The Filter button is excluded so that
  // clicking it toggles instead of closing and instantly reopening.
  const filterPanelRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeFilters = useCallback(() => {
    setFilters(appliedFilters);
    setShowFilters(false);
  }, [appliedFilters]);

  useEffect(() => {
    if (!showFilters) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (filterPanelRef.current?.contains(target)) return;
      if (filterButtonRef.current?.contains(target)) return;
      closeFilters();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFilters();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showFilters, closeFilters]);

  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const [requests, setRequests] = useState<PublicUser[]>([]);
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [topics, setTopics] = useState<{ id: string; label: string }[]>([]);
  const [myLocation, setMyLocation] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const suggestionQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (appliedFilters.location === 'same-city' && myLocation) params.set('location', myLocation);
    if (appliedFilters.interests) params.set('interests', appliedFilters.interests);
    if (appliedFilters.activity) params.set('activity', appliedFilters.activity);
    if (appliedFilters.mutualFriends) params.set('mutualFriends', appliedFilters.mutualFriends);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : '';
  }, [appliedFilters, searchQuery, myLocation]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [suggested, incoming, connected] = await Promise.all([
        get<PublicUser[]>(`/social/suggestions/${suggestionQuery}`),
        get<PublicUser[]>('/social/requests/?direction=incoming'),
        get<PublicUser[]>('/social/connections/'),
      ]);
      setSuggestions(suggested);
      setRequests(incoming);
      setFriends(connected);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your connections.');
    } finally {
      setLoading(false);
    }
  }, [suggestionQuery]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Loaded once: these feed the filter dropdowns, not the results.
    (async () => {
      try {
        const [me, topicList] = await Promise.all([
          get<MyProfile>('/profile/'),
          get<{ id: string; label: string }[]>('/community/topics/'),
        ]);
        setMyLocation(me?.location || '');
        setTopics(topicList);
      } catch {
        // The filters degrade to their defaults; the page still works.
      }
    })();
  }, []);

  const markBusy = (id: number, value: boolean) =>
    setBusy((current) => ({ ...current, [id]: value }));

  const act = async (id: number, action: () => Promise<unknown>) => {
    if (busy[id]) return;
    markBusy(id, true);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      markBusy(id, false);
    }
  };

  const sendRequest = (user: PublicUser) =>
    act(user.id, () => post('/social/requests/create/', { user_id: user.id }));

  const respond = async (user: PublicUser, action: 'accept' | 'decline') => {
    await act(user.id, () => post(`/social/requests/${user.connection_id}/respond/`, { action }));
    onRequestsChanged?.();
  };

  const removeConnection = (user: PublicUser) =>
    act(user.id, () => del(`/social/connections/${user.id}/`));

  const dismissSuggestion = (user: PublicUser) => {
    // Local-only: there is no "not interested" record on the server, so
    // this hides the card for now rather than pretending to remember a
    // preference that isn't stored anywhere.
    setSuggestions((current) => current.filter((row) => row.id !== user.id));
  };

  const message = async (user: PublicUser) => {
    try {
      const conversation = await post<{ id: number }>('/messages/conversations/', {
        user_id: user.id,
      });
      onOpenConversation?.(conversation.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that conversation.');
    }
  };

  // Presence dot colour, from real presence rather than a random status.
  const statusColour = (user: PublicUser) => {
    if (user.presence === 'active') return 'bg-green-500';
    if (user.presence === 'away') return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  const subtitleFor = (user: PublicUser, type: string) => {
    if (type === 'friend') return user.presence_label || 'Connected';
    if (type === 'request') return user.requested_at ? relativeTime(user.requested_at) : '';
    const mutual = user.mutual_connections ?? 0;
    // The suggestion's reason often says this already ("2 mutual
    // connections"); saying it twice on one card was noise.
    if (/mutual/i.test(user.reason || '')) return '';
    return mutual ? `${mutual} mutual` : '';
  };

  // Compact User Card Component
  // Called as a function rather than rendered as a component: declared
  // inside this screen, a component is re-created on every render, and
  // React would rebuild everything in it — losing focus and local state.
  const renderCompactUserCard = ({ user, type }: UserCardProps) => (
    <div
      className="p-3 rounded-lg border transition-all duration-300 hover:shadow-md hover:scale-[1.02] cursor-pointer text-left min-w-0"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.border,
        boxShadow: darkMode ? '0 2px 8px rgba(0,0,0,0.2)' : '0 2px 8px rgba(0,0,0,0.1)'
      }}
      onClick={() => onViewProfile?.(user.username)}
    >
      {/* The left side shrinks and truncates; the status on the right
          never wraps and never leaves the card. */}
      <div className='flex items-start justify-between gap-2'>
        <div className="flex items-center gap-2 mb-2 flex-1 min-w-0">
          <div className="relative">
            <Avatar user={user} theme={theme} />
            {type === 'friend' && user.presence !== 'hidden' && (
              <div
                className={`absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${statusColour(user)}`}
                style={{ borderColor: theme.surface }}
              />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm truncate" style={{ color: theme.text }}>
              {user.name}
            </h3>
            <p className="text-xs truncate" style={{ color: theme.text, opacity: 0.6 }}>
              {user.bio}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end justify-between text-xs mb-2 shrink-0 whitespace-nowrap text-right" style={{ color: theme.secondary }}>
            {type === 'suggestion' && user.reason && (
              <span style={{ color: theme.text, opacity: 0.5 }}>
                {user.reason}
              </span>
            )}
          <span>{subtitleFor(user, type)}</span>
        </div>

      </div>

      <div className="flex gap-1.5 justify-end text-sm" onClick={(event) => event.stopPropagation()}>
        {type === 'request' && (
          <>
            <button
              onClick={() => respond(user, 'accept')}
              disabled={busy[user.id]}
              className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1"
              style={{ backgroundColor: theme.secondary, color: 'white', opacity: busy[user.id] ? 0.6 : 1 }}
            >
              <Check size={16} />
              Accept
            </button>
            <button
              onClick={() => respond(user, 'decline')}
              disabled={busy[user.id]}
              className="flex-1 flex items-center justify-center gap-2 px-2 py-1.5 rounded-md transition-colors border"
              style={{ borderColor: theme.border, color: theme.text }}
            >
              <X size={16} />
              Reject
            </button>
          </>
        )}

        {type === 'suggestion' && (
          <>
            <button
              onClick={() => sendRequest(user)}
              disabled={busy[user.id] || user.relationship?.state === 'pending'}
              className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1"
              style={{ backgroundColor: theme.accent, color: darkMode ? theme.background : 'white', opacity: busy[user.id] ? 0.6 : 1 }}
            >
              <UserPlus size={16} />
              {user.relationship?.state === 'pending' ? 'Requested' : 'Add'}
            </button>
            <button
              onClick={() => dismissSuggestion(user)}
              className="px-2 flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md transition-colors border"
              style={{ borderColor: theme.border, color: theme.text }}
            >
              <X size={16} />
              Remove
            </button>
          </>
        )}

        {type === 'friend' && (
          <>
            <button
              onClick={() => message(user)}
              className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1"
              style={{ backgroundColor: theme.secondary, color: 'white' }}
            >
              <MessageCircle size={11} />
              Message
            </button>
            <div className="relative" ref={friendMenu === user.id ? friendMenuRef : undefined}>
              <button
                onClick={() => { setFriendMenu(friendMenu === user.id ? null : user.id); setConfirmRemove(false); }}
                aria-label={`More options for ${user.name}`}
                aria-expanded={friendMenu === user.id}
                className="px-2 py-1.5 rounded-md transition-colors border h-full"
                style={{ borderColor: theme.border, color: theme.text }}
              >
                <MoreHorizontal size={14} />
              </button>
              {friendMenu === user.id && (
                <div
                  role="menu"
                  className="absolute right-0 bottom-full mb-2 z-30 rounded-xl shadow-lg overflow-hidden text-sm text-left"
                  style={{ background: theme.surface, border: `1px solid ${theme.border}`, minWidth: '190px' }}
                >
                  <button
                    role="menuitem"
                    className="w-full text-left px-4 py-3"
                    style={{ color: theme.text, background: 'transparent' }}
                    onClick={() => { setFriendMenu(null); onViewProfile?.(user.username); }}
                  >
                    View profile
                  </button>
                  <button
                    role="menuitem"
                    className="w-full text-left px-4 py-3"
                    style={{ color: '#ff6b6b', background: 'transparent' }}
                    onClick={() => {
                      if (!confirmRemove) { setConfirmRemove(true); return; }
                      setFriendMenu(null);
                      setConfirmRemove(false);
                      removeConnection(user);
                    }}
                  >
                    {confirmRemove ? `Tap again to remove ${user.name.split(' ')[0]}` : 'Remove friend'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // List View Component
  const renderListUserItem = ({ user, type }: UserCardProps) => (
    <div
      className="flex items-center gap-4 p-3 rounded-lg border transition-all duration-300 hover:shadow-md"
      style={{
        backgroundColor: theme.surface,
        borderColor: theme.border
      }}
    >
      <div className="relative">
        <Avatar user={user} theme={theme} />
        {type === 'friend' && user.presence !== 'hidden' && (
          <div className={`absolute -bottom-1 -right-1 w-2 h-2 rounded-full ${statusColour(user)}`} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm" style={{ color: theme.text }}>
            {user.name}
          </h3>
          <span className="text-xs px-2 py-1 rounded-full" style={{
            backgroundColor: theme.secondary,
            color: 'white'
          }}>
            {subtitleFor(user, type)}
          </span>
        </div>
        <p className="text-xs truncate" style={{ color: theme.text, opacity: 0.6 }}>
          {user.bio} {type === 'suggestion' && user.reason && `• ${user.reason}`}
        </p>
      </div>

      <div className="flex gap-2">
        {type === 'request' && (
          <>
            <button onClick={() => respond(user, 'accept')} className="p-2 rounded-md" style={{ backgroundColor: theme.secondary, color: 'white' }}>
              <Check size={14} />
            </button>
            <button onClick={() => respond(user, 'decline')} className="p-2 rounded-md border" style={{ borderColor: theme.border, color: theme.text }}>
              <X size={14} />
            </button>
          </>
        )}

        {type === 'suggestion' && (
          <>
            <button onClick={() => sendRequest(user)} className="p-2 rounded-md" style={{ backgroundColor: theme.accent, color: darkMode ? theme.background : 'white' }}>
              <UserPlus size={14} />
            </button>
            <button onClick={() => dismissSuggestion(user)} className="p-2 rounded-md border" style={{ borderColor: theme.border, color: theme.text }}>
              <X size={14} />
            </button>
          </>
        )}

        {type === 'friend' && (
          <>
            <button onClick={() => message(user)} className="p-2 rounded-md" style={{ backgroundColor: theme.secondary, color: 'white' }}>
              <MessageCircle size={14} />
            </button>
            <button onClick={() => removeConnection(user)} className="p-2 rounded-md border" style={{ borderColor: theme.border, color: theme.text }}>
              <MoreHorizontal size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  const tabs = [
    { id: 'suggestions', label: 'Suggestions', icon: Users, count: suggestions.length },
    { id: 'requests', label: 'Requests', icon: Bell, count: requests.length },
    { id: 'friends', label: 'Friends', icon: Heart, count: friends.length }
  ];

  const getCurrentData = (): PublicUser[] => {
    const rows =
      activeTab === 'requests' ? requests : activeTab === 'friends' ? friends : suggestions;

    // Suggestions are filtered server-side; the other two tabs are small
    // enough to filter here rather than making a round trip per keystroke.
    if (activeTab === 'suggestions' || !searchQuery.trim()) return rows;
    const needle = searchQuery.trim().toLowerCase();
    return rows.filter((row) => (row.name || '').toLowerCase().includes(needle));
  };

  const getCurrentType = () => {
    switch (activeTab) {
      case 'requests': return 'request';
      case 'friends': return 'friend';
      default: return 'suggestion';
    }
  };

  return (
    <div
      className="min-h-screen transition-colors duration-300 mx-2"
      style={{ background: theme.gradient }}
    >
      {/* Compact Header */}
      <div
        className="sticky top-0 z-10 backdrop-blur-sm"
        style={{
          backgroundColor: darkMode ? 'rgba(27, 31, 59, 0.95)' : 'rgba(250, 248, 240, 0.95)',
          borderColor: theme.border
        }}
      >
        <div className="max-w-7xl mx-auto py-2">
          {/* Wraps onto a second line on narrow windows instead of pushing
              the search box and Filter button off the edge. */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4">
              {/* Compact Tabs */}
              <div className="flex gap-2">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as Tab)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                        activeTab === tab.id ? 'shadow-sm' : ''
                      }`}
                      style={{
                        backgroundColor: activeTab === tab.id ? theme.accent : theme.surface,
                        color: activeTab === tab.id ? (darkMode ? theme.background : 'white') : theme.text
                      }}
                    >
                      <Icon size={16} />
                      <span className="hidden sm:inline">{tab.label}</span>
                      {/* No number on Suggestions: it would only ever say
                          "lots". Requests and Friends keep theirs. */}
                      {tab.count > 0 && tab.id !== 'suggestions' && (
                        <span
                          className="px-1.5 py-0.5 rounded-full text-xs font-bold min-w-[18px] text-center"
                          style={{
                            backgroundColor: activeTab === tab.id ?
                              (darkMode ? theme.background : 'rgba(255,255,255,0.2)') :
                              theme.secondary,
                            color: 'white'
                          }}
                        >
                          {tab.count > 99 ? '99+' : tab.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div
                className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg min-w-0"
                style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}` }}
              >
                <Search size={14} style={{ color: theme.text, opacity: 0.6 }} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search people"
                  className="bg-transparent outline-none text-sm w-40"
                  style={{ color: theme.text }}
                />
              </div>
              <button
                ref={filterButtonRef}
                onClick={() => (showFilters ? closeFilters() : setShowFilters(true))}
                aria-expanded={showFilters}
                className={`px-4 py-2.5 rounded-lg transition-colors flex items-center gap-2 ${showFilters ? 'shadow-md' : ''}`}
                style={{
                  backgroundColor: showFilters ? theme.accent : theme.surface,
                  color: showFilters ? (darkMode ? theme.background : 'white') : theme.text,
                  border: `1px solid ${theme.border}`
                }}
              >
                <Filter size={16} />
                <span className="hidden sm:inline">Filter</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto py-1">
        {error && (
          <div
            className="p-3 rounded-lg mb-3 text-sm"
            style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}`, color: theme.text }}
          >
            {error}
          </div>
        )}

        {/* Filter Options */}
        {showFilters && (
          <div
            ref={filterPanelRef}
            className="p-4 rounded-lg border mb-4 text-sm transition-all duration-300 text-left"
            style={{
              backgroundColor: theme.surface,
              borderColor: theme.border,
              boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.1)'
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {/* Location Filter */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: theme.text }}>
                  Location
                </label>
                <select
                  value={filters.location}
                  onChange={(e) => setFilters({...filters, location: e.target.value})}
                  className="w-full p-2 rounded-md border text-sm outline-none"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.border,
                    color: theme.text
                  }}
                >
                  <option value="">All locations</option>
                  {/* Disabled rather than silently matching nothing when
                      there's no location on the profile to compare against. */}
                  <option value="same-city" disabled={!myLocation}>
                    {myLocation ? `Same city (${myLocation})` : 'Same city — set your location first'}
                  </option>
                </select>
              </div>

              {/* Mutual Friends Filter */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: theme.text }}>
                  Mutual Friends
                </label>
                <select
                  value={filters.mutualFriends}
                  onChange={(e) => setFilters({...filters, mutualFriends: e.target.value})}
                  className="w-full p-2 rounded-md border text-sm outline-none"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.border,
                    color: theme.text
                  }}
                >
                  <option value="">Any amount</option>
                  <option value="1">At least 1</option>
                  <option value="3">At least 3</option>
                  <option value="6">At least 6</option>
                  <option value="10">At least 10</option>
                </select>
              </div>

              {/* Interests Filter */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: theme.text }}>
                  Interests
                </label>
                <select
                  value={filters.interests}
                  onChange={(e) => setFilters({...filters, interests: e.target.value})}
                  className="w-full p-2 rounded-md border text-sm outline-none"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.border,
                    color: theme.text
                  }}
                >
                  <option value="">All interests</option>
                  {topics.map((topic) => (
                    <option key={topic.id} value={topic.id}>{topic.label}</option>
                  ))}
                </select>
              </div>

              {/* Activity Filter */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: theme.text }}>
                  Activity
                </label>
                <select
                  value={filters.activity}
                  onChange={(e) => setFilters({...filters, activity: e.target.value})}
                  className="w-full p-2 rounded-md border text-sm outline-none"
                  style={{
                    backgroundColor: theme.cardBg,
                    borderColor: theme.border,
                    color: theme.text
                  }}
                >
                  <option value="">Any time</option>
                  <option value="active">Active this week</option>
                  <option value="new">Joined this month</option>
                </select>
              </div>
            </div>

            {/* Filter Actions */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t" style={{ borderColor: theme.border }}>
              <button
                onClick={() => {
                  const cleared = { location: '', mutualFriends: '', interests: '', activity: '' };
                  setFilters(cleared);
                  setAppliedFilters(cleared);
                  setShowFilters(false);
                }}
                className="text-sm font-medium transition-colors"
                style={{ color: theme.secondary }}
              >
                Clear all filters
              </button>

              <div className="flex gap-2">
                <button
                  onClick={closeFilters}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors border"
                  style={{
                    borderColor: theme.border,
                    color: theme.text
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setAppliedFilters(filters);
                    setActiveTab('suggestions');
                    setShowFilters(false);
                  }}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: theme.accent,
                    color: darkMode ? theme.background : 'white'
                  }}
                >
                  Apply Filters
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Content Grid/List */}
        {viewMode === 'grid' ? (
          // As many columns as fit, each at least 320px — and never wider
          // than the screen, which on a phone pushed "Remove" and the status
          // off the right edge.
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '0.75rem' }}>
            {getCurrentData().map((user) => (
              <Fragment key={user.id}>
                {renderCompactUserCard({ user, type: getCurrentType() })}
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {getCurrentData().map((user) => (
              <Fragment key={user.id}>
                {renderListUserItem({ user, type: getCurrentType() })}
              </Fragment>
            ))}
          </div>
        )}

        {/* Empty State — also the loading state, so the screen never shows
            an empty grid and a "no results" message at the same time. */}
        {getCurrentData().length === 0 && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4">🌱</div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: theme.text }}>
              {loading ? 'Looking…' : `No ${activeTab} yet`}
            </h3>
            <p style={{ color: theme.text, opacity: 0.7 }}>
              {loading
                ? ' '
                : activeTab === 'suggestions'
                  ? 'Suggestions appear as you share interests, a location or connections with other people.'
                  : 'Your journey will connect you with like-minded souls'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ConnectionsPage;

import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import SoulLog from './assets/SoulLog.svg';
import Overview from './Overview';
import CommunityFeed from './Community';
import InsightsPage from './Insights';
import JournalHistoryPage from './Journal';
import SoulLogOwnProfile from './Profile';
import MessagesPage from './Messages';
import SoulLogSettings from './Settings';
import Notifications from './NotificationPage';
import { LuLayoutDashboard } from "react-icons/lu";
import { BsJournalBookmark } from "react-icons/bs";
import { CgInsights } from "react-icons/cg";
import { MdGroups } from "react-icons/md";
import { Bell, Settings as SettingsIcon } from 'lucide-react';
import { PiChatsCircleLight } from "react-icons/pi";
import { Preferences } from '@capacitor/preferences';
import CreateJournal from './CreateJournal';
import { applyFontSize } from './appearance';
import { clearProfileLink, readPostLink, readProfileLink } from './links';
import MoodCheckin from './MoodCheckin';
import SoulLogProfileForm from './ProfileForm';
import SoulLogOthersProfile from './ProfileOthersView';
import { get, openSocket } from './api';
import { goBack, navState, pushNav, replaceNav, scrollToTop } from './nav';
import type { Theme } from './theme';
import type { MyProfile } from './types';

const ACTIVE_TAB = {
  OVERVIEW: 'Dashboard',
  JOURNAL: 'Journal',
  INSIGHTS: 'Insights',
  COMMUNITY: 'Community',
  SETTINGS: 'Settings',
  MESSAGES: 'Whispers',
  PROFILE: 'Profile',
  // Two screens that existed in the codebase but had no route into them.
  PROFILE_FORM: 'ProfileForm',
  PROFILE_OTHER: 'ProfileOther',
  NOTIFICATION: 'Notification',
  LOG: 'Log',
}

type ThemeName = "dark" | "light";

async function saveTheme(name: ThemeName) {
  await Preferences.set({ key: "theme", value: name });
}

interface DashboardProps {
  darkMode: boolean;
  setDarkMode: Dispatch<SetStateAction<boolean>>;
  theme: Theme;
  isMobile: boolean;
}

/**
 * One row of the sidebar navigation. `badge` is optional because only the
 * two rows that can carry an unread count have one.
 */
interface NavItem {
  name: string;
  icon: ReactNode;
  active: boolean;
  badge?: number;
}

const Dashboard = ({ darkMode, setDarkMode, theme, isMobile }: DashboardProps) => {
  const [activeTab, setActiveTab] = useState('');
  const [backPage, setBackPage] = useState(ACTIVE_TAB.OVERVIEW);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hideExtra, setHideExtra] = useState(false);
  // Set when the signed-in user's photo fails to load, so the initial shows instead.
  const [avatarBroken, setAvatarBroken] = useState(false);

  // A prompt handed from the Dashboard home to the composer. Cleared the
  // moment the user is anywhere else, so opening the composer later from
  // the sidebar starts blank rather than with a stale prompt.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  useEffect(() => {
    if (activeTab !== ACTIVE_TAB.LOG) setPendingPrompt(null);
  }, [activeTab]);
  // Where the profile form returns to. It is the first-run screen for new
  // accounts (back to the dashboard) and the editor behind Edit Profile
  // (back to the profile).
  const [formReturnTo, setFormReturnTo] = useState<string>(ACTIVE_TAB.OVERVIEW);
  const editProfile = () => {
    setFormReturnTo(ACTIVE_TAB.PROFILE);
    setActiveTab(ACTIVE_TAB.PROFILE_FORM);
  };

  // Which Settings section to open on — Privacy when arriving from the
  // gear in Whispers, where "who can message me" lives.
  const [settingsSection, setSettingsSection] = useState<string>('profile');
  // Bumped by each click on "Settings" in the menu, so clicking it while
  // inside a section returns to the Settings list.
  const [settingsVisit, setSettingsVisit] = useState(0);
  // Set while stepping back down to the left-bar level to swap in a new
  // left-bar page (see openTab).
  const switchingTo = useRef<string | null>(null);
  /**
   * A page chosen from the left bar (or the bottom bar on a phone).
   *
   * Those pages sit side by side, one level above the Dashboard, like the
   * tabs of a phone app: switching between them replaces the page rather
   * than stacking it, so Back from any of them — however many you visited
   * first — goes straight to the Dashboard. Pages opened from *inside* one
   * (a Settings section, a profile, a Souls tab) still stack on top of it.
   */
  const openTab = (name: string) => {
    if (name === ACTIVE_TAB.SETTINGS) setSettingsVisit((n) => n + 1);
    const depth = navState()?.depth ?? 0;
    if (name !== ACTIVE_TAB.OVERVIEW && depth === 1) {
      replaceNav(name, undefined, 1);
    } else if (name !== ACTIVE_TAB.OVERVIEW && depth > 1) {
      // Step back down to the left-bar level first, then swap that page.
      switchingTo.current = name;
      window.history.go(-(depth - 1));
    }
    setActiveTab(name);
  };
  useEffect(() => {
    if (activeTab !== ACTIVE_TAB.SETTINGS) setSettingsSection('profile');
  }, [activeTab]);

  // Community's starting tab, for "Find Connections".
  const [communityTab, setCommunityTab] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (activeTab !== ACTIVE_TAB.COMMUNITY) { setCommunityTab(undefined); setSoulsTab(undefined); }
  }, [activeTab]);
  const findConnections = () => {
    setCommunityTab('Souls');
    setActiveTab(ACTIVE_TAB.COMMUNITY);
  };

  // Which list to open inside Souls — Requests from a friend-request
  // notification, Friends from an "accepted" one.
  const [soulsTab, setSoulsTab] = useState<'requests' | 'friends' | undefined>(undefined);
  const openSouls = (tab: 'requests' | 'friends') => {
    setSoulsTab(tab);
    setCommunityTab('Souls');
    setActiveTab(ACTIVE_TAB.COMMUNITY);
  };

  // One Sanctuary post to show at the top of the feed with its comments
  // open — from a shared link, or "Comment" on someone's profile.
  const [focusPost, setFocusPost] = useState<number | null>(null);
  const openPost = (postId: number) => {
    setFocusPost(postId);
    setCommunityTab('Sanctuary');
    setActiveTab(ACTIVE_TAB.COMMUNITY);
  };

  // One journal entry to open straight into its edit or share dialog.
  const [journalFocus, setJournalFocus] = useState<{ id: number; action: 'edit' | 'share' } | null>(null);
  const openJournalEntry = (id: number, action: 'edit' | 'share') => {
    setJournalFocus({ id, action });
    setActiveTab(ACTIVE_TAB.JOURNAL);
  };

  const writeWithPrompt = (prompt: string) => {
    setPendingPrompt(prompt);
    setActiveTab(ACTIVE_TAB.LOG);
  };

  // Who is actually signed in. The sidebar used to read "Alex Johnson /
  // Premium Member" for everyone — a name nobody had, and a membership
  // tier the product doesn't have.
  const [me, setMe] = useState<MyProfile | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  // Friend requests waiting for an answer: a badge on Community, Souls
  // and the Requests tab.
  const [pendingRequests, setPendingRequests] = useState(0);
  const [viewingProfile, setViewingProfile] = useState<string | null>(null);
  const [openConversationId, setOpenConversationId] = useState<number | null>(null);

  const refreshBadges = useCallback(async () => {
    try {
      const [notifications, messages, requests] = await Promise.all([
        get<{ unread: number }>('/notifications/unread-count/'),
        get<{ unread: number }>('/messages/unread/'),
        get<unknown[]>('/social/requests/?direction=incoming'),
      ]);
      setUnreadNotifications(notifications.unread);
      setUnreadMessages(messages.unread);
      setPendingRequests(requests.length);
    } catch {
      // Badges are decoration on top of working screens; a failure here
      // shouldn't produce an error message over the whole app.
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const profile = await get<MyProfile>('/profile/');
        setMe(profile);

        // The saved text size (Settings → Appearance), applied app-wide.
        // Best effort: a failure here just leaves the default size.
        get<{ appearance?: { fontSize?: string } }>('/settings/')
          .then((saved) => applyFontSize(saved.appearance?.fontSize))
          .catch(() => {});

        // A user who hasn't filled in a profile lands on the onboarding
        // form the codebase already contained but never showed anyone.
        // Opened from a shared profile link? Go there — unless this is a
        // brand-new account, which sets up its own profile first.
        const linked = readProfileLink();
        const linkedPost = readPostLink();
        clearProfileLink();
        if (linkedPost && profile.onboardingCompleted) {
          openPost(linkedPost);
          return;
        }
        if (linked && profile.onboardingCompleted) {
          if (linked.toLowerCase() === profile.username.toLowerCase()) setActiveTab(ACTIVE_TAB.PROFILE);
          else openProfile(linked);
          return;
        }

        setActiveTab((current) =>
          current || (profile.onboardingCompleted ? ACTIVE_TAB.OVERVIEW : ACTIVE_TAB.PROFILE_FORM),
        );
      } catch {
        setActiveTab((current) => current || ACTIVE_TAB.OVERVIEW);
      }
    })();
  }, []);

  useEffect(() => {
    refreshBadges();
    // Live: the bell updates the moment something arrives, and the poll
    // is a fallback for a client whose socket didn't connect.
    const socket = openSocket('/ws/notifications/', {
      onMessage: (event) => {
        // 'unread': a new direct message (messages don't create notifications).
        if (event.type === 'notification' || event.type === 'connected' || event.type === 'unread') refreshBadges();
      },
    });
    const timer = setInterval(refreshBadges, 60000);
    return () => {
      socket.close();
      clearInterval(timer);
    };
  }, [refreshBadges]);

  // The Back button / swipe-back gesture.
  //
  // Screens here are switched in React state, not by URL, so the browser
  // had nothing to go back to and Back left the app entirely. Now every
  // screen you open is recorded in the browser's history, so Back goes to
  // the previous screen, all the way down to the Dashboard — and Back from
  // the Dashboard leaves the app. On Android the hardware back button
  // follows the same history.
  //
  // The rules: whenever the screen shown differs from the one the current
  // history entry describes, record a new entry; and arriving at the
  // Dashboard by any route rewinds to the bottom entry instead. A Back or
  // Forward step moves the history first and the screen follows, so it
  // never records anything twice. See nav.ts.
  const hasHistory = useRef(false);
  // Set while the history is being rewound on start-up (after a refresh
  // left us part-way down it): the screen to show once we're at the bottom.
  const rewindingTo = useRef<string | null>(null);
  const subFor = (tab: string) =>
    tab === ACTIVE_TAB.PROFILE_OTHER ? viewingProfile || undefined : undefined;

  /** Make the current entry the Dashboard at the bottom, then open `tab` on top. */
  const startFrom = (tab: string) => {
    replaceNav(ACTIVE_TAB.OVERVIEW, undefined, 0);
    if (tab !== ACTIVE_TAB.OVERVIEW) pushNav(tab, subFor(tab));
  };

  useEffect(() => {
    if (!activeTab) return;
    const here = navState();
    const depth = here?.depth ?? 0;

    if (switchingTo.current) return; // openTab is handling the history
    if (!hasHistory.current) {
      hasHistory.current = true;
      if (depth > 0) {
        // Refreshed part-way down: rewind to the bottom first.
        rewindingTo.current = activeTab;
        window.history.go(-depth);
      } else {
        startFrom(activeTab);
      }
      return;
    }

    if (activeTab === ACTIVE_TAB.OVERVIEW) {
      // The Dashboard is the floor. Getting here by a click (menu, logo)
      // rewinds to it instead of stacking another copy on top, so the
      // next Back leaves the app.
      if (depth > 0) window.history.go(-depth);
      return;
    }

    const sub = subFor(activeTab);
    if (here?.tab !== activeTab || (sub && here?.sub !== sub)) {
      pushNav(activeTab, sub);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, viewingProfile]);

  useEffect(() => {
    const onPopState = () => {
      if (switchingTo.current !== null) {
        replaceNav(switchingTo.current, undefined, 1);
        switchingTo.current = null;
        return;
      }
      if (rewindingTo.current !== null) {
        const tab = rewindingTo.current;
        rewindingTo.current = null;
        startFrom(tab);
        return;
      }
      const here = navState();
      if (here?.tab === ACTIVE_TAB.PROFILE_OTHER && here.sub) setViewingProfile(here.sub);
      setActiveTab(here?.tab || ACTIVE_TAB.OVERVIEW);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every page opens at its top.
  useEffect(() => {
    if (activeTab) scrollToTop();
  }, [activeTab, viewingProfile]);

  // Clearing the badge when you open the screen that shows the items.
  useEffect(() => {
    if (activeTab === ACTIVE_TAB.NOTIFICATION || activeTab === ACTIVE_TAB.MESSAGES) {
      const timer = setTimeout(refreshBadges, 1200);
      return () => clearTimeout(timer);
    }
  }, [activeTab, refreshBadges]);

  const openProfile = (username: string) => {
    setViewingProfile(username);
    setActiveTab(ACTIVE_TAB.PROFILE_OTHER);
  };

  const openConversation = (conversationId: number) => {
    setOpenConversationId(conversationId);
    setActiveTab(ACTIVE_TAB.MESSAGES);
  };

  const displayName = me?.name || me?.username || '';
  const initials = me?.initials || (displayName ? displayName[0].toUpperCase() : '');

  return (
    <div className='app-container' style={{ 
      background: theme.background,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
    }}>
      {
        !isMobile && (
          // Desktop Sidebar Navigation 
          <nav style={{
            width: sidebarCollapsed ? (isMobile ? '0px' : '90px') : '240px',
            background: theme.surface,
            borderRight: `1px solid ${theme.border}`,
            position: 'relative',
            left: 0,
            top: 0,
            height: '100vh',
            padding: sidebarCollapsed ? (isMobile ? '0' : '0rem 0.75rem') : '0rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            transition: 'all 0.3s ease',
            overflow: 'hidden'
          }}>
            {/* Logo Section — like most sites, the logo takes you home. */}
            <div
              role="link"
              tabIndex={0}
              aria-label="SoulLog — go to Dashboard"
              title="Go to Dashboard"
              onClick={() => openTab(ACTIVE_TAB.OVERVIEW)}
              onKeyDown={(e) => { if (e.key === 'Enter') openTab(ACTIVE_TAB.OVERVIEW); }}
              style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              marginBottom: '2.5rem',
              marginTop: '1.5rem',
              padding: '0rem 1rem',
              cursor: 'pointer'
            }}>
              <img 
                src={SoulLog}
                alt="SoulLog Logo"
                style={{
                  width: '32px',
                  height: '32px',
                  position: 'relative'
                }}
              />
              {
                !sidebarCollapsed &&
                <div style={{ fontSize: '18px', fontWeight: '900', color: theme.text, display: 'flex', flexDirection: 'column', textAlign: 'left', gap: '0px' }}>
                  SoulLog
                  <span style={{fontStyle: 'italic', fontSize: '12px', fontWeight: 900}}>Write. Reflect. Rise.</span>
                </div>
              }
            </div>

            {/* Collapse Toggle Arrow - Only on Desktop */}
            <div
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              style={{
                position: 'absolute',
                top: '4.3rem',
                right: '0px',
                width: '24px',
                height: '24px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.3s ease',
                transform: 'translateY(-50%)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-50%) scale(1.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
              }}
            >
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 16 16" 
                fill="none"
                style={{
                  transform: sidebarCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
                  transition: 'transform 0.3s ease',
                  filter: `drop-shadow(0 2px 4px rgba(0,0,0,0.1))`,
                  // paddingRight: '3px',
                }}
              >
                <circle 
                  cx="8" 
                  cy="8" 
                  r="8" 
                  fill={theme.surface}
                  stroke={theme.border}
                  strokeWidth="1"
                />
                <path 
                  d="M7 5 L10 8 L7 11" 
                  stroke={theme.accent} 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Navigation Items */}
            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              gap: '0.7rem',
              opacity: isMobile && sidebarCollapsed ? 0 : 1,
              transition: 'opacity 0.3s ease',
              marginTop: isMobile ? '2rem' : '0'
            }}>
              {([
                { name: 'Dashboard', icon: <LuLayoutDashboard size={17} />, active: true },
                { name: 'Journal', icon: <BsJournalBookmark size={16}  />, active: false },
                { name: 'Whispers', icon: <PiChatsCircleLight size={20} />, active: false, badge: unreadMessages },
                { name: 'Community', icon: <MdGroups size={21} />, active: false, badge: pendingRequests },
                { name: 'Notification', icon: <Bell size={21} />, active: false, badge: unreadNotifications },
                { name: 'Insights', icon: <CgInsights size={21} />, active: false },
                { name: 'Settings', icon: <SettingsIcon size={19} />, active: false },
              ] as NavItem[]).map((item, index) => (
                <button
                  key={index}
                  onClick={() => openTab(item.name)}
                  style={{
                    background: activeTab === item.name ? theme.accent + '15' : 'transparent',
                    border: activeTab === item.name ? `1px solid ${theme.accent}30` : '1px solid transparent',
                    borderRadius: '1rem',
                    padding: sidebarCollapsed ? '0.7rem' : '0.7rem 1rem',
                    color: activeTab === item.name ? theme.accent : theme.text,
                    fontSize: '1rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.3s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: sidebarCollapsed ? '0' : '1rem',
                    fontFamily: "'Poppins', sans-serif",
                    textAlign: 'left',
                    width: '100%',
                    justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                    position: 'relative',
                    outline: 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!item.active) {
                      e.currentTarget.style.background = theme.border + '50';
                      if (!sidebarCollapsed) {
                        e.currentTarget.style.transform = 'translateX(4px)';
                      }
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!item.active) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.transform = 'translateX(0)';
                    }
                  }}
                  title={sidebarCollapsed ? item.name : ''}
                >
                  <span style={{ fontSize: '1.25rem' }}>{item.icon}</span>
                  {!sidebarCollapsed && <span>{item.name}</span>}
                  {item.badge !== undefined && item.badge > 0 && (
                    <span style={{
                      marginLeft: 'auto',
                      background: '#FF6B6B',
                      color: '#fff',
                      borderRadius: '999px',
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      minWidth: '1.1rem',
                      textAlign: 'center',
                      padding: '0.05rem 0.35rem',
                    }}>
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Bottom Section */}
            <div style={{ 
              paddingBlock: '1rem',
              borderTop: `1px solid ${theme.border}`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              opacity: isMobile && sidebarCollapsed ? 0 : 1,
              transition: 'opacity 0.3s ease'
            }}>
              {/* Theme Toggle */}
              <button
                onClick={async () => {
                  saveTheme(!darkMode ? 'dark' : 'light');
                  setDarkMode(!darkMode);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderRadius: sidebarCollapsed ? '50%' : '1rem',
                  width: sidebarCollapsed ? '2.5rem' : '100%',
                  height: '3rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  gap: sidebarCollapsed ? '0' : '1rem',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'all 0.3s ease',
                  padding: sidebarCollapsed ? '0' : '0 1rem',
                  color: theme.text
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = theme.border + '30'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                title={sidebarCollapsed ? (darkMode ? 'Light Mode' : 'Dark Mode') : ''}
              >
                <span style={{ fontSize: '1.2rem' }}>{darkMode ? '☀️' : '🌙'}</span>
                {!sidebarCollapsed && (
                  <span style={{ 
                    fontFamily: "'Poppins', sans-serif",
                    fontWeight: '500',
                    fontSize: '0.9rem'
                  }}>
                    {darkMode ? 'Light Mode' : 'Dark Mode'}
                  </span>
                )}
              </button>

              {/* Profile Section */}
              <button style={{
                background: 'transparent',
                border: 'none',
                borderRadius: sidebarCollapsed ? '50%' : '1rem',
                width: sidebarCollapsed ? '2.5rem' : '100%',
                height: sidebarCollapsed ? '2.5rem' : 'auto',
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                gap: sidebarCollapsed ? '0' : '1rem',
                cursor: 'pointer',
                position: 'relative',
                transition: 'all 0.3s ease',
                padding: sidebarCollapsed ? '0' : '1rem',
                color: theme.text,
              }}
              onClick={() => setActiveTab(ACTIVE_TAB.PROFILE)}
              onMouseEnter={(e) => e.currentTarget.style.background = theme.border + '30'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <div style={{
                  width: '2rem',
                  height: '2rem',
                  borderRadius: '50%',
                  background: theme.accent,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.background,
                  fontWeight: '600',
                  fontSize: '0.9rem',
                  position: 'relative',
                  flexShrink: 0
                }}>
                  {me?.avatar_url && !avatarBroken ? (
                    <img
                      src={me.avatar_url}
                      alt={displayName}
                      onError={() => setAvatarBroken(true)}
                      style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                    />
                  ) : (
                    initials || '·'
                  )}
                  <div style={{
                    position: 'absolute',
                    bottom: '-2px',
                    right: '-2px',
                    width: '0.6rem',
                    height: '0.6rem',
                    background: '#4ECDC4',
                    borderRadius: '50%',
                    border: `2px solid ${theme.surface}`
                  }} />
                </div>
                {!sidebarCollapsed && (
                  <div style={{ textAlign: 'left' }}>
                    <div style={{
                      fontFamily: "'Poppins', sans-serif",
                      fontWeight: '600',
                      fontSize: '0.95rem',
                      lineHeight: 1.2
                    }}>
                      {displayName || '\u00a0'}
                    </div>
                    {/* The second line used to read "Premium Member" for
                        everyone. SoulLog has no membership tiers, so it
                        shows the username instead — something true. */}
                    <div style={{
                      fontFamily: "'Poppins', sans-serif",
                      fontSize: '0.8rem',
                      opacity: 0.7,
                      lineHeight: 1.2
                    }}>
                      {me?.username ? `@${me.username}` : '\u00a0'}
                    </div>
                  </div>
                )}
              </button>
            </div>
          </nav>
        )
      }

      {
        isMobile && !hideExtra && (
          <>
            {/* Top Row - Brand, Search, and User */}
            <div className='header' style={{
              gap: '1rem',
              padding: '0.4rem 1rem',
              backgroundColor: theme.background,
              zIndex: 10,
              position: 'sticky',
              top: 0,
            }}>
              
            {/* Logo Section — takes you home. */}
            <div
              role="link"
              tabIndex={0}
              aria-label="SoulLog — go to Dashboard"
              onClick={() => openTab(ACTIVE_TAB.OVERVIEW)}
              onKeyDown={(e) => { if (e.key === 'Enter') openTab(ACTIVE_TAB.OVERVIEW); }}
              style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.7rem',
              cursor: 'pointer',
            }}>
              <img 
                src={SoulLog}
                alt="SoulLog Logo"
                style={{
                  width: '32px',
                  height: '32px',
                  position: 'relative'
                }}
              />
              <div style={{ fontSize: '18px', fontWeight: '900', color: theme.text, display: 'flex', flexDirection: 'column', textAlign: 'left', gap: '0px' }}>
                SoulLog
                <span style={{fontStyle: 'italic', fontSize: '12px', fontWeight: 900}}>Write. Reflect. Rise.</span>
              </div>
            </div>

            <div style={{
              display: 'flex',
              gap: '1rem',
              alignItems: 'center',
            }}>
              {/* Settings — the phone layout has no left bar, so this is
                  the way in on a phone. */}
              <button
                aria-label="Settings"
                onClick={() => openTab(ACTIVE_TAB.SETTINGS)}
                style={{
                  background: theme.gradient,
                  borderRadius: '50%',
                  width: '2.5rem',
                  height: '2.5rem',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: theme.accent,
                  border: 'none',
                }}
              >
                <SettingsIcon size={19} />
              </button>

              {/* Notifications */}
              <button style={{
                background: theme.gradient,
                borderRadius: '50%',
                width: '2.5rem',
                height: '2.5rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '1.2rem',
                position: 'relative',
                outline: 'none',
                border: 'none'
              }}
              onClick={() => {
                openTab(ACTIVE_TAB.NOTIFICATION);
              }}
              >
                🔔
                {/* Shown only when there is genuinely something unread.
                    This dot used to be permanent. */}
                {unreadNotifications > 0 && (
                  <div style={{
                    position: 'absolute',
                    top: '0.25rem',
                    right: '0.5rem',
                    width: '0.5rem',
                    height: '0.5rem',
                    background: '#FF6B6B',
                    borderRadius: '50%'
                  }} />
                )}
              </button>
              <div style={{
                width: '2rem',
                height: '2rem',
                borderRadius: '50%',
                background: theme.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: theme.background,
                fontWeight: '600',
                fontSize: '0.9rem',
                position: 'relative',
                flexShrink: 0
              }}
              onClick={() => {
                setActiveTab(ACTIVE_TAB.PROFILE);
              }}
              >
                {me?.avatar_url && !avatarBroken ? (
                  <img
                    src={me.avatar_url}
                    alt={displayName}
                    onError={() => setAvatarBroken(true)}
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  initials || '·'
                )}
                <div style={{
                  position: 'absolute',
                  bottom: '-2px',
                  right: '-2px',
                  width: '0.6rem',
                  height: '0.6rem',
                  background: '#4ECDC4',
                  borderRadius: '50%',
                  border: `2px solid ${theme.surface}`
                }} />
              </div>
              </div>
            </div>
          </>
        )
      }

      {/* Main Content Area */}
      <div className={isMobile ? 'flex-1' : 'flex-1 main-content'}>

        {
          activeTab === ACTIVE_TAB.OVERVIEW ? <Overview theme={theme} darkMode={darkMode} isMobile={isMobile} setActiveTab={setActiveTab} onWriteWithPrompt={writeWithPrompt}/>
          : activeTab === ACTIVE_TAB.COMMUNITY ? (
              <CommunityFeed
                key={`${communityTab ?? 'default'}-${soulsTab ?? ''}`}
                initialTab={communityTab}
                soulsTab={soulsTab}
                pendingRequests={pendingRequests}
                onRequestsChanged={refreshBadges}
                focusPostId={focusPost}
                onFocusHandled={() => setFocusPost(null)}
                theme={theme}
                darkMode={darkMode}
                setHideExtra={setHideExtra}
                isMobile
                onViewProfile={openProfile}
                onOpenConversation={openConversation}
              />
            )
          : activeTab === ACTIVE_TAB.PROFILE_FORM ? (
              <SoulLogProfileForm
                theme={theme}
                darkMode={darkMode}
                mode={formReturnTo === ACTIVE_TAB.PROFILE ? 'edit' : 'onboarding'}
                onDone={() => {
                  get<MyProfile>('/profile/').then(setMe).catch(() => {});
                  const back = formReturnTo;
                  setFormReturnTo(ACTIVE_TAB.OVERVIEW);
                  // Editing: back to the profile you came from, as Back
                  // would. First-run setup has nowhere behind it.
                  goBack(() => setActiveTab(back));
                }}
                onSkip={() => {
                  const back = formReturnTo;
                  setFormReturnTo(ACTIVE_TAB.OVERVIEW);
                  goBack(() => setActiveTab(back));
                }}
              />
            )
          : activeTab === ACTIVE_TAB.PROFILE_OTHER ? (
              <SoulLogOthersProfile
                theme={theme}
                darkMode={darkMode}
                username={viewingProfile || undefined}
                onBack={() => goBack(() => setActiveTab(ACTIVE_TAB.COMMUNITY))}
                onOpenConversation={openConversation}
                onOpenPost={openPost}
              />
            )
          : activeTab === ACTIVE_TAB.INSIGHTS ? <InsightsPage theme={theme} darkMode={darkMode} onWriteWithPrompt={writeWithPrompt} />
          : activeTab === ACTIVE_TAB.JOURNAL ? <JournalHistoryPage theme={theme} darkMode={darkMode} setBackPage={setBackPage} setActiveTab={setActiveTab} focus={journalFocus} onFocusHandled={() => setJournalFocus(null)} />
          : activeTab === ACTIVE_TAB.PROFILE ? <SoulLogOwnProfile theme={theme} darkMode={darkMode} setHideExtra={setHideExtra} setActiveTab={setActiveTab} onEditProfile={editProfile} onFindConnections={findConnections} onOpenJournalEntry={openJournalEntry} />
          : activeTab === ACTIVE_TAB.MESSAGES ? (
              <MessagesPage
                theme={theme}
                darkMode={darkMode}
                setHideExtra={setHideExtra}
                initialConversationId={openConversationId}
                onViewProfile={openProfile}
                onOpenSettings={() => { setSettingsSection('privacy'); setActiveTab(ACTIVE_TAB.SETTINGS); }}
              />
            )
          : activeTab === ACTIVE_TAB.SETTINGS ? <SoulLogSettings key={`${settingsSection}-${settingsVisit}`} initialSection={settingsSection} theme={theme} darkMode={darkMode} setDarkMode={setDarkMode} setHideExtra={setHideExtra} setActiveTab={setActiveTab} isMobile />
          : activeTab === ACTIVE_TAB.NOTIFICATION ? <Notifications theme={theme} darkMode={darkMode} setHideExtra={setHideExtra} setActiveTab={setActiveTab} onOpenSouls={openSouls}/>
          /* CreateJournal takes no `backPage`: it navigates back to Journal
             itself, so the prop it was being handed was never read. */
          : activeTab === ACTIVE_TAB.LOG ? <CreateJournal key={pendingPrompt ?? 'blank'} theme={theme} setHideExtra={setHideExtra} setActiveTab={setActiveTab} isMobile={isMobile} initialPrompt={pendingPrompt}/>
          : activeTab === '' ? null  /* first paint, before we know where to send them */
          : <MoodCheckin theme={theme} setHideExtra={setHideExtra} setActiveTab={setActiveTab} backPage={backPage} />
        }
      </div>

      {/* Bottom Navigation - Only show when sidebar is hidden (mobile) */}
      {isMobile && (!hideExtra || ["Community"].includes(activeTab)) && (
        <nav className='bottom-nav' style={{
          background: theme.background,
          borderTop: `1px solid ${theme.border}`,
          // Clear of the iPhone home bar when opened from the home screen.
          padding: '0.2rem 0.2rem calc(0.2rem + env(safe-area-inset-bottom))',
          boxShadow: darkMode ? 'none' : '0 -4px 20px rgba(0,0,0,0.1)',
        }}>
          {[
            { name: 'Whispers', icon: <PiChatsCircleLight size={18} />, active: false, badge: unreadMessages },
            { name: 'Community', icon: <MdGroups size={21} />, active: false, badge: pendingRequests },
            { name: 'Dashboard', icon: <LuLayoutDashboard size={17} />, active: true },
            { name: 'Insights', icon: <CgInsights size={21} />, active: false },
            { name: 'Journal', icon: <BsJournalBookmark size={16}  />, active: false },
          ].map((item, index) => (
            <button
              key={index}
              onClick={() => openTab(item.name)}
              style={{
                background: 'transparent',
                borderRadius: '1rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '0rem',
                padding: '0.5rem 0.25rem',
                cursor: 'pointer',
                color: item.name === activeTab ? theme.accent : theme.text,
                fontWeight: 500,
                fontFamily: "'Poppins', sans-serif",
                opacity: item.name === activeTab ? 1 : 0.7,
                transition: 'all 0.3s ease',
                minWidth: '3.5rem',
                border: 'none',
                outline: 'none',
              }}
            >
              <span style={{ position: 'relative' }}>
                {item.icon}
                {'badge' in item && (item.badge ?? 0) > 0 && (
                  <span
                    aria-label={`${item.badge} new`}
                    style={{
                      position: 'absolute', top: '-0.35rem', right: '-0.7rem',
                      minWidth: '1rem', height: '1rem', padding: '0 0.25rem',
                      borderRadius: '999px', background: '#FF6B6B', color: 'white',
                      fontSize: '0.6rem', fontWeight: 700, lineHeight: '1rem', textAlign: 'center',
                    }}
                  >
                    {(item.badge ?? 0) > 99 ? '99+' : item.badge}
                  </span>
                )}
              </span>
              <span style={{ fontSize: '0.6rem' }}>{item.name}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
};

export default Dashboard;

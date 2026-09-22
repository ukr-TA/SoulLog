import React, { useEffect, useRef, useState } from 'react';
import {
  User, Lock, Bell, Shield, BookOpen, Users, Palette,
  ChevronRight, Mail, Phone,
  Download, Trash2, Eye, Settings, Database, HelpCircle, LogOut, Keyboard,
  ArrowLeft, Save, AlertTriangle, Check, Target, Calendar
} from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import { applyFontSize } from './appearance';
import { ApiError, del, get, type PublicUser } from './api';
import { logOut } from './session';
import { goBack, navState, pushNav } from './nav';
import type { Theme } from './theme';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
  /** The app's real theme switch — see appearance.ts. */
  setDarkMode?: (dark: boolean) => void;
  /** Section to open on, e.g. 'privacy' from the gear in Whispers. */
  initialSection?: string;
  isMobile?: boolean;
  setHideExtra: (hide: boolean) => void;
  setActiveTab: (tab: string) => void;
}

/**
 * `GET /settings/` and the body `PATCH /settings/` takes back.
 *
 * The choice fields (visibility, who may message you, template,
 * language) are `string` rather than unions: they come straight off a
 * `<select>` value and the server owns the list of accepted values, so a
 * union here would only mean casting every `e.target.value` back into it.
 */
interface AppSettings {
  profile: {
    name: string;
    bio: string;
    email: string;
    phone: string;
    location: string;
    website: string;
  };
  privacy: {
    profileVisibility: string;
    journalVisibility: string;
    showEmail: boolean;
    showPhone: boolean;
    showProfileViews: boolean;
    allowMessages: string;
    mentorAvailable: boolean;
  };
  notifications: {
    pushEnabled: boolean;
    emailEnabled: boolean;
    journalReminder: boolean;
    socialInteractions: boolean;
    achievements: boolean;
    weeklyDigest: boolean;
  };
  journaling: {
    autoSave: boolean;
    defaultTemplate: string;
    moodTracking: boolean;
    goalReminders: boolean;
    streakNotifications: boolean;
    /** Entries per day the Dashboard's "Today's Goal" ring counts towards. */
    dailyGoal?: number;
    /** Entries per week for the Dashboard's weekly bar. */
    weeklyGoal?: number;
  };
  social: {
    connectionRecommendations: boolean;
    activitySharing: boolean;
    mentionNotifications: boolean;
    friendRequests: string;
    onlineStatus: boolean;
    journalSharing: boolean;
    communityJoining: boolean;
    inspirationFeed: boolean;
    publicProfile: boolean;
    followSystem: boolean;
    groupDiscussions: boolean;
    achievementSharing: boolean;
  };
  appearance: {
    fontSize: string;
    language: string;
  };
}

/** A group of stored settings — the keys of `AppSettings`. */
type SettingsGroup = keyof AppSettings;

/**
 * The sections in the Settings list: every stored group, plus two that
 * hold actions rather than switches (your data, and help).
 */
type SectionId = SettingsGroup | 'data' | 'help';

/**
 * The section icons are cloned with a className and a style, so the
 * element type has to admit those two props.
 */
type IconElement = React.ReactElement<{ className?: string; style?: React.CSSProperties }>;

interface SettingsSection {
  id: SectionId;
  title: string;
  icon: IconElement;
  color: string;
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}

interface ToggleProps {
  enabled?: boolean;
  onToggle: () => void;
  size?: ButtonSize;
}

interface SettingItemProps {
  icon: IconElement;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  onClick?: () => void;
  showChevron?: boolean;
}

/** DRF field errors: `{ "current_password": ["Wrong password."] }`. */
type FieldErrors = Record<string, string[] | undefined>;

const Button = ({ children, variant = "primary", size = "md", className = "", onClick, disabled = false, theme }: ButtonProps & { theme: Theme }) => {
  const variants: Record<ButtonVariant, React.CSSProperties> = {
    primary: { backgroundColor: theme.accent, color: theme.text },
    secondary: { backgroundColor: theme.secondary, color: theme.text  },
    outline: { backgroundColor: 'transparent', color: theme.accent, border: `1px solid ${theme.accent}` },
    danger: { backgroundColor: '#ff4757', color: theme.text  },
    ghost: { backgroundColor: 'transparent', color: theme.text }
  };
  
  const sizes: Record<ButtonSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2'
  };

  return (
    <button 
      className={`rounded-lg flex items-center justify-center gap-2 font-medium transition-all duration-200 hover:shadow-lg hover:scale-101 ${sizes[size]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={variants[variant]}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
};

const Toggle = ({ enabled, onToggle, size = "md", theme }: ToggleProps & { theme: Theme }) => (
  <button
    onClick={onToggle}
    className={`relative inline-flex items-center ${size === 'sm' ? 'h-5 w-9' : 'h-6 w-11'} rounded-full transition-colors duration-200 focus:outline-none`}
    style={{ backgroundColor: enabled ? theme.secondary : '#6B7280' }}
  >
    <span
      className={`inline-block ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} rounded-full bg-white transform transition-transform duration-200 ${
        enabled ? (size === 'sm' ? 'translate-x-5' : 'translate-x-3') : '-translate-x-3'
      }`}
    />
  </button>
);

const SettingItem = ({ icon, title, description, children, onClick, showChevron = false, theme }: SettingItemProps & { theme: Theme }) => (
  <div 
    className={`flex items-center justify-between p-4 rounded-lg transition-all`}
    style={{ backgroundColor: theme.surface, border: `1px solid ${theme.border}` }}
    onClick={onClick}
  >
    <div className="flex items-center flex-1 gap-3">
      {React.cloneElement(icon, { className: "w-5 h-5", style: { color: theme.accent } })}
      <div className="flex-1">
        <h4 className="font-medium">{title}</h4>
        {description && <p className="text-sm opacity-60">{description}</p>}
      </div>
    </div>
    <div className="flex items-center gap-2">
      {children}
      {showChevron && <ChevronRight className="w-4 h-4 opacity-60" />}
    </div>
  </div>
);

const SoulLogSettings = ({ theme, setHideExtra, isMobile=true, setActiveTab, initialSection } : MessagePageProps) => {
  // Dark mode lives in one place, the switch at the bottom of the left
  // bar; Settings no longer carries a second copy of it.
  const SECTION_IDS: SectionId[] = ['profile', 'notifications', 'privacy', 'journaling', 'appearance', 'social', 'data', 'help'];
  // Arriving by Back/Forward on a section's page opens that section.
  const historySection = navState()?.tab === 'Settings' ? navState()?.sub : undefined;
  const startSection = historySection || initialSection;
  const [activeSection, setActiveSection] = useState<SectionId>(
    SECTION_IDS.includes(startSection as SectionId) ? (startSection as SectionId) : 'profile',
  );
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  // The social-management rows advertised counts nobody had ("2 blocked
  // accounts", "3 saved collections") and every one of them opened an
  // alert() that said it was opening something. Blocked accounts and
  // saved posts are real, so those two are wired up; the rest describe
  // features that don't exist and have been removed rather than left as
  // buttons that apologise.
  const [blocked, setBlocked] = useState<PublicUser[]>([]);
  const [showBlocked, setShowBlocked] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  const loadSocialLists = async () => {
    try {
      const [blockedRows, saved] = await Promise.all([
        get<PublicUser[]>('/social/blocked/'),
        get<{ total: number }>('/sanctuary/posts/?scope=bookmarked&limit=1'),
      ]);
      setBlocked(blockedRows);
      setSavedCount(saved.total);
    } catch {
      // These two rows just show no count; the rest of Settings is fine.
    }
  };

  useEffect(() => {
    loadSocialLists();
  }, []);

  const unblock = async (user: PublicUser) => {
    try {
      await del(`/social/block/${user.id}/`);
      setBlocked((current) => current.filter((row) => row.id !== user.id));
      setSocialError(null);
    } catch (err) {
      setSocialError(err instanceof ApiError ? err.message : 'Could not unblock that person.');
    }
  };
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  // Export problems are shown under the button, not in an alert().
  const [exportMessage, setExportMessage] = useState('');
  const [showMobileDetail, setShowMobileDetail] = useState(
    Boolean(historySection) || Boolean(initialSection && initialSection !== 'profile'),
  );

  // Each section is its own page for Back and Forward: opening one records
  // it, and Back returns to the list (or the section before).
  useEffect(() => {
    const onPopState = () => {
      const here = navState();
      if (here?.tab !== 'Settings') return;
      if (here.sub && SECTION_IDS.includes(here.sub as SectionId)) {
        setActiveSection(here.sub as SectionId);
        setShowMobileDetail(true);
      } else {
        setShowMobileDetail(false);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Password change form (previously had no state at all — the inputs
  // were uncontrolled and "Update Password" had no onClick)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState('');

  // Delete-account confirmation now requires re-entering the password
  // (the backend enforces this too — see DeleteAccountView)
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const authFetch = async (path: string, init: RequestInit = {}) => {
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    return fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${access_token}`,
        ...(init.headers || {}),
      },
    });
  };

  // Settings state
  const [settings, setSettings] = useState<AppSettings>({
    profile: {
      name: 'Emma Rodriguez',
      bio: 'Helping souls find their inner light through mindful practices and authentic living. Certified meditation instructor with 8+ years of experience.',
      email: 'emma.rodriguez@email.com',
      phone: '+1 (555) 987-6543',
      location: 'Portland, OR',
      website: 'emmarodriguez.com'
    },
    privacy: {
      profileVisibility: 'public',
      journalVisibility: 'friends',
      showEmail: false,
      showPhone: false,
      showProfileViews: false,
      allowMessages: 'everyone',
      mentorAvailable: true
    },
    notifications: {
      pushEnabled: true,
      emailEnabled: true,
      journalReminder: true,
      socialInteractions: true,
      achievements: true,
      weeklyDigest: false
    },
    journaling: {
      autoSave: true,
      defaultTemplate: 'gratitude',
      moodTracking: true,
      goalReminders: true,
      streakNotifications: true,
      dailyGoal: 1,
      weeklyGoal: 5
    },
    social: {
      connectionRecommendations: true,
      activitySharing: true,
      mentionNotifications: true,
      friendRequests: 'everyone',
      onlineStatus: true,
      journalSharing: true,
      communityJoining: true,
      inspirationFeed: true,
      publicProfile: true,
      followSystem: true,
      groupDiscussions: true,
      achievementSharing: true
    },
    appearance: {
      fontSize: 'medium',
      language: 'en'
    }
  });

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await authFetch('/settings/');
        if (response.ok) {
          setSettings((await response.json()) as AppSettings);
        }
      } catch {
        // Falling back to the defaults above is an honest empty state.
      }
    };
    loadSettings();
  }, []);

  const handleUpdatePassword = async () => {
    setPasswordChangeError('');
    setPasswordChangeSuccess('');

    if (!currentPassword || !newPassword) {
      setPasswordChangeError('Please fill in all fields');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError('New passwords do not match');
      return;
    }

    try {
      const response = await authFetch('/auth/change-password/', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      const data = (await response.json().catch(() => ({}))) as FieldErrors;
      if (response.ok) {
        setPasswordChangeSuccess('Password updated successfully.');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => { setShowPasswordChange(false); setPasswordChangeSuccess(''); }, 1500);
      } else {
        setPasswordChangeError(data.current_password?.[0] || data.new_password?.[0] || 'Could not update password.');
      }
    } catch {
      setPasswordChangeError('Could not reach the server. Check your connection and try again.');
    }
  };

  const handleExportData = async () => {
    setExportMessage('');
    try {
      const response = await authFetch('/auth/export/');
      if (!response.ok) {
        setExportMessage("Couldn't export your data right now. Please try again.");
        return;
      }
      const data: unknown = await response.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'soullog-export.json';
      a.click();
      URL.revokeObjectURL(url);
      setExportMessage('Downloaded soullog-export.json — everything you have written and logged.');
    } catch {
      setExportMessage("Couldn't reach the server. Check your connection and try again.");
    }
  };

  const handleMobileSectionClick = (sectionId: SectionId) => {
    pushNav('Settings', sectionId);
    setActiveSection(sectionId);
    setShowMobileDetail(true);
  };

  // The arrow does what Back does, so the two never disagree.
  const handleMobileBack = () => {
    if (navState()?.tab === 'Settings' && navState()?.sub) window.history.back();
    else setShowMobileDetail(false);
  };

  /**
   * Settings save themselves.
   *
   * The only Save button lived in the wide two-column layout, which the
   * app never shows — every screen size gets the list-and-detail layout —
   * so switches moved and nothing was ever stored. Now each change is
   * sent a moment after it's made (text fields wait until you pause), and
   * the header says "Saved".
   */
  const dirty = useRef(false);
  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      autoSave();
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const autoSave = async () => {
    setSaveError('');
    try {
      const response = await authFetch('/settings/', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        // The response isn't written back into the form: you may have
        // typed more while it was in flight.
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1800);
      } else {
        setSaveError("Couldn't save that change. Please try again.");
      }
    } catch {
      setSaveError('Could not reach the server. Check your connection.');
    }
  };

  const handleSave = async () => {
    setSaveError('');
    try {
      const response = await authFetch('/settings/', {
        method: 'PATCH',
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        setSettings((await response.json()) as AppSettings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setSaveError("Couldn't save your settings. Please try again.");
      }
    } catch {
      setSaveError('Could not reach the server. Check your connection and try again.');
    }
  };

  const handleDeleteAccount = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      return;
    }
    if (!deletePassword) {
      setDeleteError('Please enter your password to confirm.');
      return;
    }
    setDeleteError('');
    try {
      const response = await authFetch('/auth/account/', {
        method: 'DELETE',
        body: JSON.stringify({ password: deletePassword }),
      });
      if (response.ok) {
        await Preferences.remove({ key: 'access_token' });
        await Preferences.remove({ key: 'refresh_token' });
        window.location.reload();
      } else {
        const data = (await response.json().catch(() => ({}))) as FieldErrors;
        setDeleteError(data.password?.[0] || 'Could not delete your account. Please try again.');
      }
    } catch {
      setDeleteError('Could not reach the server. Check your connection and try again.');
    }
  };

  // Generic over the group and the key within it, so `('privacy',
  // 'showEmail', 'yes')` is a compile error rather than a setting that
  // quietly stops being a boolean.
  const updateSetting = <S extends SettingsGroup, K extends keyof AppSettings[S]>(
    section: S,
    key: K,
    value: AppSettings[S][K],
  ) => {
    dirty.current = true;
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };




  const sections: SettingsSection[] = [
    // Most-used first: your account, then what reaches you, who sees you,
    // how you write, how it looks, community, and the rarely-needed rest.
    { id: 'profile', title: 'Profile & Account', icon: <User />, color: theme.accent },
    { id: 'notifications', title: 'Notifications', icon: <Bell />, color: theme.accent },
    { id: 'privacy', title: 'Privacy & Security', icon: <Shield />, color: theme.secondary },
    { id: 'journaling', title: 'Journaling', icon: <BookOpen />, color: theme.secondary },
    { id: 'appearance', title: 'Appearance', icon: <Palette />, color: theme.secondary },
    { id: 'social', title: 'Social Features', icon: <Users />, color: theme.accent },
    { id: 'data', title: 'Your Data', icon: <Database />, color: theme.secondary },
    { id: 'help', title: 'Help & Support', icon: <HelpCircle />, color: theme.accent },
  ];

  const handleLogout = async () => {
    if (window.confirm('Sign out of SoulLog on this device?')) {
      await logOut();
      window.location.reload();
    }
  };

  // Looked up once instead of at every point of use, so a single
  // `undefined` check narrows the type for all of them.
  const activeSectionMeta = sections.find((s) => s.id === activeSection);

  const renderProfileSettings = () => (
    <div className="space-y-4">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Full Name</label>
          <input 
            type="text" 
            value={settings.profile.name}
            onChange={(e) => updateSetting('profile', 'name', e.target.value)}
            className="w-full p-3 rounded-lg border text-sm"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Bio</label>
          <textarea 
            value={settings.profile.bio}
            onChange={(e) => updateSetting('profile', 'bio', e.target.value)}
            rows={3}
            className="w-full p-3 rounded-lg border text-sm resize-none"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Email</label>
          <input
            type="email"
            value={settings.profile.email}
            disabled
            className="w-full p-3 rounded-lg border text-sm opacity-60 cursor-not-allowed"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
          />
          <p className="text-xs opacity-60 mt-1">Changing your email isn't supported here yet — it needs its own verification flow.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Phone</label>
          <input 
            type="tel" 
            value={settings.profile.phone}
            onChange={(e) => updateSetting('profile', 'phone', e.target.value)}
            className="w-full p-3 rounded-lg border text-sm"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Location</label>
          <input 
            type="text" 
            value={settings.profile.location}
            onChange={(e) => updateSetting('profile', 'location', e.target.value)}
            className="w-full p-3 rounded-lg border text-sm"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
          />
        </div>
      </div>

      <div className="pt-4 space-y-3">
        <Button theme={theme} 
          variant="outline" 
          className="w-full"
          onClick={() => setShowPasswordChange(!showPasswordChange)}
        >
          <Lock className="w-4 h-4" />
          Change Password
        </Button>

        {showPasswordChange && (
          <div className="space-y-3 p-4 rounded-lg" style={{ backgroundColor: `${theme.secondary}10` }}>
            <input
              type="password"
              placeholder="Current Password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full p-3 rounded-lg border text-sm"
              style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
            />
            <input
              type="password"
              placeholder="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full p-3 rounded-lg border text-sm"
              style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
            />
            <input
              type="password"
              placeholder="Confirm New Password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              className="w-full p-3 rounded-lg border text-sm"
              style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
            />
            {passwordChangeError && (
              <p className="text-sm" style={{ color: '#ff4757' }}>{passwordChangeError}</p>
            )}
            {passwordChangeSuccess && (
              <p className="text-sm" style={{ color: theme.secondary }}>{passwordChangeSuccess}</p>
            )}
            <div className="flex gap-2">
              <Button theme={theme} variant="primary" size="sm" onClick={handleUpdatePassword}>Update Password</Button>
              <Button theme={theme} variant="ghost" size="sm" onClick={() => setShowPasswordChange(false)}>Cancel</Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );

  const renderDataSettings = () => (
    <div className="space-y-4">
      <p className="text-sm opacity-75">
        Everything you've written and logged — entries, mood check-ins, posts and
        settings — as one JSON file you can keep or take elsewhere.
      </p>
      <div className="space-y-3">
        <Button theme={theme} variant="outline" className="w-full" onClick={handleExportData}>
          <Download className="w-4 h-4" />
          Export My Data
        </Button>
        {exportMessage && (
          <p role="status" className="text-sm" style={{ color: theme.text, opacity: 0.8 }}>{exportMessage}</p>
        )}

        <Button theme={theme} 
          variant="danger" 
          className="w-full"
          onClick={handleDeleteAccount}
        >
          <Trash2 className="w-4 h-4" />
          {showDeleteConfirm ? 'Confirm Delete Account' : 'Delete Account'}
        </Button>

        {showDeleteConfirm && (
          <div className="p-4 rounded-lg" style={{ backgroundColor: '#ff475715', border: '1px solid #ff475730' }}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              <p className="text-sm font-medium text-red-500">This action cannot be undone</p>
            </div>
            <p className="text-xs opacity-75 mb-3">All your journals, connections, and data will be permanently deleted.</p>
            <input
              type="password"
              placeholder="Enter your password to confirm"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              className="w-full p-3 rounded-lg border text-sm mb-3"
              style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
            />
            {deleteError && (
              <p className="text-sm mb-3" style={{ color: '#ff4757' }}>{deleteError}</p>
            )}
            <div className="flex gap-2">
              <Button theme={theme} variant="danger" size="sm" onClick={handleDeleteAccount}>Yes, Delete</Button>
              <Button theme={theme} variant="ghost" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteError(''); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderHelpSettings = () => (
    <div className="space-y-2">
      <SettingItem theme={theme}
        icon={<Mail />}
        title="Contact support"
        description="Questions, bugs or ideas — write to support@soullog.app"
      >
        <a
          href="mailto:support@soullog.app?subject=SoulLog%20support"
          className="px-3 py-1.5 rounded-lg text-sm font-medium"
          style={{ backgroundColor: theme.accent, color: theme.background }}
        >
          Email us
        </a>
      </SettingItem>
      <SettingItem theme={theme}
        icon={<Lock />}
        title="Forgot your password?"
        description="Sign out, then choose “Forgot password?” on the sign-in screen for a reset link."
      />
      <SettingItem theme={theme}
        icon={<Keyboard />}
        title="Dashboard shortcuts"
        description="V view journal · T today's goal · P prompt of the day · M mood check-in"
      />
    </div>
  );

  const renderPrivacySettings = () => (
    <div className="space-y-2">
      <SettingItem theme={theme}
        icon={<Eye />}
        title="Profile Visibility"
        description="Who can see your profile"
      >
        <select 
          value={settings.privacy.profileVisibility}
          onChange={(e) => updateSetting('privacy', 'profileVisibility', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="public">Public</option>
          <option value="friends">Friends Only</option>
          <option value="private">Private</option>
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<BookOpen />}
        title="Journal Visibility"
        description="Default visibility for new journals"
      >
        <select 
          value={settings.privacy.journalVisibility}
          onChange={(e) => updateSetting('privacy', 'journalVisibility', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="public">Public</option>
          <option value="friends">Friends Only</option>
          <option value="private">Private</option>
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Mail />}
        title="Show Email"
        description="Display email on profile"
      >
        <Toggle theme={theme} 
          enabled={settings.privacy.showEmail}
          onToggle={() => updateSetting('privacy', 'showEmail', !settings.privacy.showEmail)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Phone />}
        title="Show Phone"
        description="Display phone number on profile"
      >
        <Toggle theme={theme} 
          enabled={settings.privacy.showPhone}
          onToggle={() => updateSetting('privacy', 'showPhone', !settings.privacy.showPhone)}
        />
      </SettingItem>

      {/* Reciprocal, and the description says so plainly rather than
          leaving people to discover it. Turning this on is what starts
          any recording at all: with it off, nobody is told you looked at
          their profile and nobody who looks at yours is recorded. */}
      <SettingItem theme={theme}
        icon={<Eye />}
        title="Profile Views"
        description="See who viewed your profile — and let them see when you view theirs. Off for both when this is off."
      >
        <Toggle theme={theme}
          enabled={settings.privacy.showProfileViews}
          onToggle={() => updateSetting('privacy', 'showProfileViews', !settings.privacy.showProfileViews)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Users />}
        title="Allow Messages"
        description="Who can send you messages"
      >
        <select 
          value={settings.privacy.allowMessages}
          onChange={(e) => updateSetting('privacy', 'allowMessages', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="everyone">Everyone</option>
          <option value="friends">Friends Only</option>
          <option value="none">No One</option>
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Users />}
        title="Mentoring Available"
        description="Show as available for mentoring"
      >
        <Toggle theme={theme} 
          enabled={settings.privacy.mentorAvailable}
          onToggle={() => updateSetting('privacy', 'mentorAvailable', !settings.privacy.mentorAvailable)}
        />
      </SettingItem>
    </div>
  );

  const renderNotificationSettings = () => (
    <div className="space-y-4">
      <SettingItem theme={theme}
        icon={<Bell />}
        title="Notifications"
        description="Everything in your notification bell. Off means none at all"
      >
        <Toggle theme={theme} 
          enabled={settings.notifications.pushEnabled}
          onToggle={() => updateSetting('notifications', 'pushEnabled', !settings.notifications.pushEnabled)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Users />}
        title="Social Interactions"
        description="Likes, comments, and follows"
      >
        <Toggle theme={theme} 
          enabled={settings.notifications.socialInteractions}
          onToggle={() => updateSetting('notifications', 'socialInteractions', !settings.notifications.socialInteractions)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Settings />}
        title="Achievements"
        description="New badges and milestones"
      >
        <Toggle theme={theme} 
          enabled={settings.notifications.achievements}
          onToggle={() => updateSetting('notifications', 'achievements', !settings.notifications.achievements)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Mail />}
        title="Weekly Digest"
        description="Summary of your week's progress"
      >
        <Toggle theme={theme} 
          enabled={settings.notifications.weeklyDigest}
          onToggle={() => updateSetting('notifications', 'weeklyDigest', !settings.notifications.weeklyDigest)}
        />
      </SettingItem>
    </div>
  );

  const renderJournalingSettings = () => (
    <div className="space-y-4">
      {/* The two numbers the Dashboard's goal ring and weekly bar measure
          against. They used to be a fixed "2 of 3" and "3 of 5" that no
          setting could change. */}
      <SettingItem theme={theme}
        icon={<Target />}
        title="Daily Goal"
        description="Journal entries per day"
      >
        <select
          value={settings.journaling.dailyGoal ?? 1}
          onChange={(e) => updateSetting('journaling', 'dailyGoal', Number(e.target.value))}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Calendar />}
        title="Weekly Goal"
        description="Journal entries per week"
      >
        <select
          value={settings.journaling.weeklyGoal ?? 5}
          onChange={(e) => updateSetting('journaling', 'weeklyGoal', Number(e.target.value))}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          {[1, 2, 3, 4, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Save />}
        title="Auto-Save"
        description="Automatically save drafts while writing"
      >
        <Toggle theme={theme} 
          enabled={settings.journaling.autoSave}
          onToggle={() => updateSetting('journaling', 'autoSave', !settings.journaling.autoSave)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<BookOpen />}
        title="Default Template"
        description="Template for new journal entries"
      >
        <select 
          value={settings.journaling.defaultTemplate}
          onChange={(e) => updateSetting('journaling', 'defaultTemplate', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="blank">Blank</option>
          <option value="gratitude">Gratitude</option>
          <option value="reflection">Daily Reflection</option>
          <option value="goals">Goals & Progress</option>
          <option value="mindfulness">Mindfulness</option>
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Settings />}
        title="Mood Tracking"
        description="Track your mood with each entry"
      >
        <Toggle theme={theme} 
          enabled={settings.journaling.moodTracking}
          onToggle={() => updateSetting('journaling', 'moodTracking', !settings.journaling.moodTracking)}
        />
      </SettingItem>

    </div>
  );

  const renderSocialSettings = () => (
    <div className="space-y-4">
      <SettingItem theme={theme}
        icon={<Users />}
        title="Connection Recommendations"
        description="Get suggested connections based on your interests and goals"
      >
        <Toggle theme={theme} 
          enabled={settings.social.connectionRecommendations}
          onToggle={() => updateSetting('social', 'connectionRecommendations', !settings.social.connectionRecommendations)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Users />}
        title="Friend Requests"
        description="Who can send you friend/connection requests"
      >
        <select 
          value={settings.social.friendRequests}
          onChange={(e) => updateSetting('social', 'friendRequests', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="everyone">Everyone</option>
          <option value="friends">Friends of Friends</option>
          <option value="none">No One</option>
        </select>
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Eye />}
        title="Online Status"
        description="Show when you're active on SoulLog to your connections"
      >
        <Toggle theme={theme} 
          enabled={settings.social.onlineStatus}
          onToggle={() => updateSetting('social', 'onlineStatus', !settings.social.onlineStatus)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Settings />}
        title="Daily Inspiration"
        description="Show a quote of the day on your dashboard"
      >
        <Toggle theme={theme} 
          enabled={settings.social.inspirationFeed}
          onToggle={() => updateSetting('social', 'inspirationFeed', !settings.social.inspirationFeed)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Users />}
        title="Allow Followers"
        description="Let others follow you to see what you share with the community"
      >
        <Toggle theme={theme} 
          enabled={settings.social.followSystem}
          onToggle={() => updateSetting('social', 'followSystem', !settings.social.followSystem)}
        />
      </SettingItem>

      <SettingItem theme={theme}
        icon={<Settings />}
        title="Show My Badges"
        description="Let others see the badges on your profile"
      >
        <Toggle theme={theme} 
          enabled={settings.social.achievementSharing}
          onToggle={() => updateSetting('social', 'achievementSharing', !settings.social.achievementSharing)}
        />
      </SettingItem>

      {/* Social Management Options */}
      <div className="pt-4 border-t space-y-3" style={{ borderColor: theme.border }}>
        <SettingItem theme={theme}
          icon={<Users />}
          title="Blocked Users"
          description={
            blocked.length === 0
              ? "You haven't blocked anyone"
              : `${blocked.length} blocked account${blocked.length === 1 ? '' : 's'}`
          }
          onClick={() => setShowBlocked((open) => !open)}
          showChevron
        />

        {showBlocked && (
          <div
            className="rounded-lg p-3 space-y-2"
            style={{ backgroundColor: theme.background, border: `1px solid ${theme.border}` }}
          >
            {socialError && <p className="text-xs opacity-80">{socialError}</p>}
            {blocked.length === 0 && (
              <p className="text-sm opacity-70">Nobody is blocked.</p>
            )}
            {blocked.map((user) => (
              <div key={user.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: theme.text }}>
                    {user.name}
                  </p>
                  <p className="text-xs opacity-60 truncate">@{user.username}</p>
                </div>
                <button
                  onClick={() => unblock(user)}
                  className="text-xs px-3 py-1 rounded-lg"
                  style={{ border: `1px solid ${theme.border}`, color: theme.text }}
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}

        <SettingItem theme={theme}
          icon={<BookOpen />}
          title="Saved Posts"
          description={
            savedCount === null
              ? 'Your bookmarked posts'
              : `${savedCount} saved post${savedCount === 1 ? '' : 's'}`
          }
          onClick={() => setActiveTab?.('Community')}
          showChevron
        />
      </div>
    </div>
  );

  const renderAppearanceSettings = () => (
    <div className="space-y-4">
      {/* Dark mode is the switch at the bottom of the left bar. */}
      <SettingItem theme={theme}
        icon={<Settings />}
        title="Font Size"
        description="Adjust text size for better readability. Dark or light mode is the switch at the bottom of the left bar."
      >
        <select 
          value={settings.appearance.fontSize}
          onChange={(e) => {
            // Applied immediately so the change is visible before saving;
            // saved with the rest when you press Save.
            applyFontSize(e.target.value);
            updateSetting('appearance', 'fontSize', e.target.value);
          }}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </SettingItem>

    </div>
  );

  // Mobile Settings List Component
  // Called as functions below, not rendered as <MobileSettingsList />:
  // declared in here, a component would be re-created on every render and
  // React would rebuild everything inside it, text fields included.
  const renderMobileSettingsList = () => (
    <div className="space-y-2">
      {sections.map((section) => (
        <div
          key={section.id}
          onClick={() => {
            handleMobileSectionClick(section.id);
          }}
          className="flex items-center py-3 rounded-lg cursor-pointer transition-all duration-300 hover:scale-101"
          style={{ 
            backgroundColor: `${theme.surface}`,
            border: `1px solid ${theme.border}`
          }}
        >
          <div 
            className="w-14 h-14 flex items-center justify-center flex-shrink-0"
          >
            {React.cloneElement(section.icon, { 
              className: "w-5 h-5", 
              style: { color: theme.accent } 
            })}
          </div>
          
          <div className="flex-1 min-w-0">
            <h4 className="font-medium" style={{ color: theme.color }}>
              {section.title}
            </h4>
            <p className="text-sm opacity-60 truncate">
              {section.id === 'profile' && 'Account & personal info'}
              {section.id === 'privacy' && 'Visibility & security'}
              {section.id === 'notifications' && 'Alerts & reminders'}
              {section.id === 'journaling' && 'Writing preferences'}
              {section.id === 'social' && 'Community & connections'}
              {section.id === 'appearance' && 'Text size'}
              {section.id === 'data' && 'Export or delete your account'}
              {section.id === 'help' && 'Contact support & tips'}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 opacity-60 flex-shrink-0 me-3" />
        </div>
      ))}

      <button
        onClick={handleLogout}
        className="w-full flex items-center py-3 rounded-lg cursor-pointer transition-all duration-300 text-left mt-4"
        style={{ backgroundColor: `${theme.surface}`, border: '1px solid #ff475740', color: '#ff6b6b' }}
      >
        <div className="w-14 h-14 flex items-center justify-center flex-shrink-0">
          <LogOut className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium">Sign Out</h4>
          <p className="text-sm opacity-70 truncate">Sign out of SoulLog on this device</p>
        </div>
      </button>
    </div>
  );

  // Mobile Detail View Component
  const renderMobileDetailView = () => {
    return (
      <>
        {/* Mobile Header with Back Button */}
        <div className="p-4 border-b flex-shrink-0 flex items-center gap-4" style={{ 
          borderColor: theme.border,
          backgroundColor: theme.surface
        }}>
          <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" onClick={handleMobileBack} />
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold" style={{ color: theme.text}}>
              {activeSectionMeta?.title || 'Settings'}
            </h3>
            <p className="text-sm opacity-75">
              {activeSection === 'profile' && 'Manage your profile information and account settings'}
              {activeSection === 'privacy' && 'Control who sees your information and content'}
              {activeSection === 'notifications' && 'Customize your notification preferences'}
              {activeSection === 'journaling' && 'Personalize your journaling experience'}
              {activeSection === 'social' && 'Connect with mindful community and share your journey'}
              {activeSection === 'appearance' && 'Adjust how text is displayed'}
              {activeSection === 'data' && 'Download everything, or delete your account'}
              {activeSection === 'help' && 'Get in touch, and a few tips'}
            </p>
          </div>
        </div>

        {(saved || saveError) && (
          <div role="status" className="px-4 py-2 text-sm flex items-center gap-2" style={{ color: saveError ? '#ff6b6b' : theme.secondary }}>
            {saveError ? saveError : (<><Check className="w-4 h-4" /> Saved</>)}
          </div>
        )}

        {/* Mobile Settings Content - Only this part scrolls */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderActiveSection()}
        </div>
      </>
    )};

  const renderActiveSection = () => {
    switch(activeSection) {
      case 'profile': return renderProfileSettings();
      case 'privacy': return renderPrivacySettings();
      case 'notifications': return renderNotificationSettings();
      case 'journaling': return renderJournalingSettings();
      case 'social': return renderSocialSettings();
      case 'appearance': return renderAppearanceSettings();
      case 'data': return renderDataSettings();
      case 'help': return renderHelpSettings();
      default: return renderProfileSettings();
    }
  };

  useEffect(() => {
    setHideExtra(true);
    return () => setHideExtra(false);
    // Runs once, on mount. `setHideExtra` is a setter owned by the
    // parent and stable in practice; listing it would re-run this
    // effect on every parent render, which is not what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className='flex flex-col text-left main-content' style={{ backgroundColor: theme.background, color: theme.text, fontFamily: "'Merriweather', sans-serif" }}>
      {/* Mobile View */}
      {isMobile ? (
          !showMobileDetail ? (
            <>
              {/* Mobile Header - Fixed */}
              <div className='header px-3 py-4 gap-5 !justify-start' style={{borderColor: theme.border, backgroundColor: theme.background}}>
                <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" onClick={() => goBack(() => setActiveTab("Dashboard"))} />
                <div className="flex-shrink-0 sticky top-0">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Settings size={16} style={{ color: theme.accent }} />
                    Settings
                  </h3>
                  <p className="text-sm opacity-75">Changes save automatically</p>
                </div>
              </div>
              
              {/* Mobile Settings List - Fixed, non-scrollable */}
              <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                {renderMobileSettingsList()}
              </div>
            </>
          ) : (
            renderMobileDetailView()
          )
      ) : (
        /* Desktop View */
        <>
          
          {/* Fixed Header */}
          <div className="flex items-center justify-between p-4 border-b flex-shrink-0" style={{ borderColor: theme.border, backgroundColor: theme.background }}>
            <h3 className="text-xl flex items-center gap-2">
              <Settings className="w-5 h-5" style={{ color: theme.accent }} />
              Settings
            </h3>
            
            <div className="flex items-center gap-3">
              {saveError && (
                <span className="text-sm" style={{ color: '#ff4757' }}>{saveError}</span>
              )}
              {saved && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: `${theme.secondary}20`, color: theme.secondary }}>
                  <Check className="w-4 h-4" />
                  <span className="text-sm font-medium">Saved!</span>
                </div>
              )}
              <Button theme={theme} onClick={handleSave} size="sm">
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          </div>

          {/* Main Layout - Chat-like Interface */}
          <div className="flex flex-1 overflow-hidden text-left" style={{ backgroundColor: theme.cardBg, borderColor: `${theme.accent}30` }}>
            
            {/* Fixed Left Sidebar - Settings List */}
            <div className="w-72 border-r flex-shrink-0" style={{ backgroundColor: `${theme.background}95`, borderColor: theme.border }}>
              {/* Settings List */}
              <div className="h-full py-2">
                {sections.map((section) => (
                  <div
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`flex items-center gap-3 p-3 mx-2 my-1 rounded-xl cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:shadow-lg group ${
                      activeSection === section.id ? 'shadow-xl' : ''
                    }`}
                    style={{ 
                      backgroundColor: activeSection === section.id 
                        ? `${section.color}20` 
                        : 'transparent',
                      border: activeSection === section.id 
                        ? `2px solid ${section.color}40` 
                        : '2px solid transparent'
                    }}
                  >
                    <div className="relative">
                      <div 
                        className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300 group-hover:scale-110 ${
                          activeSection === section.id ? 'shadow-lg' : ''
                        }`}
                        style={{ 
                          background: activeSection === section.id 
                            ? `linear-gradient(135deg, ${section.color}, ${section.color}cc)`
                            : `${section.color}25`,
                          boxShadow: activeSection === section.id 
                            ? `0 6px 20px ${section.color}40`
                            : 'none'
                        }}
                      >
                        {React.cloneElement(section.icon, { 
                          className: "w-5 h-5", 
                          style: { color: activeSection === section.id ? '#FFFFFF' : section.color } 
                        })}
                      </div>
                      {activeSection === section.id && (
                        <div 
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center"
                          style={{ backgroundColor: section.color }}
                        >
                          <div className="w-2 h-2 bg-white rounded-full"></div>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h3 className={`font-semibold text-sm transition-all duration-300 ${
                        activeSection === section.id ? 'text-base' : ''
                      }`} style={{ 
                        color: activeSection === section.id ? section.color : theme.text 
                      }}>
                        {section.title}
                      </h3>
                      <p className={`text-xs opacity-60 mt-0.5 transition-all duration-300 ${
                        activeSection === section.id ? 'opacity-80' : ''
                      }`}>
                        {section.id === 'profile' && '👤 Account & personal info'}
                        {section.id === 'privacy' && '🔒 Visibility & security'}
                        {section.id === 'notifications' && '🔔 Alerts & reminders'}
                        {section.id === 'journaling' && '📝 Writing preferences'}
                        {section.id === 'social' && '👥 Community & connections'}
                        {section.id === 'appearance' && '🎨 Theme & display'}
                      </p>
                    </div>

                    {activeSection === section.id && (
                      <div className="ml-2">
                        <div 
                          className="w-1.5 h-6 rounded-full"
                          style={{ backgroundColor: section.color }}
                        ></div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Right Side - Scrollable Settings Details */}
            <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: theme.cardBg }}>
              {activeSection && activeSectionMeta ? (
                <>
                  {/* Fixed Settings Header */}
                  <div className="p-3 border-b flex-shrink-0" style={{ 
                    borderColor: theme.border,
                    backgroundColor: `${activeSectionMeta?.color}08`
                  }}>
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <div 
                          className="w-10 h-10 rounded-xl flex items-center justify-center shadow-xl"
                          style={{ 
                            background: `linear-gradient(135deg, ${activeSectionMeta?.color || theme.accent}, ${activeSectionMeta?.color || theme.accent}cc)`,
                            boxShadow: `0 8px 32px ${activeSectionMeta?.color || theme.accent}30`
                          }}
                        >
                          {activeSectionMeta?.icon && React.cloneElement(activeSectionMeta.icon, { 
                            className: "w-5 h-5", 
                            style: { color: '#FFFFFF' } 
                          })}
                        </div>
                        <div 
                          className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center border-2"
                          style={{ 
                            backgroundColor: theme.secondary,
                            borderColor: theme.cardBg
                          }}
                        >
                          <div className="w-1 h-1 bg-white rounded-full"></div>
                        </div>
                      </div>
                      <div>
                        <h2 className="text-xl font-bold" style={{ color: activeSectionMeta?.color || theme.accent }}>
                          {activeSectionMeta?.title || 'Settings'}
                        </h2>
                        <p className="text-base opacity-75 flex items-center gap-2">
                          <span>✨</span>
                          {activeSection === 'profile' && 'Manage your profile information and account settings'}
                          {activeSection === 'privacy' && 'Control who can see your information and content'}
                          {activeSection === 'notifications' && 'Customize your notification preferences'}
                          {activeSection === 'journaling' && 'Personalize your journaling experience'}
                          {activeSection === 'social' && 'Connect with the mindful community and share your journey'}
                          {activeSection === 'appearance' && 'Adjust how text is displayed'}
                          {activeSection === 'data' && 'Download everything, or delete your account'}
                          {activeSection === 'help' && 'Get in touch, and a few tips'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Scrollable Settings Content */}
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="max-w-3xl">
                      {renderActiveSection()}
                    </div>
                  </div>
                </>
              ) : (
                /* Empty State */
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-center">
                    <div className="relative mb-8">
                      <div 
                        className="w-32 h-32 rounded-3xl mx-auto flex items-center justify-center shadow-2xl"
                        style={{ 
                          background: `linear-gradient(135deg, ${theme.accent}, ${theme.secondary})`,
                          boxShadow: `0 20px 60px ${theme.accent}30`
                        }}
                      >
                        <Settings className="w-16 h-16 text-white" />
                      </div>
                      <div 
                        className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: theme.secondary }}
                      >
                        <span className="text-white text-sm">✨</span>
                      </div>
                    </div>
                    <h2 className="text-3xl font-bold mb-4" style={{ color: theme.accent }}>
                      Configure Your SoulLog
                    </h2>
                    <p className="text-lg opacity-75 max-w-md mx-auto">
                      Select a setting category from the sidebar to personalize your journaling experience ✨
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SoulLogSettings;

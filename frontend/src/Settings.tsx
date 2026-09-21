import React, { useEffect, useState } from 'react';
import {
  User, Lock, Bell, Shield, BookOpen, Users, Palette, Globe,
  ChevronRight, Moon, Sun, Mail, Phone,
  Download, Trash2, Eye, Settings,
  ArrowLeft, Save, AlertTriangle, Check
} from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import { ApiError, del, get, type PublicUser } from './api';
import type { Theme } from './theme';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
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

/** The sidebar sections, which are also the keys of `AppSettings`. */
type SectionId = keyof AppSettings;

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

const SoulLogSettings = ({ theme, setHideExtra, isMobile=true, setActiveTab } : MessagePageProps) => {
  const [darkMode, setDarkMode] = useState(true);
  const [activeSection, setActiveSection] = useState<SectionId>('profile');
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
  const [showMobileDetail, setShowMobileDetail] = useState(false);

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
      streakNotifications: true
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
    try {
      const response = await authFetch('/auth/export/');
      if (!response.ok) {
        alert("Couldn't export your data right now. Please try again.");
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
    } catch {
      alert('Could not reach the server. Check your connection and try again.');
    }
  };

  const handleMobileSectionClick = (sectionId: SectionId) => {
    setActiveSection(sectionId);
    setShowMobileDetail(true);
  };

  const handleMobileBack = () => {
    setShowMobileDetail(false);
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
  const updateSetting = <S extends SectionId, K extends keyof AppSettings[S]>(
    section: S,
    key: K,
    value: AppSettings[S][K],
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }));
  };

  const Button = ({ children, variant = "primary", size = "md", className = "", onClick, disabled = false }: ButtonProps) => {
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

  const Toggle = ({ enabled, onToggle, size = "md" }: ToggleProps) => (
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

  const SettingItem = ({ icon, title, description, children, onClick, showChevron = false }: SettingItemProps) => (
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

  const sections: SettingsSection[] = [
    { id: 'profile', title: 'Profile & Account', icon: <User />, color: theme.accent },
    { id: 'privacy', title: 'Privacy & Security', icon: <Shield />, color: theme.secondary },
    { id: 'notifications', title: 'Notifications', icon: <Bell />, color: theme.accent },
    { id: 'journaling', title: 'Journaling', icon: <BookOpen />, color: theme.secondary },
    { id: 'social', title: 'Social Features', icon: <Users />, color: theme.accent },
    { id: 'appearance', title: 'Appearance', icon: <Palette />, color: theme.secondary }
  ];

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
        <Button 
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
              <Button variant="primary" size="sm" onClick={handleUpdatePassword}>Update Password</Button>
              <Button variant="ghost" size="sm" onClick={() => setShowPasswordChange(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <Button variant="outline" className="w-full" onClick={handleExportData}>
          <Download className="w-4 h-4" />
          Export My Data
        </Button>

        <Button 
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
              <Button variant="danger" size="sm" onClick={handleDeleteAccount}>Yes, Delete</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteError(''); }}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderPrivacySettings = () => (
    <div className="space-y-2">
      <SettingItem
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

      <SettingItem
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

      <SettingItem
        icon={<Mail />}
        title="Show Email"
        description="Display email on profile"
      >
        <Toggle 
          enabled={settings.privacy.showEmail}
          onToggle={() => updateSetting('privacy', 'showEmail', !settings.privacy.showEmail)}
        />
      </SettingItem>

      <SettingItem
        icon={<Phone />}
        title="Show Phone"
        description="Display phone number on profile"
      >
        <Toggle 
          enabled={settings.privacy.showPhone}
          onToggle={() => updateSetting('privacy', 'showPhone', !settings.privacy.showPhone)}
        />
      </SettingItem>

      {/* Reciprocal, and the description says so plainly rather than
          leaving people to discover it. Turning this on is what starts
          any recording at all: with it off, nobody is told you looked at
          their profile and nobody who looks at yours is recorded. */}
      <SettingItem
        icon={<Eye />}
        title="Profile Views"
        description="See who viewed your profile — and let them see when you view theirs. Off for both when this is off."
      >
        <Toggle
          enabled={settings.privacy.showProfileViews}
          onToggle={() => updateSetting('privacy', 'showProfileViews', !settings.privacy.showProfileViews)}
        />
      </SettingItem>

      <SettingItem
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

      <SettingItem
        icon={<Users />}
        title="Mentoring Available"
        description="Show as available for mentoring"
      >
        <Toggle 
          enabled={settings.privacy.mentorAvailable}
          onToggle={() => updateSetting('privacy', 'mentorAvailable', !settings.privacy.mentorAvailable)}
        />
      </SettingItem>
    </div>
  );

  const renderNotificationSettings = () => (
    <div className="space-y-4">
      <SettingItem
        icon={<Bell />}
        title="Push Notifications"
        description="Receive notifications on your device"
      >
        <Toggle 
          enabled={settings.notifications.pushEnabled}
          onToggle={() => updateSetting('notifications', 'pushEnabled', !settings.notifications.pushEnabled)}
        />
      </SettingItem>

      <SettingItem
        icon={<Mail />}
        title="Email Notifications"
        description="Receive notifications via email"
      >
        <Toggle 
          enabled={settings.notifications.emailEnabled}
          onToggle={() => updateSetting('notifications', 'emailEnabled', !settings.notifications.emailEnabled)}
        />
      </SettingItem>

      <SettingItem
        icon={<BookOpen />}
        title="Journal Reminders"
        description="Daily reminders to write in your journal"
      >
        <Toggle 
          enabled={settings.notifications.journalReminder}
          onToggle={() => updateSetting('notifications', 'journalReminder', !settings.notifications.journalReminder)}
        />
      </SettingItem>

      <SettingItem
        icon={<Users />}
        title="Social Interactions"
        description="Likes, comments, and follows"
      >
        <Toggle 
          enabled={settings.notifications.socialInteractions}
          onToggle={() => updateSetting('notifications', 'socialInteractions', !settings.notifications.socialInteractions)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Achievements"
        description="New badges and milestones"
      >
        <Toggle 
          enabled={settings.notifications.achievements}
          onToggle={() => updateSetting('notifications', 'achievements', !settings.notifications.achievements)}
        />
      </SettingItem>

      <SettingItem
        icon={<Mail />}
        title="Weekly Digest"
        description="Summary of your week's progress"
      >
        <Toggle 
          enabled={settings.notifications.weeklyDigest}
          onToggle={() => updateSetting('notifications', 'weeklyDigest', !settings.notifications.weeklyDigest)}
        />
      </SettingItem>
    </div>
  );

  const renderJournalingSettings = () => (
    <div className="space-y-4">
      <SettingItem
        icon={<Save />}
        title="Auto-Save"
        description="Automatically save drafts while writing"
      >
        <Toggle 
          enabled={settings.journaling.autoSave}
          onToggle={() => updateSetting('journaling', 'autoSave', !settings.journaling.autoSave)}
        />
      </SettingItem>

      <SettingItem
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

      <SettingItem
        icon={<Settings />}
        title="Mood Tracking"
        description="Track your mood with each entry"
      >
        <Toggle 
          enabled={settings.journaling.moodTracking}
          onToggle={() => updateSetting('journaling', 'moodTracking', !settings.journaling.moodTracking)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Goal Reminders"
        description="Reminders about your personal goals"
      >
        <Toggle 
          enabled={settings.journaling.goalReminders}
          onToggle={() => updateSetting('journaling', 'goalReminders', !settings.journaling.goalReminders)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Streak Notifications"
        description="Celebrate your writing streaks"
      >
        <Toggle 
          enabled={settings.journaling.streakNotifications}
          onToggle={() => updateSetting('journaling', 'streakNotifications', !settings.journaling.streakNotifications)}
        />
      </SettingItem>
    </div>
  );

  const renderSocialSettings = () => (
    <div className="space-y-4">
      <SettingItem
        icon={<Users />}
        title="Connection Recommendations"
        description="Get suggested connections based on your interests and goals"
      >
        <Toggle 
          enabled={settings.social.connectionRecommendations}
          onToggle={() => updateSetting('social', 'connectionRecommendations', !settings.social.connectionRecommendations)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Activity Sharing"
        description="Automatically share achievements, milestones, and journal streaks"
      >
        <Toggle 
          enabled={settings.social.activitySharing}
          onToggle={() => updateSetting('social', 'activitySharing', !settings.social.activitySharing)}
        />
      </SettingItem>

      <SettingItem
        icon={<Bell />}
        title="Mention Notifications"
        description="Get notified when someone mentions you in comments or posts"
      >
        <Toggle 
          enabled={settings.social.mentionNotifications}
          onToggle={() => updateSetting('social', 'mentionNotifications', !settings.social.mentionNotifications)}
        />
      </SettingItem>

      <SettingItem
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

      <SettingItem
        icon={<Eye />}
        title="Online Status"
        description="Show when you're active on SoulLog to your connections"
      >
        <Toggle 
          enabled={settings.social.onlineStatus}
          onToggle={() => updateSetting('social', 'onlineStatus', !settings.social.onlineStatus)}
        />
      </SettingItem>

      <SettingItem
        icon={<BookOpen />}
        title="Journal Sharing"
        description="Allow sharing your journal entries with friends and community"
      >
        <Toggle 
          enabled={settings.social.journalSharing}
          onToggle={() => updateSetting('social', 'journalSharing', !settings.social.journalSharing)}
        />
      </SettingItem>

      <SettingItem
        icon={<Users />}
        title="Community Groups"
        description="Join and participate in mindfulness and journaling communities"
      >
        <Toggle 
          enabled={settings.social.communityJoining}
          onToggle={() => updateSetting('social', 'communityJoining', !settings.social.communityJoining)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Inspiration Feed"
        description="See inspiring quotes, stories, and posts from the community"
      >
        <Toggle 
          enabled={settings.social.inspirationFeed}
          onToggle={() => updateSetting('social', 'inspirationFeed', !settings.social.inspirationFeed)}
        />
      </SettingItem>

      <SettingItem
        icon={<Eye />}
        title="Public Profile"
        description="Make your profile discoverable to help others find you"
      >
        <Toggle 
          enabled={settings.social.publicProfile}
          onToggle={() => updateSetting('social', 'publicProfile', !settings.social.publicProfile)}
        />
      </SettingItem>

      <SettingItem
        icon={<Users />}
        title="Follow System"
        description="Allow others to follow your public journal entries and updates"
      >
        <Toggle 
          enabled={settings.social.followSystem}
          onToggle={() => updateSetting('social', 'followSystem', !settings.social.followSystem)}
        />
      </SettingItem>

      <SettingItem
        icon={<BookOpen />}
        title="Group Discussions"
        description="Participate in topic-based discussions and Q&A sessions"
      >
        <Toggle 
          enabled={settings.social.groupDiscussions}
          onToggle={() => updateSetting('social', 'groupDiscussions', !settings.social.groupDiscussions)}
        />
      </SettingItem>

      <SettingItem
        icon={<Settings />}
        title="Achievement Sharing"
        description="Share your badges, streaks, and milestones with the community"
      >
        <Toggle 
          enabled={settings.social.achievementSharing}
          onToggle={() => updateSetting('social', 'achievementSharing', !settings.social.achievementSharing)}
        />
      </SettingItem>

      {/* Social Management Options */}
      <div className="pt-4 border-t space-y-3" style={{ borderColor: theme.border }}>
        <SettingItem
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

        <SettingItem
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
      {/* Only show dark mode toggle on mobile */}
      <div className="block md:hidden">
        <SettingItem
          icon={darkMode ? <Moon /> : <Sun />}
          title="Dark Mode"
          description="Switch between light and dark themes"
        >
          <Toggle 
            enabled={darkMode}
            onToggle={() => setDarkMode(!darkMode)}
          />
        </SettingItem>
      </div>

      <SettingItem
        icon={<Settings />}
        title="Font Size"
        description="Adjust text size for better readability"
      >
        <select 
          value={settings.appearance.fontSize}
          onChange={(e) => updateSetting('appearance', 'fontSize', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </SettingItem>

      <SettingItem
        icon={<Globe />}
        title="Language"
        description="Choose your preferred language"
      >
        <select 
          value={settings.appearance.language}
          onChange={(e) => updateSetting('appearance', 'language', e.target.value)}
          className="px-3 py-1 rounded text-sm border"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border, color: theme.text }}
        >
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
          <option value="de">Deutsch</option>
          <option value="pt">Português</option>
        </select>
      </SettingItem>
    </div>
  );

  // Mobile Settings List Component
  const MobileSettingsList = () => (
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
              {section.id === 'appearance' && 'Theme & display'}
            </p>
          </div>

          <ChevronRight className="w-5 h-5 opacity-60 flex-shrink-0 me-3" />
        </div>
      ))}
    </div>
  );

  // Mobile Detail View Component
  const MobileDetailView = () => {
    return (
      <>
        {/* Mobile Header with Back Button */}
        <div className="p-4 border-b flex-shrink-0 flex items-center gap-4" style={{ 
          borderColor: theme.border,
          backgroundColor: theme.surface
        }}>
          <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" onClick={handleMobileBack} />
          <div>
            <h3 className="text-lg font-bold" style={{ color: theme.text}}>
              {activeSectionMeta?.title || 'Settings'}
            </h3>
            <p className="text-sm opacity-75">
              {activeSection === 'profile' && 'Manage your profile information and account settings'}
              {activeSection === 'privacy' && 'Control who sees your information and content'}
              {activeSection === 'notifications' && 'Customize your notification preferences'}
              {activeSection === 'journaling' && 'Personalize your journaling experience'}
              {activeSection === 'social' && 'Connect with mindful community and share your journey'}
              {activeSection === 'appearance' && 'Customize the app appearance and language'}
            </p>
          </div>
        </div>

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
                <ArrowLeft className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" onClick={() => setActiveTab("Accounts")} />
                <div className="flex-shrink-0 sticky top-0">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <Settings size={16} style={{ color: theme.accent }} />
                    Settings
                  </h3>
                  <p className="text-sm opacity-75">Configure your SoulLog experience</p>
                </div>
              </div>
              
              {/* Mobile Settings List - Fixed, non-scrollable */}
              <div className="flex-1 flex flex-col p-4 overflow-y-auto">
                <MobileSettingsList />
              </div>
            </>
          ) : (
            <MobileDetailView />
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
              <Button onClick={handleSave} size="sm">
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
                          {activeSection === 'appearance' && 'Customize the app appearance and language'}
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

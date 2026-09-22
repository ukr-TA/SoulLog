import type React from 'react';
import { useEffect, useState } from 'react';
import { get } from './api';
import { 
  User, Settings, Moon, Sun, LogOut, Shield, HelpCircle, 
  Database, X
} from 'lucide-react';
import { saveTheme, logOut } from './session';
import type { Theme } from './theme';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
  isMobile?: boolean;
  setHideExtra: (hide: boolean) => void;
  setDarkMode: (dark: boolean) => void;
  setActiveTab: (tab: string) => void;
}

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps {
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  onClick?: () => void;
}

interface ToggleProps {
  enabled?: boolean;
  onToggle: () => void;
  size?: ButtonSize;
}

const Button = ({ children, variant = "primary", size = "md", className = "", onClick, theme }: ButtonProps  & { theme: Theme }) => {
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

const AccountsPage = ({ theme, setHideExtra, darkMode, setDarkMode, setActiveTab } : MessagePageProps) => {
  const [exportError, setExportError] = useState<string | null>(null);


  useEffect(() => {
    setHideExtra(true);
    return () => setHideExtra(false);
  }, [setHideExtra])

  const menuItems = [
    { 
      icon: User, 
      label: 'Profile', 
      action: () => setActiveTab('Profile'),
      description: 'View and edit your profile'
    },
    { 
      icon: Settings, 
      label: 'Settings', 
      action: () => setActiveTab('Settings'),
      description: 'Account preferences and configuration'
    },
    { 
      icon: Shield, 
      label: 'Privacy & Security', 
      // Privacy controls already live inside Settings; this opens them
      // rather than promising a separate screen that doesn't exist.
      action: () => setActiveTab('Settings'),
      description: 'Control your privacy and security settings'
    },
    { 
      icon: Database, 
      label: 'Data Export', 
      action: () => exportMyData(),
      description: 'Download your journal entries and data'
    },
    { 
      icon: HelpCircle, 
      label: 'Help & Support', 
      action: () => { window.location.href = 'mailto:support@soullog.app?subject=SoulLog%20support'; },
      description: 'Get help and contact support'
    }
    // 'Billing' has been removed: SoulLog has no subscription or payment
    // system, and per the spec none is planned — a row leading to a
    // billing screen would be advertising something that isn't there.
  ];

  /**
   * Data export — the real one.
   *
   * The endpoint has existed since the settings milestone; nothing in the
   * UI called it. This downloads the JSON the server produces rather than
   * assembling something client-side that might disagree with it.
   */
  const exportMyData = async () => {
    try {
      // The export's shape is the server's business — it is only ever
      // re-serialised into the downloaded file, never read field by field.
      const data = await get<unknown>('/auth/export/');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `soullog-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Couldn't prepare your export. Please try again.");
    }
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to log out?')) {
      await logOut();
      window.location.reload();
    }
  };



  return (
    <div className='main-content text-left' style={{ backgroundColor: theme.background, minHeight: '100vh' }}>
        <>
          {/* Off-canvas Panel */}
          <div 
            className="h-full w-full z-50 transform transition-transform duration-300 ease-in-out overflow-y-scroll"
            style={{ backgroundColor: theme.background }}
          >
            {/* Accounts Menu */}
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="px-4 py-4 header border-b flex items-center justify-between" style={{ borderColor: theme.border }}>
                  <h3 className="text-xl font-bold" style={{ color: theme.text }}>
                    My Account
                  </h3>
                  <X className="w-5 h-5 text-gray-400 hover:text-gray-600 transition-colors cursor-pointer" onClick={() => setActiveTab('Dashboard')} />
              </div>

              {/* Menu Items */}
              <div className="flex-1 px-4 py-5 space-y-2">
                {exportError && (
                  <p className="text-xs px-2 pb-2" style={{ color: theme.text, opacity: 0.8 }}>
                    {exportError}
                  </p>
                )}
                {menuItems.map((item, index) => {
                  const IconComponent = item.icon;
                  return (
                    <div
                      key={index}
                      onClick={item.action}
                      className="flex items-center gap-4 p-4 rounded-lg cursor-pointer transition-all duration-200 hover:scale-101"
                      style={{ 
                        backgroundColor: `${theme.surface}`,
                        border: `1px solid ${theme.border}`
                      }}
                    >
                      <IconComponent 
                        className="w-5 h-5" 
                        style={{ color: theme.accent }} 
                      />
                      <div className="flex-1">
                        <h4 className="font-medium" style={{ color: theme.text }}>
                          {item.label}
                        </h4>
                        <p className="text-sm opacity-75" style={{ color: theme.text }}>
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="px-4 py-5 border-t space-y-5" style={{ borderColor: theme.border }}>
                {/* Dark Mode Toggle */}
                <div 
                  className="flex items-center justify-between p-4 rounded-lg"
                  style={{ backgroundColor: `${theme.secondary}10` }}
                >
                  <div className="flex items-center gap-3">
                    {darkMode ? (
                      <Moon className="w-5 h-5" style={{ color: theme.secondary }} />
                    ) : (
                      <Sun className="w-5 h-5" style={{ color: theme.secondary }} />
                    )}
                    <span className="font-medium" style={{ color: theme.text }}>
                      {darkMode ? 'Dark Mode' : 'Light Mode'}
                    </span>
                  </div>
                  <Toggle theme={theme} 
                    enabled={darkMode}
                    onToggle={async () => {
                      saveTheme(!darkMode ? 'dark' : 'light');
                      setDarkMode(!darkMode);
                    }}
                  />
                </div>

                {/* Logout Button */}
                <Button theme={theme} 
                  variant="outline" 
                  onClick={handleLogout}
                  className="w-full justify-center border-red-500 text-red-500 hover:bg-red-50"
                >
                  <LogOut className="w-5 h-5 mr-2" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>
        </>
    </div>
  );
};

export default AccountsPage;
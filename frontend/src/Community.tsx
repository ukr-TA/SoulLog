import React, { useEffect, useState } from 'react';
import { Home, Video, Users } from 'lucide-react';
import ConnectionsPage from './ConnectionPage';
import Sanctuary from './Sanctuary';
import VideoInterface from './VideoPage';
import SearchBarWithDropdown from './CommunitySearch';
import type { Theme } from './theme';
import { navState, pushNav } from './nav';

const ACTIVE_TAB = {
  SANCTUARY: 'Sanctuary',
  SOULS: 'Souls',
  VIDEOS: 'Videos',
}



interface CommunityFeedProps {
  theme: Theme;
  darkMode?: boolean;
  isMobile?: boolean;
  /** Required, not optional: the effect below calls it unconditionally. */
  setHideExtra: (hide: boolean) => void;
  /** Open a profile — used by search results and by the Souls tab. */
  onViewProfile?: (username: string) => void;
  /** Open a Whispers conversation that was just created. */
  onOpenConversation?: (conversationId: number) => void;
  /** Which tab to open on — 'Souls' when arriving from "Find Connections". */
  initialTab?: string;
}

const CommunityFeed: React.FC<CommunityFeedProps> = ({theme, darkMode = true, setHideExtra, isMobile, onViewProfile, onOpenConversation, initialTab }) => {

  // Sanctuary, Souls and Videos are separate pages for Back and Forward.
  const tabFromHistory = () => (navState()?.tab === 'Community' ? navState()?.sub : undefined);
  const [activeTab, setActiveTabState] = useState<string>(tabFromHistory() || initialTab || ACTIVE_TAB.SANCTUARY);
  const setActiveTab = (tab: string) => {
    if (tab !== activeTab) pushNav('Community', tab);
    setActiveTabState(tab);
  };
  useEffect(() => {
    const onPopState = () => {
      if (navState()?.tab !== 'Community') return;
      setActiveTabState(navState()?.sub || initialTab || ACTIVE_TAB.SANCTUARY);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialTab]);

  const tabs = [
    { id: 'home', label: 'Sanctuary', icon: Home },
    { id: 'friends', label: 'Souls', icon: Users },
    { id: 'videos', label: 'Videos', icon: Video },
  ];

  useEffect(() => {
    setHideExtra(true);
    
    return () => setHideExtra(false);
    // Runs once, on mount. `setHideExtra` is a setter owned by the
    // parent and stable in practice; listing it would re-run this
    // effect on every parent render, which is not what it is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  return (
    <div className="text-sm" style={{ 
      background: theme.background,
      color: theme.text,
      zIndex: 0,
    }}>
      <header className='px-2 pt-1' style={{
        background: `${theme.background}95`,
        borderBottom: `1px solid ${theme.surface}`,
        position: 'sticky',
        top: 0,
        backdropFilter: 'blur(20px)',
        zIndex: 9999
      }}>
        <SearchBarWithDropdown
          theme={theme}
          darkMode={darkMode}
          onSelectPerson={(username: string) => onViewProfile?.(username)}
          onSelectResult={(kind: string) => setActiveTab(kind === 'content' ? ACTIVE_TAB.VIDEOS : ACTIVE_TAB.SANCTUARY)}
          onShare={() => setActiveTab(ACTIVE_TAB.SANCTUARY)}
        />
        <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'left',
            width: '100%',
            gap: '0rem',
            fontSize: '0.9rem',
          }}>
            {tabs.map(tab => {
              const isActive = activeTab === tab.label;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.label)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    borderRadius: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    color: isActive ? theme.accent : `${theme.text}70`,
                    border: 'none',
                    cursor: 'pointer',
                    outline: 'none',
                    flex: 1,
                    borderBottom: isActive ? `1px solid ${theme.accent}` : `1px solid ${theme.surface}`,
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = `${theme.accent}`;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.color = `${theme.text}70`;
                    }
                  }}
                >
                  {tab.label}
                  {/* <IconComponent size={20} /> */}
                </button>
              );
            })}
        </div>
      </header>
  
      <div style={{
        margin: '0 auto',
        maxWidth: '800px',

      }}>
      {/* Main Content Area */}

        {
          activeTab === ACTIVE_TAB.SANCTUARY ? <Sanctuary theme={theme} darkMode={darkMode} onViewProfile={onViewProfile} />
          : activeTab === ACTIVE_TAB.SOULS ? (
              <ConnectionsPage
                theme={theme}
                darkMode={darkMode}
                onViewProfile={onViewProfile}
                onOpenConversation={onOpenConversation}
              />
            )
          : activeTab === ACTIVE_TAB.VIDEOS ? <VideoInterface theme={theme} darkMode={darkMode} />
          : <></>
        }
      </div>
    </div>
  );
};

export default CommunityFeed;
/**
 * Notifications.
 *
 * The screen's design is untouched. Its data used to be eight invented
 * notifications in component state — including "you've completed 30 days
 * of consistent journaling", which was shown to every user regardless of
 * whether they had journalled at all.
 *
 * Now every row was produced by something that actually happened: someone
 * commented, someone connected, someone liked a post. The filter tabs'
 * counts come from the server rather than from `.filter().length` over a
 * fake array, and new notifications arrive live over the same WebSocket
 * the bell in the header listens on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { X } from 'lucide-react';
import { ApiError, del, get, openSocket, post } from './api';
import type { Theme } from './theme';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
  isMobile?: boolean;
  setHideExtra: (hidden: boolean) => void;
  setDarkMode?: (dark: boolean) => void;
  setActiveTab: (tab: string) => void;
  /** Open Community → Souls on Requests or Friends ("View" on a friend-request row). */
  onOpenSouls?: (tab: 'requests' | 'friends') => void;
  /** Called once new notifications have been marked as seen. */
  onSeen?: () => void;
}

type Notification = {
  id: number;
  type: string;
  user: string;
  userAvatar: string;
  action: string;
  target: string;
  content: string;
  time: string;
  isRead: boolean;
  category: string;
};

type Counts = Record<string, number>;

const PAGE_SIZE = 30;

/**
 * The hover handlers below style `event.target` — whatever the pointer is
 * actually over — rather than the element the handler sits on, which is
 * what they have always done. `target` is an `EventTarget`, so it is
 * narrowed here: both HTML elements and the SVG icons nested inside these
 * rows carry a `style`, and nothing else in this tree can be the target.
 */
const setTargetBackground = (target: EventTarget, background: string) => {
  if (target instanceof HTMLElement || target instanceof SVGElement) {
    target.style.background = background;
  }
};

const Notifications = ({ theme, isMobile, setActiveTab, setHideExtra, onOpenSouls, onSeen }: MessagePageProps) => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Opening this screen counts as seeing what's new: the numbers here and
  // on the bell/left bar clear. The rows that were new stay highlighted
  // for the rest of this visit, so you can still tell which they were.
  const newThisVisit = useRef<Set<number>>(new Set());
  // Phones fire a "hover" on tap that never ends; only real pointers get the hover shade.
  const canHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches;

  /**
   * New notifications (unread, or read just now by opening this page) stay
   * bright: a gold-tinted row and a dot. Ones you'd already seen sit on a
   * slightly darker row with softer text, so the two are easy to tell apart.
   */
  const isFresh = (row: { id: number; isRead: boolean }) =>
    !row.isRead || newThisVisit.current.has(row.id);
  const rowBackground = (row: { id: number; isRead: boolean }) =>
    isFresh(row) ? theme.accent + '26' : 'rgba(0, 0, 0, 0.28)';

  const load = useCallback(async () => {
    try {
      const data = await get<{ notifications: Notification[]; counts: Counts }>(
        `/notifications/?filter=${activeFilter}&limit=${limit}`,
      );
      const unread = data.notifications.filter((row) => !row.isRead);
      unread.forEach((row) => newThisVisit.current.add(row.id));
      setNotifications(data.notifications);
      setCounts(data.counts);
      setError(null);
      if (unread.length > 0 || (data.counts.unread || 0) > 0) {
        const seen = await post<{ counts: Counts }>('/notifications/read-all/');
        setCounts(seen.counts);
        onSeen?.();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your notifications.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, limit]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Live arrivals. Reloading rather than splicing the payload in keeps
    // the tab counts correct without recomputing them on the client, where
    // they could drift away from what the server thinks.
    const socket = openSocket('/ws/notifications/', {
      onMessage: (event) => {
        if (event.type === 'notification') load();
      },
    });
    return () => socket.close();
  }, [load]);

  // Counts come from the server. The tabs used to compute these from the
  // fake array, which meant they were only ever as true as the array.
  const filters = [
    { key: 'all', label: 'All', count: counts.all || 0 },
    { key: 'unread', label: 'Unread', count: counts.unread || 0 },
    { key: 'engagement', label: 'Engagement', count: counts.engagement || 0 },
    { key: 'social', label: 'Social', count: counts.social || 0 },
    { key: 'insights', label: 'Insights', count: counts.insights || 0 },
  ];

  // The server has already applied the filter; this just returns what it
  // sent, so the two can never disagree about what "unread" means.
  const getFilteredNotifications = () => notifications;

  const getNotificationIcon = (type: string) => {
    const iconStyle: React.CSSProperties = {
      width: '12px', 
      height: '12px', 
      display: 'inline-block',
      textAlign: 'center',
      fontSize: '10px',
      fontWeight: 'bold'
    };
    
    switch(type){
      case 'like':
        return <span style={{ ...iconStyle, color: '#FF6B6B' }}>❤️</span>;
      case 'comment':
        return <span style={{ ...iconStyle, color: '#4ECDC4' }}>💬</span>;
      case 'follow':
        return <span style={{ ...iconStyle, color: '#45B7D1' }}>👤</span>;
      case 'share':
        return <span style={{ ...iconStyle, color: '#96CEB4' }}>📤</span>;
      case 'community':
        return <span style={{ ...iconStyle, color: '#FECA57' }}>👥</span>;
      case 'insight':
        return <span style={{ ...iconStyle, color: '#A8E6CF' }}>📊</span>;
      case 'milestone':
        return <span style={{ ...iconStyle, color: '#FFD93D' }}>🏆</span>;
      default:
        return <span style={{ ...iconStyle, color: theme.text }}>👤</span>;
    }
  };

  const markAsRead = async (id: number) => {
    const target = notifications.find((row) => row.id === id);
    if (!target || target.isRead) return;

    // Optimistic: the row greys out immediately, and a failed request
    // reloads the true state rather than leaving a lie on screen.
    setNotifications((current) =>
      current.map((row) => (row.id === id ? { ...row, isRead: true } : row)),
    );
    setCounts((current) => ({ ...current, unread: Math.max((current.unread || 1) - 1, 0) }));

    try {
      await post(`/notifications/${id}/read/`);
    } catch {
      load();
    }
  };

  const markAllRead = async () => {
    try {
      const data = await post<{ counts: Counts }>('/notifications/read-all/');
      setCounts(data.counts);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not mark those as read.');
    }
  };

  const dismiss = async (id: number, event: ReactMouseEvent<SVGElement>) => {
    event.stopPropagation();
    setNotifications((current) => current.filter((row) => row.id !== id));
    try {
      const data = await del<{ counts: Counts }>(`/notifications/${id}/`);
      setCounts(data.counts);
    } catch {
      load();
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
    <div className='main-content text-left text-sm' style={{
      background: theme.background,
      minHeight: '100dvh',
      fontFamily: "'Poppins', sans-serif"
    }}>
      {/* Header */}  
      <div className='header flex flex-col px-4 py-3 overflow-hidden' style={{
        gap: isMobile ? '0.75rem' : '1rem'
      }}>
        <div className='w-full flex items-center justify-between'>
          <h1 style={{
            fontSize: '1.2rem',
            fontWeight: '700',
            color: theme.text,
            marginBottom: isMobile ? '0.1rem' : '0.25rem'
          }}>
            Notifications
          </h1>
          <div className='flex items-center gap-3'>
            {(counts.unread || 0) > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: theme.accent,
                  fontSize: '0.8rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  fontFamily: "'Poppins', sans-serif",
                }}
              >
                Mark all read
              </button>
            )}
            <X className='text-gray-400 hover:text-gray-600 transition-colors cursor-pointer w-5 h-5' onClick={() => setActiveTab('Dashboard')} />
          </div>
        </div>
        
        {/* Filter Tabs */}
        <div className='w-full mx-2' style={{
          display: 'flex',
          gap: isMobile ? '0.3rem' : '0.4rem',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}>
          {filters.map((filter) => (
            <button
              key={filter.key}
              onClick={() => setActiveFilter(filter.key)}
              style={{
                background: activeFilter === filter.key ? theme.accent + '15' : 'transparent',
                border: activeFilter === filter.key ? `1px solid ${theme.accent}30` : `1px solid ${theme.border}`,
                borderRadius: isMobile ? '1rem' : '1.2rem',
                padding: isMobile ? '0.4rem 0.7rem' : '0.5rem 1rem',
                color: activeFilter === filter.key ? theme.accent : theme.text,
                fontSize: isMobile ? '0.75rem' : '0.85rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                fontFamily: "'Poppins', sans-serif",
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: isMobile ? '0.3rem' : '0.4rem'
              }}
              onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => {
                if (activeFilter !== filter.key) {
                  setTargetBackground(e.target, theme.border + '30');
                }
              }}
              onMouseLeave={(e: ReactMouseEvent<HTMLElement>) => {
                if (activeFilter !== filter.key) {
                  setTargetBackground(e.target, 'transparent');
                }
              }}
            >
              {filter.label}
              {filter.count > 0 && (
                <span style={{
                  background: activeFilter === filter.key ? theme.accent : theme.text + '20',
                  color: activeFilter === filter.key ? theme.background : theme.text,
                  borderRadius: '0.8rem',
                  padding: isMobile ? '0.1rem 0.35rem' : '0.15rem 0.4rem',
                  fontSize: isMobile ? '0.6rem' : '0.65rem',
                  fontWeight: '600',
                  minWidth: isMobile ? '0.8rem' : '1rem',
                  textAlign: 'center'
                }}>
                  {filter.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>


      {/* Notifications List */}
      <div className='mx-2' style={{
        background: theme.surface,
        borderRadius: '1rem',
        border: `1px solid ${theme.border}`,
        overflow: 'hidden'
      }}>
        {getFilteredNotifications().length === 0 ? (
          <div style={{
            padding: '3rem',
            textAlign: 'center',
            color: theme.text + '60'
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '1rem'
            }}>
              🔔
            </div>
            <h3 style={{
              fontSize: '1.2rem',
              fontWeight: '600',
              margin: '0 0 0.5rem 0',
              color: theme.text
            }}>
              No notifications found
            </h3>
            <p style={{
              fontSize: '0.9rem',
              margin: 0
            }}>
              {loading
                ? 'Loading…'
                : error
                  ? error
                  : activeFilter === 'unread'
                    ? "You're all caught up!"
                    : `No ${activeFilter} notifications yet.`}
            </p>
          </div>
        ) : (
          getFilteredNotifications().map((notification, index) => (
            <div
              key={notification.id}
              onClick={() => markAsRead(notification.id)}
              style={{
                padding: isMobile ? '1rem' : '1.2rem',
                borderBottom: index < getFilteredNotifications().length - 1 ? `1px solid ${theme.border}` : 'none',
                cursor: 'pointer',
                transition: 'all 0.3s ease',
                background: rowBackground(notification),
                // A gold edge on new ones — clear even on a small, bright phone screen.
                boxShadow: isFresh(notification) ? `inset 3px 0 0 ${theme.accent}` : 'none',
                position: 'relative'
              }}
              onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => {
                if (!canHover) return;
                setTargetBackground(e.currentTarget, theme.border + '20');
              }}
              onMouseLeave={(e: ReactMouseEvent<HTMLElement>) => {
                if (!canHover) return;
                setTargetBackground(e.currentTarget, rowBackground(notification));
              }}
            >
              {/* Unread indicator */}
              {(!notification.isRead || newThisVisit.current.has(notification.id)) && (
                <div style={{
                  position: 'absolute',
                  left: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '6px',
                  height: '6px',
                  background: theme.accent,
                  borderRadius: '50%'
                }} />
              )}

              <div style={{
                display: 'flex',
                gap: isMobile ? '0.75rem' : '1rem',
                alignItems: 'flex-start',
                // Read ones step back a little — still easy to read.
                opacity: isFresh(notification) ? 1 : 0.65,
                transition: 'opacity 0.3s ease'
              }}>
                {/* User Avatar */}
                <div style={{
                  position: 'relative',
                  flexShrink: 0
                }}>
                  <div style={{
                    width: isMobile ? '2.5rem' : '3rem',
                    height: isMobile ? '2.5rem' : '3rem',
                    borderRadius: '50%',
                    background: notification.userAvatar.match(/[A-Z]/) ? theme.accent : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: notification.userAvatar.match(/[A-Z]/) ? theme.background : 'inherit',
                    fontWeight: '600',
                    fontSize: notification.userAvatar.match(/[A-Z]/) ? (isMobile ? '1rem' : '1.2rem') : (isMobile ? '1.2rem' : '1.5rem')
                  }}>
                    {notification.userAvatar}
                  </div>
                  
                  {/* Notification type icon */}
                  <div style={{
                    position: 'absolute',
                    bottom: '-2px',
                    right: '-2px',
                    width: isMobile ? '1rem' : '1.2rem',
                    height: isMobile ? '1rem' : '1.2rem',
                    background: theme.surface,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `2px solid ${theme.surface}`,
                    fontSize: isMobile ? '0.6rem' : '0.7rem'
                  }}>
                    {getNotificationIcon(notification.type)}
                  </div>
                </div>

                {/* Content */}
                <div style={{
                  flex: 1,
                  minWidth: 0
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '1rem',
                    marginBottom: '0.3rem'
                  }}>
                    <div style={{
                      fontSize: '0.95rem',
                      lineHeight: 1.4,
                      color: theme.text
                    }}>
                      <span style={{ fontWeight: '600' }}>{notification.user}</span>
                      {' '}
                      <span style={{ fontWeight: '400' }}>{notification.action}</span>
                      {notification.target && (
                        <>
                          {' '}
                          <span style={{ 
                            fontWeight: '600',
                            color: theme.accent 
                          }}>
                            {notification.target}
                          </span>
                        </>
                      )}
                    </div>
                    
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      color: theme.text + '60',
                      fontSize: '0.8rem',
                      flexShrink: 0
                    }}>
                      <span style={{ fontSize: '10px' }}>🕐</span>
                      {notification.time}
                      <X
                        className='w-3.5 h-3.5 cursor-pointer'
                        onClick={(event) => dismiss(notification.id, event)}
                      />
                    </div>
                  </div>

                  {/* Comment content if applicable */}
                  {notification.content && (
                    <div style={{
                      background: theme.background,
                      border: `1px solid ${theme.border}`,
                      borderRadius: '0.8rem',
                      padding: '0.8rem',
                      fontSize: '0.9rem',
                      color: theme.text + '90',
                      fontStyle: 'italic',
                      marginTop: '0.5rem'
                    }}>
                      {notification.content}
                    </div>
                  )}

                  {/* Friend requests: a way straight to where you answer them. */}
                  {(notification.type === 'connection_request' || notification.type === 'connection_accepted') && onOpenSouls && (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        markAsRead(notification.id);
                        onOpenSouls(notification.type === 'connection_request' ? 'requests' : 'friends');
                      }}
                      style={{
                        marginTop: '0.6rem',
                        padding: '0.4rem 1.1rem',
                        borderRadius: '0.6rem',
                        border: `1px solid ${theme.accent}`,
                        background: notification.type === 'connection_request' ? theme.accent : 'transparent',
                        color: notification.type === 'connection_request' ? theme.background : theme.accent,
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {notification.type === 'connection_request' ? 'View request' : 'View friends'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Load more — only offered when there is genuinely more to load,
          rather than a button that always appears and does nothing. */}
      {getFilteredNotifications().length >= limit && (
        <div style={{
          textAlign: 'center',
          marginBlock: '2rem'
        }}>
          <button style={{
            background: 'transparent',
            border: `1px solid ${theme.border}`,
            borderRadius: '0.8rem',
            padding: '0.8rem 2rem',
            color: theme.text,
            fontSize: '0.9rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.3s ease',
            fontFamily: "'Poppins', sans-serif"
          }}
          onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => {
            setTargetBackground(e.currentTarget, theme.border + '20');
          }}
          onMouseLeave={(e: ReactMouseEvent<HTMLElement>) => {
            setTargetBackground(e.target, 'transparent');
          }}
          onClick={() => setLimit((current) => current + PAGE_SIZE)}>
            Load more notifications
          </button>
        </div>
      )}
    </div>
  );
};

export default Notifications;
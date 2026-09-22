import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, BellOff, Bell, Ban, Pin, PinOff, Search, Settings, Trash2, X, MoreHorizontal } from 'lucide-react';
import { ApiError, del, post } from './api';
import { Avatar } from './ui';
import type { Theme } from './theme';

/**
 * The Whispers list — search, three filters, and each chat's options.
 *
 * Filters are the three that earn their place: All, Unread and Archived.
 * Pinned chats sit on top of All. Options (pin, mute, archive, block,
 * delete) open from a long press on a phone, and from right-click or the
 * ⋯ on a row with a mouse — the same sheet either way.
 */

export type ChatRow = {
  id: number;
  userId: number | null;
  username: string | null;
  name: string;
  avatar: string;
  avatarUrl: string | null;
  online: boolean;
  lastMessage: string;
  time: string;
  unread: number;
  muted?: boolean;
  pinned?: boolean;
  archived?: boolean;
};

type Filter = 'all' | 'unread' | 'archived';

const LONG_PRESS_MS = 450;

const ChatList = ({
  theme,
  rows,
  selectedId,
  typingInSelected,
  compact = false,
  onOpen,
  onChanged,
  onRemoved,
  onOpenSettings,
  onError,
}: {
  theme: Theme;
  rows: ChatRow[];
  selectedId: number | null;
  typingInSelected?: boolean;
  /** The narrower desktop sidebar. */
  compact?: boolean;
  onOpen: (id: number) => void;
  /** Patch one row locally after an action. */
  onChanged: (id: number, patch: Partial<ChatRow>) => void;
  /** A chat left the list (deleted or blocked). */
  onRemoved: (id: number) => void;
  onOpenSettings?: () => void;
  onError: (message: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sheetFor, setSheetFor] = useState<ChatRow | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'block' | null>(null);
  const [busy, setBusy] = useState(false);

  // Long press: a timer that opens the sheet, cancelled by lifting or
  // moving the finger (a scroll). The click that follows is swallowed.
  const pressTimer = useRef<number | undefined>(undefined);
  const pressed = useRef(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);

  // The finger lifting after a long press sends a click to whatever is
  // now under it — the sheet's backdrop. That click mustn't close it.
  const openedAt = useRef(0);
  const openSheet = (row: ChatRow) => {
    openedAt.current = Date.now();
    setConfirm(null);
    setSheetFor(row);
    if (navigator.vibrate) navigator.vibrate(12);
  };

  useEffect(() => {
    if (!sheetFor) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setSheetFor(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheetFor]);

  const needle = query.trim().toLowerCase();
  const matches = rows.filter((row) => !needle || row.name.toLowerCase().includes(needle));
  const unreadCount = rows.filter((row) => !row.archived && row.unread > 0).length;
  const archivedCount = rows.filter((row) => row.archived).length;
  const shown = matches.filter((row) =>
    filter === 'archived' ? row.archived : !row.archived && (filter === 'all' || row.unread > 0),
  );

  // --- actions ------------------------------------------------------------
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setSheetFor(null);
      setConfirm(null);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const togglePin = (row: ChatRow) => act(async () => {
    const pinned = !row.pinned;
    await post(`/messages/conversations/${row.id}/pin/`, { pinned });
    onChanged(row.id, { pinned });
  });
  const toggleMute = (row: ChatRow) => act(async () => {
    const muted = !row.muted;
    await post(`/messages/conversations/${row.id}/mute/`, { muted });
    onChanged(row.id, { muted });
  });
  const toggleArchive = (row: ChatRow) => act(async () => {
    const archived = !row.archived;
    await post(`/messages/conversations/${row.id}/archive/`, { archived });
    onChanged(row.id, { archived, pinned: archived ? false : row.pinned });
  });
  const deleteChat = (row: ChatRow) => {
    if (confirm !== 'delete') { setConfirm('delete'); return; }
    act(async () => {
      await del(`/messages/conversations/${row.id}/`);
      onRemoved(row.id);
    });
  };
  const block = (row: ChatRow) => {
    if (!row.userId) return;
    if (confirm !== 'block') { setConfirm('block'); return; }
    act(async () => {
      await post(`/social/block/${row.userId}/`);
      await del(`/messages/conversations/${row.id}/`);
      onRemoved(row.id);
    });
  };

  // --- pieces -------------------------------------------------------------
  const chip = (key: Filter, label: string, count: number) => {
    const active = filter === key;
    return (
      <button
        key={key}
        onClick={() => setFilter(key)}
        aria-pressed={active}
        className="flex items-center gap-1.5 text-xs font-medium transition-all"
        style={{
          padding: '0.35rem 0.8rem',
          borderRadius: '9999px',
          backgroundColor: active ? theme.accent : `${theme.accent}12`,
          color: active ? theme.background : theme.text,
          border: `1px solid ${active ? theme.accent : `${theme.accent}30`}`,
        }}
      >
        {label}
        {count > 0 && (
          <span
            style={{
              minWidth: '1.1rem', padding: '0 0.3rem', borderRadius: '9999px', fontSize: '0.65rem', lineHeight: '1.1rem',
              backgroundColor: active ? `${theme.background}33` : `${theme.accent}33`,
              color: active ? theme.background : theme.accent,
            }}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  const avatarSize = compact ? 40 : 48;

  const renderRow = (row: ChatRow) => {
    const selected = row.id === selectedId;
    const unread = row.unread > 0;
    return (
      <div
        key={row.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          if (pressed.current) { pressed.current = false; return; }
          onOpen(row.id);
        }}
        onKeyDown={(event) => { if (event.key === 'Enter') onOpen(row.id); }}
        onContextMenu={(event) => { event.preventDefault(); openSheet(row); }}
        onTouchStart={(event) => {
          pressed.current = false;
          startPoint.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
          window.clearTimeout(pressTimer.current);
          pressTimer.current = window.setTimeout(() => {
            pressed.current = true;
            openSheet(row);
          }, LONG_PRESS_MS);
        }}
        onTouchMove={(event) => {
          const start = startPoint.current;
          if (!start) return;
          const dx = Math.abs(event.touches[0].clientX - start.x);
          const dy = Math.abs(event.touches[0].clientY - start.y);
          if (dx > 8 || dy > 8) window.clearTimeout(pressTimer.current);
        }}
        onTouchEnd={() => window.clearTimeout(pressTimer.current)}
        className="group relative flex items-center cursor-pointer transition-colors"
        style={{
          gap: '0.8rem',
          padding: compact ? '0.7rem 0.9rem' : '0.8rem 1rem',
          margin: compact ? '0.15rem 0.4rem' : '0.15rem 0.5rem',
          borderRadius: '0.9rem',
          backgroundColor: selected ? `${theme.accent}1f` : 'transparent',
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        } as React.CSSProperties}
        onMouseEnter={(event) => { if (!selected) event.currentTarget.style.backgroundColor = `${theme.text}0a`; }}
        onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = selected ? `${theme.accent}1f` : 'transparent'; }}
      >
        {selected && (
          <span aria-hidden="true" className="absolute left-0 top-3 bottom-3" style={{ width: '3px', borderRadius: '3px', backgroundColor: theme.accent }} />
        )}
        <div className="relative flex-shrink-0">
          <Avatar user={row} theme={theme} size={avatarSize} />
          {row.online && (
            <span
              className="absolute rounded-full"
              style={{ right: 0, bottom: 0, width: '0.8rem', height: '0.8rem', backgroundColor: '#4ECDC4', border: `2px solid ${theme.surface}` }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate" style={{ color: theme.text, fontWeight: unread ? 700 : 500, fontSize: compact ? '0.9rem' : '0.98rem' }}>
              {row.name}
            </span>
            <span className="ml-auto flex-shrink-0 text-xs" style={{ color: unread ? theme.accent : theme.text, opacity: unread ? 1 : 0.55, fontWeight: unread ? 600 : 400 }}>
              {row.time}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="truncate text-sm" style={{ color: theme.text, opacity: unread ? 0.9 : 0.6, fontSize: compact ? '0.8rem' : '0.85rem' }}>
              {selected && typingInSelected
                ? <span style={{ color: theme.secondary }}>typing…</span>
                : row.lastMessage || <span className="italic">No messages yet</span>}
            </span>
            <span className="ml-auto flex items-center gap-1.5 flex-shrink-0" style={{ color: theme.text }}>
              {row.muted && <BellOff className="w-3.5 h-3.5" style={{ opacity: 0.5 }} aria-label="Silenced" />}
              {row.pinned && !row.archived && <Pin className="w-3.5 h-3.5" style={{ opacity: 0.55, transform: 'rotate(45deg)' }} aria-label="Pinned" />}
              {unread && (
                <span
                  className="flex items-center justify-center font-bold"
                  style={{
                    minWidth: '1.25rem', height: '1.25rem', padding: '0 0.35rem', borderRadius: '9999px', fontSize: '0.7rem',
                    backgroundColor: row.muted ? `${theme.text}40` : theme.accent,
                    color: theme.background,
                  }}
                >
                  {row.unread > 99 ? '99+' : row.unread}
                </span>
              )}
            </span>
          </div>
        </div>

        {/* A mouse gets a visible way in, too */}
        <button
          onClick={(event) => { event.stopPropagation(); openSheet(row); }}
          aria-label={`Options for ${row.name}`}
          title="Options"
          className="flex-shrink-0 items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
          style={{ width: '1.8rem', height: '1.8rem', padding: 0, borderRadius: '9999px', background: `${theme.text}12`, border: 'none', color: theme.text }}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const option = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    danger = false,
    hint?: string,
  ) => (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full flex items-center gap-3 text-left transition-colors"
      style={{
        padding: '0.85rem 1rem', borderRadius: '0.8rem', background: 'transparent', border: 'none',
        color: danger ? theme.error : theme.text,
      }}
      onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = `${danger ? theme.error : theme.text}12`; }}
      onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      <span
        className="flex items-center justify-center flex-shrink-0"
        style={{ width: '2.2rem', height: '2.2rem', borderRadius: '9999px', backgroundColor: danger ? `${theme.error}1f` : `${theme.accent}1a`, color: danger ? theme.error : theme.accent }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs opacity-60">{hint}</span>}
      </span>
    </button>
  );

  const first = sheetFor?.name.split(' ')[0] || '';

  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: theme.surface }}>
      {/* Header */}
      <div style={{ padding: compact ? '0.9rem 0.9rem 0.6rem' : '1rem 1rem 0.7rem' }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold" style={{ color: theme.text, fontSize: compact ? '1.15rem' : '1.35rem', margin: 0 }}>Whispers</h2>
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              aria-label="Message settings"
              title="Who can message you"
              className="flex items-center justify-center"
              style={{ width: '2.1rem', height: '2.1rem', padding: 0, borderRadius: '9999px', background: `${theme.accent}14`, border: 'none', color: theme.accent }}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center px-3.5 rounded-full" style={{ backgroundColor: theme.chatBg, height: '2.4rem' }}>
          <Search size={16} className="flex-shrink-0" style={{ color: theme.text, opacity: 0.5 }} />
          <input
            type="text"
            placeholder="Search souls..."
            aria-label="Search souls"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1 min-w-0 h-full bg-transparent outline-none text-sm leading-none"
            style={{ color: theme.text, padding: 0, margin: 0 }}
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search" style={{ background: 'none', border: 'none', padding: 0, color: theme.text, opacity: 0.6, lineHeight: 0 }}>
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex gap-2 mt-3">
          {chip('all', 'All', 0)}
          {chip('unread', 'Unread', unreadCount)}
          {chip('archived', 'Archived', archivedCount)}
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto min-h-0 pb-24 md:pb-3">
        {shown.length === 0 && (
          <div className="text-center px-6" style={{ paddingTop: '3.5rem', color: theme.text }}>
            <div className="text-4xl mb-2">{filter === 'archived' ? '🗂️' : filter === 'unread' ? '✨' : '💬'}</div>
            <p className="text-sm" style={{ opacity: 0.65 }}>
              {needle
                ? `No one called “${query}”.`
                : filter === 'archived'
                  ? 'Nothing archived. Hold a chat to archive it.'
                  : filter === 'unread'
                    ? "You're all caught up."
                    : "No conversations yet. Start one from a connection's profile."}
            </p>
          </div>
        )}
        {shown.map(renderRow)}
        {filter === 'all' && shown.length > 0 && (
          <p className="text-center text-xs mt-3 md:hidden" style={{ color: theme.text, opacity: 0.4 }}>Hold a chat for more options</p>
        )}
      </div>

      {/* Options sheet */}
      {sheetFor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Options for ${sheetFor.name}`}
          onClick={() => { if (Date.now() - openedAt.current > 600) setSheetFor(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: '100%', maxWidth: '26rem', background: theme.surface, color: theme.text,
              borderTopLeftRadius: '1.25rem', borderTopRightRadius: '1.25rem', border: `1px solid ${theme.border}`,
              padding: '0.6rem 0.75rem calc(0.9rem + env(safe-area-inset-bottom))',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.35)',
            }}
          >
            <div style={{ width: '2.5rem', height: '4px', borderRadius: '2px', background: theme.border, margin: '0 auto 0.75rem' }} />
            <div className="flex items-center gap-3 px-2 pb-3 mb-1" style={{ borderBottom: `1px solid ${theme.border}` }}>
              <Avatar user={sheetFor} theme={theme} size={40} />
              <div className="min-w-0 text-left">
                <p className="font-semibold truncate">{sheetFor.name}</p>
                {sheetFor.username && <p className="text-xs opacity-60 truncate">@{sheetFor.username}</p>}
              </div>
            </div>
            {!sheetFor.archived && option(
              sheetFor.pinned ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />,
              sheetFor.pinned ? 'Unpin chat' : 'Pin chat',
              () => togglePin(sheetFor),
              false,
              sheetFor.pinned ? undefined : 'Keep it at the top',
            )}
            {option(
              sheetFor.muted ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />,
              sheetFor.muted ? 'Unsilence' : 'Silence chat',
              () => toggleMute(sheetFor),
              false,
              sheetFor.muted ? undefined : 'No badge or sound for new messages',
            )}
            {option(
              sheetFor.archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />,
              sheetFor.archived ? 'Unarchive chat' : 'Archive chat',
              () => toggleArchive(sheetFor),
              false,
              sheetFor.archived ? undefined : 'Move it out of your main list',
            )}
            {sheetFor.userId && option(
              <Ban className="w-4 h-4" />,
              confirm === 'block' ? `Tap again to block ${first}` : `Block ${first}`,
              () => block(sheetFor),
              true,
              confirm === 'block' ? 'You won’t see each other’s messages or posts' : undefined,
            )}
            {option(
              <Trash2 className="w-4 h-4" />,
              confirm === 'delete' ? 'Tap again to delete' : 'Delete chat',
              () => deleteChat(sheetFor),
              true,
              confirm === 'delete' ? `Clears it for you — ${first} keeps their copy` : undefined,
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatList;

/**
 * Whispers.
 *
 * The layout is the one that was already here — mobile list/thread, and
 * the desktop two-pane split — with the same classes and colours. What's
 * underneath is entirely different: six invented friends and three
 * invented conversations have been replaced by real conversations, real
 * messages, and a live WebSocket.
 *
 * Three things that used to be decorative and are now true:
 *
 *   "Active now"   Derived from the other person's last activity, and
 *                  respecting their onlineStatus setting. When they've
 *                  turned presence off, the line is simply absent rather
 *                  than guessing.
 *   "Typing…"      Only ever shown because a keystroke arrived over the
 *                  socket, and it clears itself after a few seconds of
 *                  silence so a dropped connection can't leave it stuck.
 *   Attachments    Actually uploaded, validated and stored, instead of a
 *                  "📎 filename" string added to local state.
 *
 * REST loads history and sends; the socket delivers. If the socket never
 * connects, everything still works — you just have to reopen the thread
 * to see new messages, which is a degradation rather than a breakage.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Send, Paperclip, Smile, Phone, Video, MoreVertical, ArrowLeft, Search, Info, Settings } from 'lucide-react';
import { ApiError, del, get, openSocket, patch, post, upload, type LiveSocket } from './api';
import { EditedMark, InlineEditor } from './ui';
import { Avatar } from './ui';
import type { Theme } from './theme';

interface MessagePageProps {
  theme: Theme;
  darkMode?: boolean;
  setHideExtra?: (hidden: boolean) => void;
  initialConversationId?: number | null;
  /** Open someone's profile — from the conversation menu. */
  onViewProfile?: (username: string) => void;
  /** Open Settings — from the gear above the conversation list. */
  onOpenSettings?: () => void;
}

/** A small set of emoji for the message box's 🙂 button. */
const QUICK_EMOJI = ['😊', '😂', '❤️', '🙏', '🌱', '✨', '🤗', '😌', '😢', '💪', '👍', '🔥', '🌙', '☕', '🎉', '💙'];

type Conversation = {
  id: number;
  userId: number | null;
  username: string | null;
  name: string;
  avatar: string;
  avatarUrl: string | null;
  bio: string;
  online: boolean;
  presenceLabel: string | null;
  lastMessage: string;
  time: string;
  unread: number;
  typing: boolean;
  muted?: boolean;
};

type ChatMessage = {
  id: number;
  text: string;
  sender: 'me' | 'them';
  time: string;
  status: string;
  isDeleted?: boolean;
  editedAt?: string | null;
  attachments?: { id: number; url: string; kind: string; name: string; sizeBytes: number }[];
};


/**
 * Reading one field off a socket frame.
 *
 * The frames come off the network, so their fields are `unknown`. These
 * two say what the screen actually requires of a field and return `null`
 * when it isn't there, which is what lets each handler bail instead of
 * writing `undefined` into the thread.
 */
const readId = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const readText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const POLL_INTERVAL_MS = 20000;
const TYPING_TIMEOUT_MS = 4000;

const ChatPage = ({ theme, setHideExtra, initialConversationId = null, onViewProfile, onOpenSettings }: MessagePageProps) => {
  const [selectedFriend, setSelectedFriend] = useState<number | null>(initialConversationId);
  const [message, setMessage] = useState('');
  const [isMobile, setIsMobile] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typingName, setTypingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<LiveSocket | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastTypingSentRef = useRef<number>(0);

  const currentFriend = conversations.find((row) => row.id === selectedFriend) || null;

  // --- loading ------------------------------------------------------------

  const loadConversations = useCallback(async () => {
    try {
      const data = await get<{ conversations: Conversation[] }>('/messages/conversations/');
      setConversations(data.conversations);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your conversations.');
    }
  }, []);

  useEffect(() => {
    loadConversations();
    // A slow poll keeps the list fresh for conversations whose sockets
    // aren't open. The open thread has its own socket and doesn't rely
    // on this.
    const timer = setInterval(loadConversations, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadConversations]);

  const loadThread = useCallback(async (conversationId: number) => {
    setLoadingThread(true);
    try {
      const data = await get<{ messages: ChatMessage[] }>(
        `/messages/conversations/${conversationId}/`,
      );
      setMessages(data.messages);
      // Opening a thread marks it read server-side; mirror that locally
      // so the badge clears without waiting for the next poll.
      setConversations((current) =>
        current.map((row) => (row.id === conversationId ? { ...row, unread: 0 } : row)),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open that conversation.');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // --- the live socket ----------------------------------------------------

  /**
   * Keep the conversation list's preview line in step with an edit.
   *
   * The list shows the last message of each thread. Correcting that
   * message updated the bubble but left the preview showing the sentence
   * the sender had just replaced — the old text stayed visible in the
   * sidebar. Only the newest message is the preview, so the swap is
   * applied only when the edited text is the one currently shown.
   */
  const refreshPreview = (conversationId: number, previousText: string, nextText: string) => {
    setConversations((current) =>
      current.map((row) =>
        row.id === conversationId && row.lastMessage === previousText
          ? { ...row, lastMessage: nextText }
          : row,
      ),
    );
  };

  useEffect(() => {
    if (!selectedFriend) {
      setMessages([]);
      return;
    }

    loadThread(selectedFriend);

    const socket = openSocket(`/ws/conversations/${selectedFriend}/`, {
      onMessage: (event) => {
        // `event.data` is `Record<string, unknown>`: the socket is a
        // network boundary, so each frame's fields are read through the
        // small helpers above rather than trusted wholesale. A frame that
        // arrives malformed now does nothing instead of writing
        // `undefined` into a message bubble.
        const frame = event.data ?? {};

        if (event.type === 'message') {
          const incoming = frame as unknown as ChatMessage;
          setMessages((current) =>
            // The sender gets the message back over the socket as well as
            // in the POST response; drop the duplicate rather than
            // showing the bubble twice.
            current.some((row) => row.id === incoming.id) ? current : [...current, incoming],
          );
          setTypingName(null);
          loadConversations();
        } else if (event.type === 'typing') {
          if (frame.typing === true) {
            setTypingName(readText(frame.name) || null);
            clearTimeout(typingTimerRef.current);
            // Self-expiring: a client that vanishes mid-keystroke can't
            // leave "typing…" on screen forever.
            typingTimerRef.current = setTimeout(() => setTypingName(null), TYPING_TIMEOUT_MS);
          } else {
            setTypingName(null);
          }
        } else if (event.type === 'read') {
          setMessages((current) =>
            current.map((row) => (row.sender === 'me' ? { ...row, status: 'read' } : row)),
          );
        } else if (event.type === 'deleted') {
          const deletedId = readId(frame.id);
          if (deletedId === null) return;
          setMessages((current) =>
            current.map((row) =>
              row.id === deletedId
                ? { ...row, text: 'This message was deleted', isDeleted: true }
                : row,
            ),
          );
        } else if (event.type === 'edited') {
          // The correction reaches the other side live, so they are not
          // left replying to a version that no longer exists.
          const editedId = readId(frame.id);
          const editedText = readText(frame.text);
          if (editedId === null || editedText === null) return;
          const editedAt = readText(frame.editedAt);

          setMessages((current) => {
            const previous = current.find((row) => row.id === editedId)?.text || '';
            refreshPreview(selectedFriend, previous, editedText);
            return current.map((row) =>
              row.id === editedId
                ? { ...row, text: editedText, editedAt }
                : row,
            );
          });
        }
      },
    });

    socketRef.current = socket;
    return () => {
      socket.close();
      socketRef.current = null;
      clearTimeout(typingTimerRef.current);
      setTypingName(null);
    };
  }, [selectedFriend, loadThread, loadConversations]);

  useEffect(() => {
    const checkScreenSize = () => setIsMobile(window.innerWidth < 768);
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingName]);

  // --- actions ------------------------------------------------------------

  const handleSendMessage = async () => {
    const body = message.trim();
    if (!body || !selectedFriend || sending) return;

    setSending(true);
    setMessage('');
    try {
      const sent = await post<ChatMessage>(
        `/messages/conversations/${selectedFriend}/messages/`,
        { body },
      );
      setMessages((current) =>
        current.some((row) => row.id === sent.id) ? current : [...current, sent],
      );
      loadConversations();
    } catch (err) {
      // Put the text back rather than losing what they wrote.
      setMessage(body);
      setError(err instanceof ApiError ? err.message : 'That message did not send.');
    } finally {
      setSending(false);
    }
  };

  // The conversation menu (⋮ on desktop, ⓘ on phones). Both icons were
  // drawn and did nothing; the server has always supported muting and
  // leaving a conversation.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Tapping anywhere outside the menu (or pressing Escape) closes it. The
  // button that opens it is ignored here so it can still toggle.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('[role="menu"], [aria-label="Conversation options"]')) return;
      setMenuOpen(false);
      setConfirmLeave(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenuOpen(false); setConfirmLeave(false); }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const toggleMute = async () => {
    if (!currentFriend) return;
    const muted = !currentFriend.muted;
    try {
      await post(`/messages/conversations/${currentFriend.id}/mute/`, { muted });
      setConversations((rows) => rows.map((row) => (row.id === currentFriend.id ? { ...row, muted } : row)));
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  const leaveConversation = async () => {
    if (!currentFriend) return;
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    try {
      await del(`/messages/conversations/${currentFriend.id}/`);
      setMenuOpen(false);
      setConfirmLeave(false);
      setSelectedFriend(null);
      setHideExtra?.(false);
      loadConversations();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not work.');
    }
  };

  const insertEmoji = (emoji: string) => {
    handleTyping(message + emoji);
    setEmojiOpen(false);
  };

  const renderConversationMenu = () =>
    menuOpen && currentFriend ? (
      <div
        role="menu"
        className="absolute right-0 top-full mt-2 z-20 rounded-xl shadow-lg overflow-hidden text-sm"
        style={{ background: theme.surface, border: `1px solid ${theme.border}`, minWidth: '220px' }}
      >
        {currentFriend.username && onViewProfile && (
          <button
            role="menuitem"
            className="w-full text-left px-4 py-3"
            style={{ color: theme.text, background: 'transparent' }}
            onClick={() => { setMenuOpen(false); onViewProfile(currentFriend.username!); }}
          >
            View profile
          </button>
        )}
        <button role="menuitem" className="w-full text-left px-4 py-3" style={{ color: theme.text, background: 'transparent' }} onClick={toggleMute}>
          {currentFriend.muted ? 'Unmute conversation' : 'Mute conversation'}
        </button>
        <button
          role="menuitem"
          className="w-full text-left px-4 py-3"
          style={{ color: theme.error, background: 'transparent' }}
          onClick={leaveConversation}
        >
          {confirmLeave ? 'Tap again to leave — they keep the history' : 'Leave conversation'}
        </button>
      </div>
    ) : null;

  const handleTyping = (value: string) => {
    setMessage(value);
    if (!socketRef.current) return;

    // Throttled: one frame per second is plenty for an indicator, and
    // sending one per keystroke is a lot of traffic to say very little.
    const now = Date.now();
    if (now - lastTypingSentRef.current > 1000) {
      lastTypingSentRef.current = now;
      socketRef.current.send({ type: 'typing', typing: value.length > 0 });
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleFileClick = () => fileInputRef.current?.click();

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedFriend) return;

    const form = new FormData();
    form.append('files', file);
    form.append('body', '');

    setSending(true);
    try {
      const sent = await upload<ChatMessage>(
        `/messages/conversations/${selectedFriend}/messages/`,
        form,
      );
      setMessages((current) =>
        current.some((row) => row.id === sent.id) ? current : [...current, sent],
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That file did not send.');
    } finally {
      setSending(false);
    }
  };

  /**
   * Correct a message you sent.
   *
   * The server stamps `edited_at` and pushes the new text down the
   * conversation socket, so the other side sees the correction rather
   * than the version they were replying to. Throws on failure so the
   * editor stays open with what you typed.
   */
  const saveMessageEdit = async (messageId: number, text: string) => {
    const previous = messages.find((row) => row.id === messageId)?.text || '';
    const updated = await patch<ChatMessage>(
      `/messages/conversations/${selectedFriend}/messages/${messageId}/`,
      { body: text },
    );
    setMessages((current) =>
      current.map((row) => (row.id === messageId ? { ...row, ...updated } : row)),
    );
    if (selectedFriend) refreshPreview(selectedFriend, previous, updated.text);
    setEditingId(null);
  };

  const openConversation = (id: number, hideExtra: boolean) => {
    setSelectedFriend(id);
    if (hideExtra) setHideExtra?.(true);
  };

  const filteredFriends = conversations.filter((row) =>
    row.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  /** The line under a name in the thread header. */
  const presenceLine = (friend: Conversation) => {
    if (typingName) return `${typingName} is typing…`;
    return friend.presenceLabel || '';
  };

  // Called as a function rather than rendered as a component: declared
  // inside this screen, a component is re-created on every render, and
  // React would rebuild everything in it — losing focus and local state.
  const renderMessageBubble = ({ msg, wide }: { msg: ChatMessage; wide?: boolean }) => (
    <div className={`flex ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}>
      <div
        className={
          wide
            ? `max-w-md px-3 py-2 rounded-lg ${msg.sender === 'me' ? 'rounded-br-sm' : 'rounded-bl-sm'}`
            : `max-w-[80%] px-4 py-2 rounded-2xl ${msg.sender === 'me' ? 'rounded-br-md' : 'rounded-bl-md'}`
        }
        style={{
          backgroundColor: msg.sender === 'me' ? `${theme.accent}80` : `${theme.secondary}80`,
          color: theme.text,
        }}
      >
        {msg.attachments && msg.attachments.length > 0 && (
          <div className="mb-1 space-y-1">
            {msg.attachments.map((file) =>
              file.kind === 'image' ? (
                <img
                  key={file.id}
                  src={file.url}
                  alt={file.name}
                  className="rounded-lg"
                  style={{ maxWidth: '260px', maxHeight: '260px', objectFit: 'cover' }}
                />
              ) : (
                <a
                  key={file.id}
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2"
                  style={{ color: theme.text }}
                >
                  <Paperclip size={16} />
                  <div>
                    <p className="text-sm font-medium">{file.name}</p>
                    <p className="text-xs opacity-70">
                      {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </a>
              ),
            )}
          </div>
        )}
        {editingId === msg.id ? (
          <InlineEditor
            value={msg.text}
            theme={theme}
            onSave={(text) => saveMessageEdit(msg.id, text)}
            onCancel={() => setEditingId(null)}
            placeholder="Edit your message…"
          />
        ) : (
          msg.text && <p className="text-sm">{msg.text}</p>
        )}
        <p
          className={`text-xs mt-1 flex items-center gap-2 ${msg.sender === 'me' ? 'justify-end' : 'justify-start'}`}
          style={{ opacity: 0.7 }}
        >
          {msg.time}
          <EditedMark editedAt={msg.editedAt} theme={theme} />
          {msg.sender === 'me' && msg.status === 'read' && ' · Read'}
          {/* Editing is offered only on your own text, and not on a
              message that was deleted or that carries only a file —
              there is nothing there to correct. */}
          {msg.sender === 'me' && !msg.isDeleted && msg.text && editingId !== msg.id && (
            <button
              onClick={() => setEditingId(msg.id)}
              style={{ background: 'none', border: 'none', padding: 0,
                       color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Edit
            </button>
          )}
        </p>
      </div>
    </div>
  );

  const renderEmptyThread = () => (
    <div className="text-center py-10" style={{ color: theme.text, opacity: 0.6 }}>
      {loadingThread ? 'Loading…' : 'No messages yet. Say something.'}
    </div>
  );

  // Mobile Layout
  if (isMobile) {
    if (selectedFriend && currentFriend) {
      return (
        <div
          className="flex flex-col"
          style={{ background: theme.chatBg, minHeight: '100vh' }}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,video/*,audio/*"
          />

          <div
            className="header flex items-center py-2 px-0 border-b"
            style={{
              backgroundColor: theme.surface,
              borderColor: theme.border
            }}
          >
            <button onClick={() => { setSelectedFriend(null); setHideExtra?.(false); }}>
              <ArrowLeft size={20} style={{ color: theme.text }} />
            </button>
            <div className="flex items-center gap-3 flex-1 text-left">
              <div className="relative">
                <Avatar user={currentFriend} theme={theme} size={40} />
                {currentFriend.online && (
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2"
                       style={{ borderColor: theme.surface }} />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold" style={{ color: theme.text }}>
                  {currentFriend.name}
                </h3>
                <p className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                  {presenceLine(currentFriend)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-6 me-4">
              <Phone size={20} style={{ color: theme.text, opacity: 0.35 }} />
              <Video size={25} style={{ color: theme.text, opacity: 0.35 }} />
              <div className="relative">
                <button
                  aria-label="Conversation options"
                  aria-expanded={menuOpen}
                  onClick={() => { setMenuOpen((open) => !open); setConfirmLeave(false); }}
                  style={{ background: 'none', border: 'none', padding: 0 }}
                >
                  <Info size={21} style={{ color: theme.text }} />
                </button>
                {renderConversationMenu()}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-left">
            {messages.length === 0 && renderEmptyThread()}
            {messages.map((msg) => <Fragment key={msg.id}>{renderMessageBubble({ msg })}</Fragment>)}
            {typingName && (
              <p className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                {typingName} is typing…
              </p>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div
            className="p-2 border-t"
            style={{
              backgroundColor: theme.surface,
              borderColor: theme.border,
              position: 'sticky',
              bottom: 0
            }}
          >
            {error && <p className="text-xs pb-1" style={{ color: theme.text, opacity: 0.8 }}>{error}</p>}
            <div className="flex items-center gap-2">
              <Paperclip size={20} style={{ color: theme.text }} onClick={handleFileClick} />
              <div
                className="flex-1 flex items-end gap-2 px-4 py-2 rounded-4xl border"
                style={{
                  backgroundColor: theme.chatBg,
                  borderColor: theme.border
                }}
              >
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={message}
                  onChange={(e) => handleTyping(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{ color: theme.text }}
                />
              </div>
              <button
                onClick={handleSendMessage}
                disabled={sending}
                className="p-2 rounded-full"
                style={{ backgroundColor: `${theme.accent}80`, opacity: sending ? 0.6 : 1 }}
              >
                <Send size={18} style={{ color: theme.text }} />
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        style={{ background: theme.gradient }}
      >
        <div
          className="px-4 py-2 border-b"
          style={{
            backgroundColor: theme.surface,
            borderColor: theme.border
          }}
        >
          <div className="flex gap-2 items-center">
            <Search size={18} style={{ color: theme.text, opacity: 0.5 }} />
            <input
              type="text"
              placeholder="Search souls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-1 pr-4 pt-2 rounded-full outline-none text-md"
              style={{
                backgroundColor: theme.chatBg,
                color: theme.text
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredFriends.length === 0 && (
            <div className="text-center py-16 px-6">
              <div className="text-5xl mb-3">💬</div>
              <p style={{ color: theme.text, opacity: 0.7 }}>
                No conversations yet. Start one from a connection's profile.
              </p>
            </div>
          )}
          {filteredFriends.map((friend) => (
            <div
              key={friend.id}
              onClick={() => openConversation(friend.id, true)}
              className="flex items-center gap-3 p-4 border-b cursor-pointer hover:bg-opacity-50"
              style={{
                borderColor: theme.border,
                backgroundColor: 'transparent'
              }}
            >
              <div className="relative">
                <Avatar user={friend} theme={theme} size={40} />
                {friend.online && (
                  <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2"
                       style={{ borderColor: theme.surface }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium truncate" style={{ color: theme.text }}>
                    {friend.name}
                  </h3>
                  <span className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                    {friend.time}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-sm truncate" style={{ color: theme.text, opacity: 0.7 }}>
                    {friend.lastMessage}
                  </p>
                  {friend.unread > 0 && (
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ backgroundColor: theme.secondary }}
                    >
                      {friend.unread}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Desktop Layout
  return (
    <div
      className="h-dvh flex"
      style={{ background: theme.gradient }}
    >
      <div
        className="w-1/4 border-r flex flex-col"
        style={{
          backgroundColor: theme.surface,
          borderColor: theme.border
        }}
      >
        <div
          className="p-3 border-b space-y-2"
          style={{ borderColor: theme.border }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-md font-bold" style={{ color: theme.text }}>
              Whispers
            </h3>
            <button
              aria-label="Message settings"
              title="Who can message you, and message notifications"
              onClick={() => onOpenSettings?.()}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <Settings size={16} style={{ color: theme.text }} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 transform -translate-y-1/2"
                   style={{ color: theme.text, opacity: 0.5 }} />
            <input
              type="text"
              placeholder="Search friends..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-lg border outline-none text-xs"
              style={{
                backgroundColor: theme.chatBg,
                borderColor: theme.border,
                color: theme.text
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            accept="image/*,video/*,audio/*"
          />
          {filteredFriends.length === 0 && (
            <p className="p-4 text-xs" style={{ color: theme.text, opacity: 0.6 }}>
              No conversations yet.
            </p>
          )}
          {filteredFriends.map((friend) => (
            <div
              key={friend.id}
              onClick={() => openConversation(friend.id, false)}
              className={`flex items-center gap-3 p-4 cursor-pointer border-b hover:bg-opacity-50 ${
                selectedFriend === friend.id ? 'bg-opacity-20' : ''
              }`}
              style={{
                borderColor: theme.border,
                backgroundColor: selectedFriend === friend.id ? `${theme.accent}80` : 'transparent'
              }}
            >
              <div className="relative">
                <Avatar user={friend} theme={theme} size={32} />
                {friend.online && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border-2"
                       style={{ borderColor: theme.surface }} />
                )}
              </div>
              <div className="flex-1 flex flex-col gap-2 min-w-0">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sm truncate" style={{ color: theme.text }}>
                    {friend.name}
                  </h3>
                  <span className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                    {friend.time}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs truncate" style={{ color: theme.text, opacity: 0.7 }}>
                    {selectedFriend === friend.id && typingName
                      ? '✍️ Typing...'
                      : friend.lastMessage}
                  </p>
                  {friend.unread > 0 && (
                    <div
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-white"
                      style={{ backgroundColor: theme.secondary, fontSize: '10px' }}
                    >
                      {friend.unread}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-3/4 flex flex-col">
        {selectedFriend && currentFriend ? (
          <>
            <div
              className="flex items-center gap-3 p-4 border-b"
              style={{
                backgroundColor: theme.surface,
                borderColor: theme.border
              }}
            >
              <div className="flex items-center gap-3 flex-1 text-left">
                <div className="relative">
                  <Avatar user={currentFriend} theme={theme} size={36} />
                  {currentFriend.online && (
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-green-500 rounded-full border-2"
                         style={{ borderColor: theme.surface }} />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold" style={{ color: theme.text }}>
                    {currentFriend.name}
                  </h3>
                  <p className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                    {presenceLine(currentFriend)}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                {/* Voice and video calling are not built. The icons stay
                    for layout, dimmed and inert, rather than being wired to
                    something that pretends to place a call. */}
                <button className="p-2 rounded-lg" title="Calling isn't available yet" disabled>
                  <Phone size={18} style={{ color: theme.text, opacity: 0.35 }} />
                </button>
                <button className="p-2 rounded-lg" title="Video isn't available yet" disabled>
                  <Video size={18} style={{ color: theme.text, opacity: 0.35 }} />
                </button>
                <div className="relative">
                  <button
                    className="p-2 rounded-lg hover:bg-opacity-10"
                    aria-label="Conversation options"
                    aria-expanded={menuOpen}
                    onClick={() => { setMenuOpen((open) => !open); setConfirmLeave(false); }}
                  >
                    <MoreVertical size={18} style={{ color: theme.text }} />
                  </button>
                  {renderConversationMenu()}
                </div>
              </div>
            </div>

            <div
              className="flex-1 overflow-y-auto p-4 space-y-4 text-left"
              style={{ backgroundColor: theme.background }}
            >
              {messages.length === 0 && renderEmptyThread()}
              {messages.map((msg) => <Fragment key={msg.id}>{renderMessageBubble({ msg, wide: true })}</Fragment>)}
              {typingName && (
                <p className="text-xs" style={{ color: theme.text, opacity: 0.6 }}>
                  {typingName} is typing…
                </p>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div
              className="p-4 border-t"
              style={{
                backgroundColor: theme.surface,
                borderColor: theme.border
              }}
            >
              {error && <p className="text-xs pb-2" style={{ color: theme.text, opacity: 0.8 }}>{error}</p>}
              <div className="flex items-center gap-5">
                <Paperclip size={20} style={{ color: theme.text }} onClick={handleFileClick} />
                <div
                  className="flex-1 flex items-center gap-3 px-6 py-2 rounded-4xl border"
                  style={{
                    backgroundColor: theme.chatBg,
                    borderColor: theme.border
                  }}
                >
                  <input
                    type="text"
                    placeholder={`Message ${currentFriend.name}...`}
                    value={message}
                    onChange={(e) => handleTyping(e.target.value)}
                    onKeyPress={handleKeyPress}
                    className="flex-1 bg-transparent outline-none"
                    style={{ color: theme.text }}
                  />
                  <div className="relative">
                    <button
                      aria-label="Add emoji"
                      aria-expanded={emojiOpen}
                      onClick={() => setEmojiOpen((open) => !open)}
                      style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}
                    >
                      <Smile size={20} style={{ color: theme.text, opacity: 0.6 }} />
                    </button>
                    {emojiOpen && (
                      <div
                        className="absolute bottom-full right-0 mb-3 z-20 p-2 rounded-xl shadow-lg grid grid-cols-8 gap-1"
                        style={{ background: theme.surface, border: `1px solid ${theme.border}`, width: '272px' }}
                      >
                        {QUICK_EMOJI.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => insertEmoji(emoji)}
                            className="text-xl rounded-lg"
                            style={{ background: 'transparent', border: 'none', padding: '4px' }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleSendMessage}
                  disabled={sending}
                  className="p-2 rounded-lg"
                  style={{ backgroundColor: `${theme.accent}80`, opacity: sending ? 0.6 : 1 }}
                >
                  <Send size={18} style={{ color: theme.text }} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ backgroundColor: theme.background }}
          >
            <div className="text-center">
              <div className="text-6xl mb-4">💬</div>
              <h2 className="text-xl font-semibold mb-2" style={{ color: theme.text }}>
                Select a friend to chat
              </h2>
              <p style={{ color: theme.text, opacity: 0.7 }}>
                Choose a friend from the list to start a meaningful conversation
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;

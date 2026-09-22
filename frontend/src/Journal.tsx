import { useEffect, useState } from 'react';
import { FaRegCommentDots } from "react-icons/fa";
import { IoMdHeart, IoMdHeartEmpty } from "react-icons/io";
import { IoEarthSharp } from "react-icons/io5";
import { FaUserFriends } from "react-icons/fa";
import { SlCalender } from "react-icons/sl";
import { LuLock } from "react-icons/lu";
import { Pencil, Trash2, Share2 } from "lucide-react";
import { Preferences } from '@capacitor/preferences';
import { Avatar, EditedMark, InlineEditor } from './ui';
import type { Theme } from './theme';
import type { JournalComment, JournalEntry, JournalStats, Paginated } from './types';

interface JournalPageProps {
  theme: Theme;
  darkMode?: boolean;
  setBackPage: React.Dispatch<React.SetStateAction<string>>;
  setActiveTab: React.Dispatch<React.SetStateAction<string>>;
  /**
   * Open one entry straight into its edit or share dialog — used by the
   * edit and share buttons on your profile's Top Journals. The entry is
   * fetched by id, so it works even when it isn't on the first page.
   */
  focus?: { id: number; action: 'edit' | 'share' } | null;
  onFocusHandled?: () => void;
}

/** An entry as this screen reads it — exactly what the API sends. */
type JournalEntryView = JournalEntry;

/** The edit modal's form, which holds tags as the comma-separated text the input shows. */
interface EditForm {
  title: string;
  content: string;
  mood: string;
  tags: string;
}

/** The three "Include" checkboxes in the share modal, which are toggled by key. */
type ShareToggle = 'includeMood' | 'includeDate' | 'allowComments';

interface ShareSettings extends Record<ShareToggle, boolean> {
  visibility: string;
  identity: string;
  tags: string;
}

/**
 * The app's mood vocabulary.
 *
 * This screen used to carry a set of its own — Calm / Neutral / Tense /
 * Energized — which nothing else in SoulLog used. It had two
 * consequences, both invisible until you tried it: the mood filter could
 * never match a real entry, because entries are saved with the moods
 * below; and choosing one in the edit modal made the save fail, because
 * `mood` is a choice field on the server and three of those four values
 * are not among the choices. Same list as MoodCheckin and the backend,
 * so the three agree.
 */
const MOODS: Record<string, string> = {
  Happy: '😊',
  Sad: '😢',
  Angry: '😠',
  Excited: '🤩',
  Anxious: '😰',
  Calm: '😌',
  Frustrated: '😤',
  Content: '🙂',
  Lonely: '😔',
  Grateful: '🥰',
  Stressed: '😫',
  Hopeful: '🤗'
}

/** The readable part of a DRF error body, when it sent one. */
const problemMessage = (problem: unknown): string | undefined => {
  if (!problem || typeof problem !== 'object') return undefined;
  const body = problem as Record<string, unknown>;
  if (typeof body.detail === 'string') return body.detail;
  const content = body.content;
  if (Array.isArray(content) && typeof content[0] === 'string') return content[0];
  return undefined;
};

const JournalHistoryPage = ({ theme, setBackPage, setActiveTab, focus, onFocusHandled } : JournalPageProps) => {
  const [filterMood, setFilterMood] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntryView | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntryView | null>(null);
  const [showCommentsModal, setShowCommentsModal] = useState(false);
  const [commentsEntry, setCommentsEntry] = useState<JournalEntryView | null>(null);
  const [entryComments, setEntryComments] = useState<JournalComment[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [myUsername, setMyUsername] = useState('');

  useEffect(() => {
    const loadMe = async () => {
      const { value: access_token } = await Preferences.get({ key: 'access_token' });
      if (!access_token) return;
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/me`, {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        if (response.ok) {
          const me: { username: string } = await response.json();
          setMyUsername(me.username);
        }
      } catch {
        // Not knowing our own username just hides the "delete" affordance
        // on our own comments — not worth surfacing an error for.
      }
    };
    loadMe();
  }, []);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  // Problems inside the comments dialog are shown there, not in an alert().
  const [commentError, setCommentError] = useState('');
  // A one-line problem shown above the list, e.g. a failed delete.
  const [pageNotice, setPageNotice] = useState('');
  const [replyingTo, setReplyingTo] = useState<JournalComment | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    title: '',
    content: '',
    mood: 'Calm',
    tags: ''
  });
  const [shareSettings, setShareSettings] = useState<ShareSettings>({
    visibility: 'community',
    identity: 'username',
    includeMood: true,
    includeDate: true,
    allowComments: true,
    tags: ''
  });

  // Sample journal entries data
  const [journalEntries, setJournalEntries] = useState<JournalEntryView[]>([]);
  // Pagination state. The list used to arrive as one array of every entry
  // the account had ever written; it now arrives a page at a time, so the
  // screen tracks how much it is holding and whether there is more.
  const [totalEntries, setTotalEntries] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [listError, setListError] = useState('');
  const [stats, setStats] = useState<JournalStats | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const moods = Object.entries(MOODS).map(([label, emoji]) => ({ label, emoji }));

  // Filtering and sorting now happen in SQL, not here.
  //
  // The old version of this block filtered and sorted the array it had.
  // That was already subtly broken — it sorted on `entry.date` and
  // `entry.time`, which this API has never returned, so every comparison
  // was against an Invalid Date and the sort control did nothing. More
  // importantly, once the list is one page, filtering the page would mean
  // "search the twenty entries you happen to be holding", and something
  // written in March would appear not to exist. The query goes to the
  // server; what comes back is already filtered and ordered.
  const filteredEntries = journalEntries;

  /**
   * Toggle a heart on a shared entry.
   *
   * Optimistic: the card flips immediately and the server's count
   * replaces the guess when it answers. If the request fails, the card is
   * put back the way it was rather than left showing a heart that was
   * never recorded.
   */
  const handleLike = async (entry: JournalEntryView) => {
    const wasLiked = !!entry.liked;
    const apply = (liked: boolean, likes: number) =>
      setJournalEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, liked, likes } : e))
      );

    apply(!wasLiked, (entry.likes || 0) + (wasLiked ? -1 : 1));

    try {
      const { value: access_token } = await Preferences.get({ key: 'access_token' });
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/journal/${entry.id}/react/`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${access_token}` } }
      );
      if (!response.ok) throw new Error('react failed');
      const result: { liked: boolean; likes: number } = await response.json();
      apply(result.liked, result.likes);
    } catch {
      apply(wasLiked, entry.likes || 0);
    }
  };

  /**
   * 'Today' / 'Yesterday' / 'N days ago' for an entry's date.
   *
   * Counted in calendar days, not in elapsed hours. The old version
   * divided the elapsed milliseconds and rounded *up*, so anything
   * written more than a moment ago was already 'Yesterday' — an entry
   * from ten minutes earlier said it was written the day before. Whether
   * something happened yesterday is a question about dates, so the
   * comparison is between dates with the time of day discarded.
   */
  const getTimeAgo = (dateStr: string) => {
    const startOfDay = (value: Date) =>
      new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();

    const entryDate = new Date(dateStr);
    if (Number.isNaN(entryDate.getTime())) return '';

    const diffDays = Math.round(
      (startOfDay(new Date()) - startOfDay(entryDate)) / (1000 * 60 * 60 * 24)
    );

    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
    }
    const months = Math.floor(diffDays / 30);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  };

  const handleShare = (entry: JournalEntryView) => {
    setSelectedEntry(entry);
    setShowShareModal(true);
  };

  const handleEdit = (entry: JournalEntryView) => {
    setEditingEntry(entry);
    setEditForm({
      title: entry.title,
      content: entry.content,
      mood: entry.mood,
      tags: entry.tags.join(', ')
    });
    setShowEditModal(true);
  };

  useEffect(() => {
    if (!focus) return;
    let cancelled = false;
    (async () => {
      try {
        const { value: access_token } = await Preferences.get({ key: 'access_token' });
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${focus.id}/`, {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        if (!response.ok || cancelled) return;
        const entry: JournalEntryView = await response.json();
        if (focus.action === 'edit') handleEdit(entry);
        else handleShare(entry);
      } finally {
        if (!cancelled) onFocusHandled?.();
      }
    })();
    return () => { cancelled = true; };
    // Runs when a new focus request arrives, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const fetchComments = async (entryId: number) => {
    setIsLoadingComments(true);
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${entryId}/comments/`, {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      if (response.ok) {
        const comments: JournalComment[] = await response.json();
        setEntryComments(comments);
      } else {
        setEntryComments([]);
      }
    } catch {
      setEntryComments([]);
    } finally {
      setIsLoadingComments(false);
    }
  };

  const handleComments = (entry: JournalEntryView) => {
    setCommentsEntry(entry);
    setShowCommentsModal(true);
    setNewComment('');
    setReplyingTo(null);
    fetchComments(entry.id);
  };

  const submitComment = async () => {
    if (!newComment.trim() || !commentsEntry) return;

    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${commentsEntry.id}/comments/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify(
          replyingTo ? { content: newComment, parent: replyingTo.id } : { content: newComment }
        )
      });
      if (response.ok) {
        await fetchComments(commentsEntry.id);
        // Cleared only once it's posted. It used to be cleared whatever
        // happened, so a failed post threw away what you had written.
        setNewComment('');
        setCommentError('');
      } else {
        setCommentError("Couldn't post that comment. Your text is still here — try again.");
      }
    } catch {
      setCommentError("Couldn't reach the server. Your text is still here — try again.");
    }

    setReplyingTo(null);
  };

  const reactToComment = async (commentId: number) => {
    if (!commentsEntry) return;
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/journal/${commentsEntry.id}/comments/${commentId}/react/`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${access_token}` } }
      );
      if (response.ok) {
        await fetchComments(commentsEntry.id);
      }
    } catch {
      // Silent — a failed reaction toggle isn't worth interrupting the user for.
    }
  };

  const deleteComment = async (commentId: number) => {
    if (!commentsEntry) return;
    if (!window.confirm('Delete this comment?')) return;
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/journal/${commentsEntry.id}/comments/${commentId}/`,
        { method: 'DELETE', headers: { 'Authorization': `Bearer ${access_token}` } }
      );
      if (response.ok || response.status === 204) {
        await fetchComments(commentsEntry.id);
        setCommentError('');
      } else {
        setCommentError("Couldn't delete that comment. Try again.");
      }
    } catch {
      setCommentError("Couldn't reach the server. Check your connection and try again.");
    }
  };

  /**
   * Save an edit to one of your own comments.
   *
   * Throws on failure so that `InlineEditor` keeps the editor open with
   * the text still in it; swallowing the error here would discard the
   * correction and leave the old text on screen as if nothing happened.
   */
  const saveCommentEdit = async (commentId: number, text: string) => {
    // The editor this saves from is rendered inside the comments modal,
    // which only exists while `commentsEntry` is set.
    const entry = commentsEntry!;
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/journal/${entry.id}/comments/${commentId}/`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({ content: text })
      }
    );
    if (!response.ok) {
      // An error body is genuinely unknown — DRF sends `{detail}` for some
      // failures and `{content: [...]}` for a rejected field — so it is
      // read defensively rather than assumed.
      const problem: unknown = await response.json().catch(() => ({}));
      throw new Error(problemMessage(problem) || "Couldn't save that change.");
    }
    setEditingCommentId(null);
    await fetchComments(entry.id);
  };

  const startReply = (comment: JournalComment) => {
    setReplyingTo(comment);
    setNewComment('');
  };

  const saveEdit = async () => {
    if (!editingEntry) return;
    setIsSavingEdit(true);
    setEditError('');

    const { value: access_token } = await Preferences.get({ key: 'access_token' });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${editingEntry.id}/`, {
        method: 'PATCH',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({
          title: editForm.title,
          content: editForm.content,
          mood: editForm.mood,
          tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
        })
      });

      if (response.status === 401) {
        await Preferences.remove({ key: 'access_token' });
        window.location.reload();
        return;
      }

      if (!response.ok) {
        setEditError('Something went wrong while saving your changes. Please try again.');
        return;
      }

      const updated: JournalEntryView = await response.json();
      setJournalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setShowEditModal(false);
      setEditingEntry(null);
      setEditForm({ title: '', content: '', mood: 'Calm', tags: '' });
    } catch {
      setEditError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteEntry = async (entry: JournalEntryView) => {
    if (!window.confirm(`Delete "${entry.title || 'this entry'}"? This can't be undone.`)) {
      return;
    }
    setDeletingId(entry.id);

    const { value: access_token } = await Preferences.get({ key: 'access_token' });

    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${entry.id}/`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${access_token}` }
      });

      if (response.status === 401) {
        await Preferences.remove({ key: 'access_token' });
        window.location.reload();
        return;
      }

      if (response.ok || response.status === 204) {
        setJournalEntries((prev) => prev.filter((e) => e.id !== entry.id));
        setTotalEntries((prev) => Math.max(prev - 1, 0));
        getStats();
      } else {
        setPageNotice("Couldn't delete that entry. Please try again.");
      }
    } catch {
      setPageNotice("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const confirmShare = async () => {
    if (!selectedEntry) return; // Prevent errors if null
    setIsSharing(true);
    setShareError('');

    // The UI's "friends" option maps to the backend's "connections" —
    // the frontend's own vocabulary was kept as-is rather than renamed,
    // translated only here at the API boundary.
    // Note: identity (anonymous/username), includeMood, includeDate, and
    // allowComments are UI-only preferences right now — the backend has
    // no field for them yet, so they're not sent. Documented, not silently
    // dropped: see docs/NOT-BUILT-OR-DEFERRED.md.
    const backendVisibility = shareSettings.visibility === 'friends' ? 'connections' : shareSettings.visibility;

    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/${selectedEntry.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${access_token}`
        },
        body: JSON.stringify({
          visibility: backendVisibility,
          tags: shareSettings.tags.split(',').map((t) => t.trim()).filter(Boolean),
        })
      });

      if (response.status === 401) {
        await Preferences.remove({ key: 'access_token' });
        window.location.reload();
        return;
      }

      if (!response.ok) {
        setShareError("Couldn't update sharing settings. Please try again.");
        return;
      }

      const updated: JournalEntryView = await response.json();
      setJournalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setShowShareModal(false);
      setSelectedEntry(null);
      setShareSettings({
        visibility: 'community',
        identity: 'username',
        includeMood: true,
        includeDate: true,
        allowComments: true,
        tags: ''
      });
    } catch {
      setShareError('Could not reach the server. Check your connection and try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const PAGE_SIZE = 20;

  /**
   * Fetch one page of entries.
   *
   * `append` is what separates "load more" from every other reason to
   * reload: appending keeps what is on screen and adds to the end, while
   * a fresh search or a changed filter replaces it and goes back to the
   * top. The search text, mood filter and sort all travel as query
   * params, because the server is the only place that can see the whole
   * journal.
   */
  const getJournals = async (append = false) => {
    const { value: access_token } = await Preferences.get({ key: 'access_token' });

    const offset = append ? journalEntries.length : 0;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
      sort: sortBy,
    });
    if (filterMood !== 'all') params.set('mood', filterMood);
    if (searchQuery.trim()) params.set('q', searchQuery.trim());

    if (append) setIsLoadingMore(true); else setIsLoadingList(true);
    setListError('');

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/journal/?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${access_token}`
          }
        }
      );
      if (response.status === 401) {
        await Preferences.remove({ key: 'access_token' });
        window.location.reload();
        return;
      }
      if (!response.ok) {
        setListError("Couldn't load your entries. Check your connection and try again.");
        return;
      }

      const page: Paginated<JournalEntryView> = await response.json();
      setJournalEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
      setTotalEntries(page.total);
      setHasMore(page.hasMore);
    } catch {
      setListError("Couldn't load your entries. Check your connection and try again.");
    } finally {
      setIsLoadingMore(false);
      setIsLoadingList(false);
    }
  }

  /**
   * The summary tiles come from /journal/stats/, not from the page.
   *
   * Counting them from the entries on screen would have quietly turned
   * "Total Entries" into "entries on this page" the moment the list was
   * paginated. The streak tile used to read a hardcoded '7 days'; it is
   * now the same streak the dashboard shows.
   */
  const getStats = async () => {
    const { value: access_token } = await Preferences.get({ key: 'access_token' });
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/journal/stats/`, {
        headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${access_token}` }
      });
      if (response.ok) {
        const summary: JournalStats = await response.json();
        setStats(summary);
      }
    } catch {
      // The tiles fall back to '—'; a failed stats call is not worth
      // interrupting the screen over.
    }
  }

  // Re-query when the search text, mood filter or sort changes. The
  // search is debounced so that typing a word is one request rather than
  // one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => { getJournals(false); }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, filterMood, sortBy])

  useEffect(() => {
    getStats();
  }, [])

  return (
    <div className='text-sm' style={{
      fontFamily: "'Merriweather', Tahoma, Geneva, Verdana, sans-serif",
      background: theme.background,
      color: theme.text,
      padding: '0.75rem',
      overflowX: 'hidden'
    }}>
      <div style={{ margin: '0 auto' }}>

        {/* Journal Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px', color: theme.accent }}>
            Your Journal
          </div>
          <div style={{ fontSize: '16px', color: theme.mutedText }}>
            Personal reflection space
          </div>
        </div>

        {/* Quick Stats */}
        <div className='flex flex-wrap gap-2 mb-8'>
          {[
            { icon: '📝', label: 'Total Entries', value: stats ? stats.total_entries : '—' },
            { icon: '📤', label: 'Shared', value: stats ? stats.shared_entries : '—' },
            { icon: '💙', label: 'Total Likes', value: stats ? stats.likes_received : '—' },
            {
              icon: '🔥',
              label: 'Current Streak',
              value: stats
                ? `${stats.current_streak_days} day${stats.current_streak_days === 1 ? '' : 's'}`
                : '—'
            }
          ].map((stat, index) => (
            <div
              key={index}
              style={{
                flex: 1,
                minWidth: '150px',
                background: theme.surface,
                padding: '15px',
                borderRadius: '12px',
                border: `1px solid ${theme.border}`,
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '20px', marginBottom: '5px' }}>{stat.icon}</div>
              <div style={{ fontSize: '18px', fontWeight: '600', color: theme.accent, marginBottom: '2px' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '12px', color: theme.text + '80' }}>{stat.label}</div>
            </div>
          ))}
        </div>

        <button
          className='!p-4 !border-none !outline-none rounded-xl cursor-pointer font-medium text-md text-center flex items-center justify-center gap-2'
          style={{
            background: `linear-gradient(45deg, ${theme.accent}, ${theme.secondary})`,
            color: theme.background,
            transition: 'all 0.3s ease',
            width: '100%',
          }}
          onClick={() => {
            setBackPage('Journal');
            setActiveTab('Log');
          }}
        >
          <span>✏️</span> Write New Entry
        </button>
      </div>

        {/* Filters and Search */}
        <div className='rounded-xl p-4 mb-2 mt-8 space-y-3 text-left' style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
        }}>
          <input
            className='text-sm px-4 py-3 rounded-xl outline-none w-full'
            type="text"
            placeholder="🔍 Search entries, tags, or feelings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              color: theme.text,
            }}
            onFocus={(e) => {
              e.target.style.borderColor = theme.accent;
              e.target.style.boxShadow = `0 0 0 2px ${theme.accent}20`;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = theme.border;
              e.target.style.boxShadow = 'none';
            }}
          />

          <div className='flex items-center gap-4 flex-wrap'>
            {/* Mood Filter */}
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ fontSize: '14px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '8px' }}>
                Filter by Mood
              </label>
              <select
                value={filterMood}
                onChange={(e) => setFilterMood(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 15px',
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '10px',
                  color: theme.text,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Moods</option>
                {moods.map(mood => (
                  <option key={mood.label} value={mood.label}>{mood.emoji} {mood.label}</option>
                ))}
              </select>
            </div>

            {/* Sort Options */}
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label style={{ fontSize: '14px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '8px' }}>
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 15px',
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  borderRadius: '10px',
                  color: theme.text,
                  fontSize: '14px',
                  cursor: 'pointer'
                }}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="mood">By Mood</option>
              </select>
            </div>
          </div>
        </div>

        {/* Journal Entries */}
        <div className='flex flex-col gap-2 text-left'>
          {pageNotice && (
            <div role="alert" style={{
              display: 'flex', justifyContent: 'space-between', gap: '12px',
              padding: '10px 14px', borderRadius: '10px', fontSize: '13px',
              background: theme.surface, border: `1px solid ${theme.error}66`, color: theme.text,
            }}>
              <span>{pageNotice}</span>
              <button onClick={() => setPageNotice('')} aria-label="Dismiss" style={{ background: 'none', border: 'none', color: theme.text, cursor: 'pointer', padding: 0 }}>✕</button>
            </div>
          )}
          {isLoadingList ? (
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '40px',
              textAlign: 'center',
              border: `1px solid ${theme.border}`,
              color: theme.text + '80'
            }}>
              Loading your entries…
            </div>
          ) : listError ? (
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '40px',
              textAlign: 'center',
              border: `1px solid ${theme.border}`
            }}>
              <div style={{ fontSize: '48px', marginBottom: '15px' }}>⚠️</div>
              <div style={{ fontSize: '14px', color: theme.text + '80', marginBottom: '14px' }}>
                {listError}
              </div>
              <button
                onClick={() => getJournals(false)}
                style={{
                  background: theme.accent, color: '#fff', border: 'none',
                  padding: '8px 18px', borderRadius: '10px', cursor: 'pointer'
                }}
              >
                Try again
              </button>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '40px',
              textAlign: 'center',
              border: `1px solid ${theme.border}`
            }}>
              <div style={{ fontSize: '48px', marginBottom: '15px' }}>📭</div>
              <div style={{ fontSize: '18px', color: theme.text, marginBottom: '8px' }}>No entries found</div>
              <div style={{ fontSize: '14px', color: theme.text + '80' }}>
                {searchQuery || filterMood !== 'all'
                  ? 'Try adjusting your search or filters'
                  : 'Start writing your first journal entry!'}
              </div>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                className='rounded-xl p-4'
                key={entry.id}
                style={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  
                }}
              >
                {/* Entry Header */}
                <div className='flex flex-col justify-center gap-2 flex-wrap'>
                  <div className='flex items-center justify-between gap-2'>
                    <p className='text-md font-semibold' style={{ color: theme.accent }}>
                      {entry?.title}
                    </p>
                    <div className='flex items-center gap-3' style={{ color: theme.text + '80' }}>
                      <button
                        onClick={() => handleShare(entry)}
                        title="Share entry"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}
                      >
                        <Share2 size={16} />
                      </button>
                      <button
                        onClick={() => handleEdit(entry)}
                        title="Edit entry"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex' }}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteEntry(entry)}
                        disabled={deletingId === entry.id}
                        title="Delete entry"
                        style={{ background: 'none', border: 'none', cursor: deletingId === entry.id ? 'not-allowed' : 'pointer', color: 'inherit', display: 'flex', opacity: deletingId === entry.id ? 0.5 : 1 }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <div className='flex text-sm items-center gap-4' style={{ color: theme.text + '80' }}>
                    <span style={{ fontSize: '15px' }}>{MOODS[entry?.mood]}</span>
                    <span>{entry?.mood}</span>
                    <SlCalender />
                    <span>
                      {getTimeAgo(entry?.created_at)} • {new Date(entry?.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    { entry.visibility === 'community' ? <IoEarthSharp size={16} title="Everyone on SoulLog" /> : entry.visibility === 'connections' ? <FaUserFriends size={16} title="Your connections" /> : <LuLock title="Only you" /> }
                  </div>
                </div>

                {/* Entry Content */}
                {
                  entry?.content && (
                    <div className='text-sm mt-2' style={{
                      color: theme.text,
                    }}>
                      {entry?.content}
                    </div>
                  )
                }

                {/* Tags */}
                {entry?.tags && entry.tags.length > 0 && (
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '15px'
                  }}>
                    {entry.tags.map((tag, index) => (
                      <span
                        key={index}
                        style={{
                          background: theme.secondary + '20',
                          color: theme.secondary,
                          padding: '4px 12px',
                          borderRadius: '15px',
                          fontSize: '12px',
                          fontWeight: '500'
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}

                {/* Entry Footer */}
                {entry?.shared && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-around',
                    alignItems: 'center',
                    paddingTop: '15px',
                    borderTop: `1px solid ${theme.border}`,
                    fontSize: '14px',
                    color: theme.text + '80'
                  }}>
                    <button
                      onClick={() => handleLike(entry)}
                      title={entry.liked ? 'Remove your heart' : 'Heart this entry'}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: entry.liked ? theme.accent : theme.text + '80',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '14px',
                        padding: '0'
                      }}
                    >
                      {entry.liked ? <IoMdHeart size={18} /> : <IoMdHeartEmpty size={18} />}
                      {entry.likes || 0}
                    </button>
                    <button
                      onClick={() => handleComments(entry)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: theme.text + '80',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '14px',
                        padding: '0'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = theme.accent;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = theme.text + '80';
                      }}
                    >
                      <FaRegCommentDots size={16} /> {entry.comments || 0}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}

          {/* Load more — an explicit button rather than infinite scroll.
              A journal is something people go looking through; a list that
              grows as you scroll makes it impossible to get back to where
              you were. */}
          {hasMore && !isLoadingList && (
            <button
              onClick={() => getJournals(true)}
              disabled={isLoadingMore}
              style={{
                marginTop: '8px',
                padding: '12px',
                borderRadius: '12px',
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.accent,
                cursor: isLoadingMore ? 'default' : 'pointer',
                opacity: isLoadingMore ? 0.6 : 1,
                fontWeight: 500
              }}
            >
              {isLoadingMore
                ? 'Loading…'
                : `Load more (${journalEntries.length} of ${totalEntries})`}
            </button>
          )}

          {!isLoadingList && !hasMore && journalEntries.length > 0 && totalEntries > PAGE_SIZE && (
            <div style={{
              textAlign: 'center', padding: '12px', fontSize: '13px', color: theme.text + '66'
            }}>
              That's all {totalEntries} entries.
            </div>
          )}
        </div>

        {/* Comments Modal */}
        {showCommentsModal && commentsEntry && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}>
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '0',
              maxWidth: '700px',
              width: '100%',
              maxHeight: '85vh',
              border: `1px solid ${theme.border}`,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
              display: 'flex',
              flexDirection: 'column'
            }}>
              {/* Header */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '25px 30px 20px',
                borderBottom: `1px solid ${theme.border}`
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '22px',
                  color: theme.accent,
                  fontWeight: '600'
                }}>
                  💬 Comments
                </h2>
                <button
                  onClick={() => setShowCommentsModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.text,
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '5px'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Entry Preview */}
              <div style={{
                padding: '20px 30px',
                borderBottom: `1px solid ${theme.border}`,
                background: theme.surface
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  marginBottom: '10px'
                }}>
                  <span style={{ fontSize: '20px' }}>{MOODS[commentsEntry?.mood]}</span>
                  <span style={{ fontSize: '16px', fontWeight: '600', color: theme.text }}>
                    {commentsEntry.title}
                  </span>
                  <span style={{ fontSize: '12px', color: theme.text + '60' }}>
                    {commentsEntry?.created_at ? new Date(commentsEntry.created_at).toLocaleDateString() : ''}
                  </span>
                </div>
                <div style={{
                  color: theme.text + '80',
                  fontSize: '14px',
                  lineHeight: '1.4',
                  maxHeight: '60px',
                  overflow: 'hidden'
                }}>
                  {commentsEntry.content?.slice(0, 150)}...
                </div>
              </div>

              {/* Comments List */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '20px 30px',
                maxHeight: '400px'
              }}>
                {isLoadingComments ? (
                  <div style={{ textAlign: 'center', color: theme.text + '80', padding: '20px' }}>Loading comments...</div>
                ) : entryComments && entryComments.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {entryComments.map((comment) => (
                      <div key={comment.id} style={{
                        background: theme.surface,
                        borderRadius: '12px',
                        padding: '15px',
                        border: `1px solid ${theme.border}`
                      }}>
                        {/* Comment Header */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: '10px'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Avatar user={{ name: comment.author, initials: comment.avatar, avatarUrl: comment.avatarUrl }} theme={theme} size={28} />
                            <span style={{ fontWeight: '600', fontSize: '14px', color: theme.text }}>
                              {comment.author}
                            </span>
                            <span style={{ fontSize: '12px', color: theme.text + '60' }}>
                              {comment.time}
                            </span>
                          </div>
                        </div>

                        {/* Comment Content */}
                        <div style={{
                          color: theme.text,
                          fontSize: '14px',
                          lineHeight: '1.5',
                          marginBottom: '12px'
                        }}>
                          {editingCommentId === comment.id ? (
                            <InlineEditor
                              value={comment.content}
                              theme={theme}
                              onSave={(text) => saveCommentEdit(comment.id, text)}
                              onCancel={() => setEditingCommentId(null)}
                              placeholder="Edit your comment…"
                            />
                          ) : (
                            <>
                              {comment.content}{' '}
                              <EditedMark editedAt={comment.editedAt} theme={theme} />
                            </>
                          )}
                        </div>

                        {/* Comment Actions */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '15px',
                          fontSize: '12px'
                        }}>
                          {/* Heart Reaction with Count */}
                          <button
                            onClick={() => reactToComment(comment.id)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: comment.reacted ? '#ff4444' : theme.text + '80',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '12px',
                              transition: 'all 0.3s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = '#ff4444';
                              e.currentTarget.style.transform = 'scale(1.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = comment.reacted ? '#ff4444' : theme.text + '80';
                              e.currentTarget.style.transform = 'scale(1)';
                            }}
                          >
                            ❤️ {comment.hearts || 0}
                          </button>
                          
                          <button
                            onClick={() => startReply(comment)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: theme.text + '80',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: '500'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.color = theme.secondary}
                            onMouseLeave={(e) => e.currentTarget.style.color = theme.text + '80'}
                          >
                            ↩️ Reply
                          </button>

                          {comment.author === myUsername && editingCommentId !== comment.id && (
                            <button
                              onClick={() => setEditingCommentId(comment.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: theme.text + '80',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.color = theme.accent}
                              onMouseLeave={(e) => e.currentTarget.style.color = theme.text + '80'}
                            >
                              ✏️ Edit
                            </button>
                          )}

                          {comment.author === myUsername && (
                            <button
                              onClick={() => deleteComment(comment.id)}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: theme.text + '80',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.color = theme.error || '#EF4444'}
                              onMouseLeave={(e) => e.currentTarget.style.color = theme.text + '80'}
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>

                        {/* Replies */}
                        {comment.replies && comment.replies.length > 0 && (
                          <div style={{
                            marginTop: '15px',
                            paddingLeft: '20px',
                            borderLeft: `2px solid ${theme.border}`
                          }}>
                            {comment.replies.map((reply) => (
                              <div key={reply.id} style={{
                                background: theme.cardBg,
                                borderRadius: '8px',
                                padding: '12px',
                                marginBottom: '10px'
                              }}>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  marginBottom: '8px'
                                }}>
                                  <Avatar user={{ name: reply.author, initials: reply.avatar, avatarUrl: reply.avatarUrl }} theme={theme} size={24} />
                                  <span style={{ fontWeight: '600', fontSize: '13px', color: theme.text }}>
                                    {reply.author}
                                  </span>
                                  <span style={{ fontSize: '11px', color: theme.text + '60' }}>
                                    {reply.time}
                                  </span>
                                </div>
                                <div style={{
                                  color: theme.text,
                                  fontSize: '13px',
                                  lineHeight: '1.4',
                                  marginBottom: '8px'
                                }}>
                                  {reply.content}
                                </div>
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px'
                                }}>
                                  {/* Heart Reaction for Replies */}
                                  <button
                                    onClick={() => reactToComment(reply.id)}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: reply.reacted ? '#ff4444' : theme.text + '80',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      fontSize: '11px',
                                      transition: 'all 0.3s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.color = '#ff4444';
                                      e.currentTarget.style.transform = 'scale(1.1)';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.color = reply.reacted ? '#ff4444' : theme.text + '80';
                                      e.currentTarget.style.transform = 'scale(1)';
                                    }}
                                  >
                                    ❤️ {reply.hearts || 0}
                                  </button>
                                  
                                  <button
                                    onClick={() => startReply({ ...comment, content: reply.content, author: reply.author })}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      color: theme.text + '80',
                                      cursor: 'pointer',
                                      fontSize: '11px',
                                      fontWeight: '500'
                                    }}
                                    onMouseEnter={(e) => e.currentTarget.style.color = theme.secondary}
                                    onMouseLeave={(e) => e.currentTarget.style.color = theme.text + '80'}
                                  >
                                    ↩️ Reply
                                  </button>

                                  {reply.author === myUsername && (
                                    <button
                                      onClick={() => deleteComment(reply.id)}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        color: theme.text + '80',
                                        cursor: 'pointer',
                                        fontSize: '11px',
                                        fontWeight: '500'
                                      }}
                                      onMouseEnter={(e) => e.currentTarget.style.color = theme.error || '#EF4444'}
                                      onMouseLeave={(e) => e.currentTarget.style.color = theme.text + '80'}
                                    >
                                      🗑️ Delete
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: theme.text + '60'
                  }}>
                    <div style={{ fontSize: '32px', marginBottom: '10px' }}>💬</div>
                    <div style={{ fontSize: '16px', marginBottom: '5px' }}>No comments yet</div>
                    <div style={{ fontSize: '14px' }}>Be the first to share your thoughts!</div>
                  </div>
                )}
              </div>

              {/* Comment Input */}
              <div style={{
                padding: '20px 30px 25px',
                borderTop: `1px solid ${theme.border}`,
                background: theme.surface
              }}>
                {replyingTo && (
                  <div style={{
                    background: theme.cardBg,
                    padding: '10px 15px',
                    borderRadius: '8px',
                    marginBottom: '10px',
                    border: `1px solid ${theme.border}`,
                    fontSize: '12px',
                    color: theme.text + '80'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Replying to <strong>{replyingTo.author}</strong></span>
                      <button
                        onClick={() => setReplyingTo(null)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: theme.text + '60',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ marginTop: '5px', fontStyle: 'italic' }}>
                      "{replyingTo.content.slice(0, 50)}..."
                    </div>
                  </div>
                )}

                {commentError && (
                  <div role="alert" style={{ color: theme.error, fontSize: '12px', marginBottom: '8px' }}>
                    {commentError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <textarea
                      value={newComment}
                      onChange={(e) => setNewComment(e.target.value)}
                      placeholder={replyingTo ? `Reply to ${replyingTo.author}...` : "Share your thoughts..."}
                      style={{
                        width: '100%',
                        minHeight: '80px',
                        maxHeight: '120px',
                        padding: '12px 15px',
                        background: theme.cardBg,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '12px',
                        color: theme.text,
                        fontSize: '14px',
                        lineHeight: '1.4',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        outline: 'none'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = theme.accent;
                        e.target.style.boxShadow = `0 0 0 2px ${theme.accent}20`;
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = theme.border;
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                    <div style={{
                      fontSize: '11px',
                      color: theme.text + '60',
                      marginTop: '5px',
                      textAlign: 'right'
                    }}>
                      {newComment.length}/500
                    </div>
                  </div>
                  <button
                    onClick={submitComment}
                    disabled={!newComment.trim()}
                    style={{
                      background: newComment.trim() ? `linear-gradient(45deg, ${theme.secondary}, ${theme.accent})` : theme.surface,
                      color: newComment.trim() ? theme.background : theme.text + '60',
                      border: `1px solid ${theme.border}`,
                      borderRadius: '12px',
                      padding: '12px 20px',
                      cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                      fontSize: '14px',
                      fontWeight: '600',
                      transition: 'all 0.3s ease',
                      minWidth: '80px',
                      height: 'fit-content',
                      alignSelf: 'center'
                    }}
                    onMouseEnter={(e) => {
                      if (newComment.trim()) {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (newComment.trim()) {
                        e.currentTarget.style.transform = 'translateY(0)';
                      }
                    }}
                  >
                    {replyingTo ? 'Reply' : 'Comment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {showEditModal && editingEntry && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}>
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '30px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
              border: `1px solid ${theme.border}`,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '25px'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '24px',
                  color: theme.accent,
                  fontWeight: '600'
                }}>
                  ✏️ Edit Entry
                </h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.text,
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '5px'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Entry Title */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '8px' }}>
                  📝 Title
                </label>
                <input
                  type="text"
                  value={editForm.title}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 15px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    color: theme.text,
                    fontSize: '16px',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = theme.accent;
                    e.target.style.boxShadow = `0 0 0 2px ${theme.accent}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = theme.border;
                    e.target.style.boxShadow = 'none';
                  }}
                />
              </div>

              {/* Mood Selection */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '10px' }}>
                  😌 Mood
                </label>
                <div style={{
                  display: 'flex',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}>
                  {moods.map((mood) => (
                    <button
                      key={mood.label}
                      onClick={() => setEditForm((prev) => ({ ...prev, mood: mood.label }))}
                      style={{
                        background: editForm.mood === mood.label ? theme.accent + '20' : theme.surface,
                        border: editForm.mood === mood.label ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                        borderRadius: '12px',
                        padding: '10px 15px',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: theme.text
                      }}
                    >
                      <span style={{ fontSize: '16px' }}>{mood.emoji}</span>
                      <span style={{ fontSize: '14px' }}>{mood.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '8px' }}>
                  💭 Content
                </label>
                <textarea
                  value={editForm.content}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                  style={{
                    width: '100%',
                    minHeight: '200px',
                    padding: '15px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    color: theme.text,
                    fontSize: '16px',
                    lineHeight: '1.6',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = theme.accent;
                    e.target.style.boxShadow = `0 0 0 2px ${theme.accent}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = theme.border;
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <div style={{
                  fontSize: '12px',
                  color: theme.text + '60',
                  marginTop: '5px',
                  textAlign: 'right'
                }}>
                  {editForm.content.length} characters
                </div>
              </div>

              {/* Tags */}
              <div style={{ marginBottom: '25px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '8px' }}>
                  🏷️ Tags
                </label>
                <input
                  type="text"
                  placeholder="e.g., gratitude, motivation, reflection"
                  value={editForm.tags}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, tags: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px 15px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    color: theme.text,
                    fontSize: '14px',
                    outline: 'none'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = theme.accent;
                    e.target.style.boxShadow = `0 0 0 2px ${theme.accent}20`;
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = theme.border;
                    e.target.style.boxShadow = 'none';
                  }}
                />
                <div style={{ fontSize: '12px', color: theme.text + '60', marginTop: '5px' }}>
                  Separate tags with commas
                </div>
              </div>

              {/* Original Entry Info */}
              <div style={{
                background: theme.surface,
                padding: '12px',
                borderRadius: '8px',
                marginBottom: '20px',
                border: `1px solid ${theme.border}`
              }}>
                <div style={{ fontSize: '12px', color: theme.text + '80', marginBottom: '5px' }}>
                  Original entry: {new Date(editingEntry.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                <div style={{ fontSize: '12px', color: theme.text + '60' }}>
                  Last edited: Just now
                </div>
              </div>

              {/* Action Buttons */}
              {editError && (
                <div style={{ color: theme.error || '#EF4444', fontSize: '0.85rem', marginBottom: '10px', textAlign: 'center' }}>
                  {editError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowEditModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    color: theme.text,
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: '500'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  disabled={isSavingEdit}
                  style={{
                    flex: 2,
                    padding: '12px',
                    background: `linear-gradient(45deg, ${theme.secondary}, ${theme.accent})`,
                    border: 'none',
                    borderRadius: '10px',
                    color: theme.background,
                    cursor: isSavingEdit ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: '600',
                    opacity: isSavingEdit ? 0.7 : 1
                  }}
                >
                  {isSavingEdit ? '💾 Saving...' : '💾 Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Share Modal */}
        {showShareModal && selectedEntry && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}>
            <div style={{
              background: theme.cardBg,
              borderRadius: '20px',
              padding: '30px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
              border: `1px solid ${theme.border}`,
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '25px'
              }}>
                <h2 style={{
                  margin: 0,
                  fontSize: '24px',
                  color: theme.accent,
                  fontWeight: '600'
                }}>
                  📤 Share Your Entry
                </h2>
                <button
                  onClick={() => setShowShareModal(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: theme.text,
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '5px'
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Visibility Settings */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '10px' }}>
                  🌍 Visibility
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { value: 'community', label: 'Community', desc: 'Everyone signed in to SoulLog', icon: '👥' },
                    // Was "Specific Connections — only selected connections", but
                    // there is no way to pick people: it has always meant
                    // everyone you're connected with. Now it says so.
                    { value: 'friends', label: 'My Connections', desc: "Only people you've connected with", icon: '👤' }
                  ].map(option => (
                    <label key={option.value} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px',
                      background: shareSettings.visibility === option.value ? theme.accent + '20' : theme.surface,
                      border: shareSettings.visibility === option.value ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}>
                      <input
                        type="radio"
                        name="visibility"
                        value={option.value}
                        checked={shareSettings.visibility === option.value}
                        onChange={(e) => setShareSettings((prev) => ({ ...prev, visibility: e.target.value }))}
                        style={{ margin: 0 }}
                      />
                      <span style={{ fontSize: '16px' }}>{option.icon}</span>
                      <div>
                        <div style={{ color: theme.text, fontWeight: '500' }}>{option.label}</div>
                        <div style={{ color: theme.text + '80', fontSize: '12px' }}>{option.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Identity Settings */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '10px' }}>
                  👤 Share As
                </label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {[
                    { value: 'username', label: 'You', icon: '👤' },
                    { value: 'anonymous', label: 'Anonymous', icon: '🎭' }
                  ].map(option => (
                    <label key={option.value} style={{
                      flex: 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px',
                      background: shareSettings.identity === option.value ? theme.accent + '20' : theme.surface,
                      border: shareSettings.identity === option.value ? `2px solid ${theme.accent}` : `1px solid ${theme.border}`,
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease'
                    }}>
                      <input
                        type="radio"
                        name="identity"
                        value={option.value}
                        checked={shareSettings.identity === option.value}
                        onChange={(e) => setShareSettings((prev) => ({ ...prev, identity: e.target.value }))}
                        style={{ margin: 0 }}
                      />
                      <span>{option.icon}</span>
                      <span style={{ color: theme.text, fontWeight: '500' }}>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Content Options */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '10px' }}>
                  📝 Include
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {([
                    { key: 'includeMood', label: 'Mood', icon: '😌' },
                    { key: 'includeDate', label: 'Date', icon: '📅' },
                    { key: 'allowComments', label: 'Allow Comments', icon: '💬' }
                  ] as { key: ShareToggle; label: string; icon: string }[]).map(option => (
                    <label key={option.key} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px',
                      background: theme.surface,
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}>
                      <input
                        type="checkbox"
                        checked={shareSettings[option.key]}
                        onChange={(e) => setShareSettings((prev) => ({ ...prev, [option.key]: e.target.checked }))}
                        style={{ margin: 0 }}
                      />
                      <span>{option.icon}</span>
                      <span style={{ color: theme.text }}>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div style={{ marginBottom: '25px' }}>
                <label style={{ fontSize: '16px', color: theme.text, fontWeight: '500', display: 'block', marginBottom: '10px' }}>
                  🏷️ Tags (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., gratitude, motivation, reflection"
                  value={shareSettings.tags}
                  onChange={(e) => setShareSettings((prev) => ({ ...prev, tags: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '12px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '8px',
                    color: theme.text,
                    fontSize: '14px',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Preview */}
              <div style={{
                background: theme.surface,
                padding: '15px',
                borderRadius: '10px',
                marginBottom: '20px',
                border: `1px solid ${theme.border}`
              }}>
                <div style={{ fontSize: '14px', color: theme.text + '80', marginBottom: '8px' }}>Preview:</div>
                <div style={{ fontSize: '12px', color: theme.accent, marginBottom: '5px' }}>
                  {shareSettings.identity === 'anonymous' ? '🎭 Anonymous User' : '👤 Your Name'}
                  {shareSettings.includeDate && ` • ${selectedEntry.created_at}`}
                  {shareSettings.includeMood && selectedEntry.mood && ` • ${selectedEntry.mood} ${MOODS[selectedEntry.mood] || ''}`}
                </div>
                <div style={{ 
                  color: theme.text, 
                  fontSize: '14px', 
                  lineHeight: '1.4',
                  maxHeight: '60px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontWeight: '600',
                  marginBottom: '5px'
                }}>
                  {selectedEntry.title}
                </div>
                <div style={{ 
                  color: theme.text, 
                  fontSize: '14px', 
                  lineHeight: '1.4',
                  maxHeight: '60px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {selectedEntry.content.slice(0, 100)}...
                </div>
                {shareSettings.tags && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    {shareSettings.tags.split(',').map((tag, index) => (
                      <span key={index} style={{
                        background: theme.accent + '20',
                        color: theme.accent,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        marginRight: '5px',
                        display: 'inline-block'
                      }}>
                        #{tag.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => setShowShareModal(false)}
                  style={{
                    flex: 1,
                    padding: '12px',
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    borderRadius: '10px',
                    color: theme.text,
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: '500'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmShare}
                  disabled={isSharing}
                  style={{
                    flex: 2,
                    padding: '12px',
                    background: `linear-gradient(45deg, ${theme.secondary}, ${theme.accent})`,
                    border: 'none',
                    borderRadius: '10px',
                    color: theme.background,
                    cursor: isSharing ? 'not-allowed' : 'pointer',
                    fontSize: '16px',
                    fontWeight: '600',
                    opacity: isSharing ? 0.7 : 1
                  }}
                >
                  {isSharing ? '📤 Sharing...' : '📤 Share Entry'}
                </button>
              </div>
              {shareError && (
                <div style={{ color: theme.error || '#EF4444', fontSize: '0.85rem', marginTop: '10px', textAlign: 'center' }}>
                  {shareError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
  );
};

export default JournalHistoryPage;



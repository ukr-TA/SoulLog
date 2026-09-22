import { useState } from 'react';
import type { Theme } from './theme';

/**
 * The parts of a person these pieces actually draw. Kept structural, and
 * every field optional, because the callers pass whatever they hold — a
 * `PublicUser`, a conversation row — and each of those spells the avatar
 * field differently.
 */
type AvatarUser = {
  name?: string;
  initials?: string;
  avatar?: string;
  avatar_url?: string | null;
  avatarUrl?: string | null;
};

/**
 * Small presentational pieces shared across screens.
 *
 * These live in their own file rather than beside the screen that first
 * needed them so that a screen file exports only its component — which is
 * what React Fast Refresh needs to reload a component without losing its
 * state during development.
 */

/**
 * A person's avatar: their uploaded photo when they have one, and the
 * initial the rest of the app draws when they don't.
 *
 * Never a random emoji standing in for a person. Several screens used to
 * pick one from a list ('🌸', '🧘‍♂️', '📚'), which looked friendly and
 * meant the same person appeared differently depending on where you saw
 * them.
 */
export const Avatar = ({
  user,
  theme,
  size = 36,
  background,
  color,
}: {
  user?: AvatarUser | null;
  theme?: Partial<Theme>;
  size?: number;
  /** Override the circle's fill (a colour or gradient) behind the initial. */
  background?: string;
  color?: string;
}) => {
  const src = user?.avatar_url || user?.avatarUrl || null;
  // The photo URL that failed to load, if any. A missing or unreadable
  // upload used to leave the browser's broken-image icon with the name
  // (in lowercase, as typed) printed over it; now it falls back to the
  // initial like everyone without a photo.
  const [failed, setFailed] = useState<string | null>(null);

  if (src && failed !== src) {
    return (
      <img
        src={src}
        alt={user?.name || ''}
        onError={() => setFailed(src)}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: background || theme?.accent || '#CFAE61',
        color: color || theme?.background || '#1B1F3B',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: size * 0.42,
        flexShrink: 0,
      }}
    >
      {initialFor(user)}
    </div>
  );
};

/**
 * The one letter drawn for someone without a photo: always a single
 * capital, whatever the server or the caller handed over.
 */
const initialFor = (user?: AvatarUser | null): string => {
  const source = (user?.initials || user?.name || '').trim();
  return source ? source[0].toUpperCase() : '?';
};


/**
 * "edited" — the little marker next to a comment or message that was
 * changed after it was posted.
 *
 * Deliberately quiet and deliberately always present when it applies. An
 * edit that leaves no trace lets someone change what they said after it
 * was replied to, which turns a conversation into an argument about what
 * was actually written.
 */
export const EditedMark = ({ editedAt, theme }: { editedAt?: string | null; theme?: Partial<Theme> }) => {
  if (!editedAt) return null;
  return (
    <span
      title={`Edited ${new Date(editedAt).toLocaleString()}`}
      style={{ fontSize: '11px', fontStyle: 'italic', color: (theme?.text || '#000') + '66' }}
    >
      (edited)
    </span>
  );
};

/**
 * Inline editing for a short piece of text you wrote — a comment, a
 * message.
 *
 * One component for all four places that let you write one (journal
 * comments, Sanctuary comments, library comments, Whispers messages), so
 * that "edit" looks and behaves the same everywhere instead of being
 * four slightly different affordances. The caller supplies `onSave`,
 * which does the PATCH and returns the saved text; everything else —
 * the textarea, Escape to cancel, Ctrl/Cmd+Enter to save, the in-flight
 * state and the error line — lives here.
 *
 * The original text is restored on cancel, and a failed save keeps the
 * editor open with what you typed still in it, rather than discarding
 * the correction along with the error.
 */
export const InlineEditor = ({
  value,
  theme,
  onSave,
  onCancel,
  placeholder = 'Edit your message…',
}: {
  value: string;
  theme?: Partial<Theme>;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
  placeholder?: string;
}) => {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const text = draft.trim();
    if (!text) {
      setError("This can't be empty. Delete it instead.");
      return;
    }
    if (text === value.trim()) {
      onCancel();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(text);
    } catch (problem) {
      // Whatever the caller's `onSave` threw. An Error carries a message
      // worth showing; anything else gets the generic line.
      setError(
        problem instanceof Error && problem.message
          ? problem.message
          : "Couldn't save that change. Try again.",
      );
      setSaving(false);
      return;
    }
    setSaving(false);
  };

  const buttonStyle = (primary: boolean) => ({
    padding: '5px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: saving ? 'default' : 'pointer',
    border: primary ? 'none' : `1px solid ${theme?.border || '#ccc'}`,
    background: primary ? theme?.accent || '#CFAE61' : 'transparent',
    color: primary ? theme?.background || '#fff' : (theme?.text || '#000') + 'aa',
    opacity: saving ? 0.6 : 1,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <textarea
        autoFocus
        value={draft}
        disabled={saving}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
        }}
        rows={3}
        style={{
          width: '100%',
          background: theme?.background || '#fff',
          color: theme?.text || '#000',
          border: `1px solid ${theme?.border || '#ccc'}`,
          borderRadius: '10px',
          padding: '10px',
          fontSize: '14px',
          fontFamily: 'inherit',
          resize: 'vertical',
        }}
      />
      {error && <div style={{ color: '#ff6b6b', fontSize: '12px' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button onClick={save} disabled={saving} style={buttonStyle(true)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} disabled={saving} style={buttonStyle(false)}>
          Cancel
        </button>
        <span style={{ fontSize: '11px', color: (theme?.text || '#000') + '55' }}>
          Esc to cancel
        </span>
      </div>
    </div>
  );
};

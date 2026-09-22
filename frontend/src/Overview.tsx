/**
 * The dashboard overview.
 *
 * Two stats were already real. Two were not — "Insights Gained" was
 * counting insight cards (close enough) and "Community Posts" was the
 * string '0' with a comment explaining that Community didn't exist. Both
 * now come from the same stats endpoint as the others.
 *
 * "Recent Reflections" was three invented entries — a conversation with
 * Mom, a meditation session, a walk by the lake — shown identically to
 * every user, including one who had never written anything. It now shows
 * the person's own last three entries, and nothing at all when there
 * aren't any.
 *
 * The rest of the screen was placeholder until later still: it greeted
 * everyone as "Alex" with a 23-day streak, showed 62% of a daily goal,
 * coloured the "Past 14 Days" grid with Math.random(), plotted a mood
 * trend from a hardcoded array, attributed a famous misquotation to
 * Emerson, and had a mood picker whose selection went nowhere. All of it
 * now comes from `GET /insights/dashboard/`, and every button does
 * something.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, get, post } from './api';
import type { Theme } from './theme';
import type { JournalEntry, JournalStats, Paginated } from './types';

interface OverviewProps {
  theme: Theme;
  darkMode: boolean;
  isMobile: boolean;
  setActiveTab?: (tab: string) => void;
  /** Open the journal composer with this prompt already added. */
  onWriteWithPrompt?: (prompt: string) => void;
}

/** One day on the 14-day grid or the weekly trend. `score` is 1–5. */
interface DayMood {
  date: string;
  mood: string | null;
  score: number | null;
  count: number;
}

/** `GET /insights/dashboard/` — see backend/insights/dashboard.py. */
interface DashboardSummary {
  firstName: string;
  streakDays: number;
  today: {
    entries: number;
    goal: number;
    checkin: { mood: string; note: string; createdAt: string } | null;
  };
  week: { entries: number; goal: number; days: DayMood[] };
  last14: DayMood[];
  timeTip: string | null;
  highlight: { category: string; text: string } | null;
  /** Settings → Daily Inspiration. */
  showQuote: boolean;
}

/** The four tiles this screen shows — a subset of the stats endpoint. */
type OverviewStats = Pick<
  JournalStats,
  'total_entries' | 'current_streak_days' | 'insights_gained' | 'community_posts'
>;

/** One row of "Recent Reflections", derived from a journal entry. */
interface RecentEntry {
  id: number;
  date: string;
  mood: string;
  preview: string;
  tags: string[];
}

const MOOD_EMOJI: Record<string, string> = {
  Happy: '😊', Sad: '😢', Angry: '😠', Excited: '🤩', Anxious: '😰',
  Calm: '😌', Frustrated: '😤', Content: '🙂', Lonely: '😔',
  Grateful: '🙏', Stressed: '😣', Hopeful: '🌱',
};

/**
 * The six moods offered for a quick check-in on this screen.
 *
 * Taken from the app's real twelve (the same list MoodCheckin and the
 * server use), so a quick check-in is an ordinary check-in. The old
 * picker offered Calm / Neutral / Tense / Energized, three of which the
 * server doesn't accept — which is why selecting one never did anything.
 * "More moods" opens the full check-in with all twelve.
 */
const QUICK_MOODS = ['Happy', 'Calm', 'Grateful', 'Anxious', 'Stressed', 'Sad'];

/**
 * A small rotation of well-attributed lines, one per day.
 *
 * The quote that was here — "What lies behind us and what lies before us
 * are tiny matters…" — is one of the best-known misattributions in
 * circulation: it isn't Emerson's. Everything below is from a primary
 * source whose authorship isn't in dispute.
 */
const QUOTES = [
  { text: 'Fill your paper with the breathings of your heart.', author: 'William Wordsworth' },
  { text: 'The soul becomes dyed with the colour of its thoughts.', author: 'Marcus Aurelius' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', author: 'Marcus Aurelius' },
  { text: 'The unexamined life is not worth living.', author: 'Socrates, in Plato\'s Apology' },
  { text: 'Well begun is half done.', author: 'Aristotle' },
  { text: 'No man ever steps in the same river twice.', author: 'Heraclitus' },
];

/** Prompts for "Prompt of the Day" and "More Prompts", rotated daily. */
const PROMPTS = [
  { category: 'Awareness', text: 'What emotion is visiting me right now, and what is it asking for?' },
  { category: 'Gratitude', text: "Name three small wins I'm overlooking." },
  { category: 'Growth', text: 'If I repeat today for 100 days, where will I land?' },
  { category: 'Kindness', text: 'What would I say to a friend who had the day I just had?' },
  { category: 'Clarity', text: 'What is one thing I can let go of this week?' },
  { category: 'Joy', text: 'When did I feel most like myself today?' },
  { category: 'Courage', text: 'What am I avoiding, and what is the smallest first step toward it?' },
];

/** Day of the year, so the quote and prompts change daily but stay put all day. */
function dayIndex(): number {
  const now = new Date();
  return Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function relativeStamp(iso: string): string {
  const then = new Date(iso);
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago, ${time}`;
  return `${then.toLocaleDateString()}, ${time}`;
}

function Overview( {theme, darkMode, isMobile, setActiveTab, onWriteWithPrompt}: OverviewProps ) {

  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  // Quick check-in: nothing is selected until the user picks, and only
  // one mood can be selected at a time.
  const [pickedMood, setPickedMood] = useState<string | null>(null);
  const [moodNote, setMoodNote] = useState('');
  const [savingMood, setSavingMood] = useState(false);
  const [moodError, setMoodError] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);

  const quote = QUOTES[dayIndex() % QUOTES.length];
  const promptOfDay = PROMPTS[dayIndex() % PROMPTS.length];
  const morePrompts = [1, 2].map((offset) => PROMPTS[(dayIndex() + offset) % PROMPTS.length]);

  const writeWith = (prompt: string) => {
    if (onWriteWithPrompt) onWriteWithPrompt(prompt);
    else setActiveTab?.('Log');
  };

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await get<DashboardSummary>('/insights/dashboard/'));
    } catch {
      // The hero falls back to a plain greeting; nothing here is worth
      // an error banner on the home screen.
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const saveCheckin = async () => {
    if (!pickedMood) return;
    setSavingMood(true);
    setMoodError('');
    try {
      await post('/mood/', {
        mood: pickedMood,
        description: moodNote.trim(),
        intensity: 5,
      });
      setJustSaved(pickedMood);
      setPickedMood(null);
      setMoodNote('');
      await loadSummary();
    } catch (err) {
      setMoodError(err instanceof ApiError ? err.message : "Couldn't save that. Try again.");
    } finally {
      setSavingMood(false);
    }
  };

  // The keyboard shortcuts printed on the "Start Your Entry" buttons.
  // They were drawn but never listened for. Ignored while typing, so a
  // "t" in the mood note doesn't open the composer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === 'm') setActiveTab?.('MoodCheckin');
      else if (key === 'v' || key === 't' || key === 'p') setActiveTab?.('Log');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setActiveTab]);

  const todayGoal = summary?.today.goal ?? 1;
  const todayDone = Math.min(summary?.today.entries ?? 0, todayGoal);
  const todayPercent = Math.round((todayDone / todayGoal) * 100);
  const RING = 226; // circumference of the r=36 progress ring
  const weekGoal = summary?.week.goal ?? 5;
  const weekEntries = summary?.week.entries ?? 0;
  const todayIso = new Date().toISOString().slice(0, 10);

  /** Colour for a day's mood score, from muted (hard) to gold (good). */
  const moodColour = (score: number | null) => {
    if (score === null) return theme.border;
    if (score >= 4.5) return theme.accent;
    if (score >= 3.5) return theme.accent + 'B3';
    if (score >= 2.5) return theme.secondary + 'B3';
    if (score >= 1.5) return theme.secondary + '80';
    return theme.secondary + '4D';
  };

  // Real numbers from the backend (spec §17 — these must not be hardcoded).
  const [stats, setStats] = useState<OverviewStats>({
    total_entries: 0,
    current_streak_days: 0,
    insights_gained: 0,
    community_posts: 0,
  });
  const [recentEntries, setRecentEntries] = useState<RecentEntry[]>([]);

  const load = useCallback(async () => {
    try {
      // The journal list is paginated, so this asks for exactly the
      // three entries it shows rather than pulling the whole journal
      // across the wire to slice three off the front.
      const [statsData, page] = await Promise.all([
        get<JournalStats>('/journal/stats/'),
        get<Paginated<JournalEntry>>('/journal/?limit=3'),
      ]);

      setStats(statsData);
      setRecentEntries(
        (page.entries || []).map((entry) => ({
          id: entry.id,
          date: relativeStamp(entry.created_at),
          mood: MOOD_EMOJI[entry.mood] || '📝',
          preview: (entry.content || '').slice(0, 120) + ((entry.content || '').length > 120 ? '…' : ''),
          tags: entry.tags || [],
        })),
      );
    } catch {
      // Stats staying at 0 is an honest empty state, not a broken UI —
      // no error banner needed for a background stats fetch.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
        {/* Main Content */}
        <main className="flex flex-col gap-[0.75rem] px-[0.75rem] py-[0.75rem]" style={{ maxWidth: '1400px', margin: '0 auto'}}>
          
          {/* CLUSTER 1: Hero Section - Motivation */}
          <section>
            <div style={{
              background: `linear-gradient(135deg, ${theme.accent}15, ${theme.secondary}15)`,
              borderRadius: '2rem',
              padding: '2.5rem',
              border: `1px solid ${theme.border}`,
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Decorative elements */}
              <div style={{ position: 'absolute', top: '1rem', right: '1rem', fontSize: '2rem', opacity: 0.3 }}>✨</div>
              <div style={{ position: 'absolute', bottom: '1rem', left: '1rem', fontSize: '1.5rem', opacity: 0.2 }}>🌙</div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ 
                  fontSize: 'clamp(1.5rem, 4vw, 2.5rem)', 
                  fontWeight: '700', 
                  color: theme.text, 
                  margin: 0,
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  {summary ? `${greeting()}, ${summary.firstName}!` : `${greeting()}!`} 👋
                </h2>
                {/* Streak badge — the real streak, and an invitation rather
                    than a "0 day streak" when there isn't one. */}
                {summary && (
                <div
                  title="Consecutive days with a journal entry or a mood check-in"
                  style={{
                  background: theme.accent,
                  color: theme.background,
                  padding: '0.5rem 1rem',
                  borderRadius: '2rem',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  {summary.streakDays > 0
                    ? `🔥 ${summary.streakDays} day streak`
                    : '🌱 Start a streak today'}
                </div>
                )}
              </div>

              {/* Quote of the day, unless switched off in Settings. */}
              {(summary?.showQuote ?? true) && (
              <>
              {/* Inspiration Quote */}
              <blockquote style={{ 
                fontSize: '1.1rem', 
                color: theme.text, 
                fontStyle: 'italic', 
                margin: '0 0 1rem 0',
                fontFamily: "'Merriweather', serif",
                lineHeight: 1.6,
                maxWidth: '600px',
                marginLeft: 'auto',
                marginRight: 'auto'
              }}>
                "{quote.text}"
              </blockquote>
              <cite style={{ 
                fontSize: '0.85rem', 
                color: theme.secondary, 
                fontWeight: '500'
              }}>
                — {quote.author}
              </cite>
              </>
              )}

              {/* A tip only when this person's own writing supports one. */}
              {summary?.timeTip && (
                <div style={{
                  marginTop: '1.5rem',
                  padding: '1rem',
                  background: theme.surface + '80',
                  borderRadius: '1rem',
                  fontSize: '0.9rem',
                  color: theme.text,
                  opacity: 0.8,
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  💡 {summary.timeTip}
                </div>
              )}

              {/* Write-about-this button. It used to say "Save to Wisdom
                  Vault", a feature that has never existed, and did nothing. */}
              {(summary?.showQuote ?? true) && <button style={{
                position: 'absolute',
                top: '1rem',
                left: '1rem',
                background: 'none',
                border: 'none',
                fontSize: '1.2rem',
                cursor: 'pointer',
                opacity: 0.7,
                transition: 'opacity 0.3s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}
              onClick={() => writeWith(`Reflecting on: "${quote.text}" — ${quote.author}`)}
              aria-label="Write about this quote"
              title="Write about this quote">
                ✍️
              </button>}
            </div>
          </section>

          {/* CLUSTER 3: Mood Check + Today's Goal */}
          <section>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: '0.75rem'
            }}>
              {/* Mood Check with Heatmap */}
              <div style={{
                background: theme.surface,
                borderRadius: '1.5rem',
                padding: '2rem',
                boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
                border: `1px solid ${theme.border}`
              }}>
                <h3 style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: theme.text, 
                  marginBottom: '1.5rem',
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  How are you feeling? 🎭
                </h3>
                
                {/* Today's check-in, when there is one. */}
                {(justSaved || summary?.today.checkin) && (
                  <div style={{
                    marginTop: '-0.75rem',
                    marginBottom: '1rem',
                    fontSize: '0.85rem',
                    color: theme.secondary,
                    fontFamily: "'Poppins', sans-serif",
                  }}>
                    {justSaved
                      ? `Saved — feeling ${justSaved.toLowerCase()} ${MOOD_EMOJI[justSaved] || ''}`
                      : `Today you checked in feeling ${summary?.today.checkin?.mood.toLowerCase()} ${MOOD_EMOJI[summary?.today.checkin?.mood || ''] || ''}`}
                    {' · '}
                    <button
                      onClick={() => writeWith(`I'm feeling ${(justSaved || summary?.today.checkin?.mood || '').toLowerCase()} today. What's behind it?`)}
                      style={{ background: 'none', border: 'none', padding: 0, color: theme.accent, cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}
                    >
                      Write about it →
                    </button>
                  </div>
                )}

                {/* Quick moods. Nothing is selected until you pick, only one
                    can be selected, and picking one does nothing on its own
                    — "Save check-in" below is what records it. */}
                <div
                  role="radiogroup"
                  aria-label="How are you feeling?"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.6rem', marginBottom: '1rem' }}
                >
                  {QUICK_MOODS.map((mood) => {
                    const selected = pickedMood === mood;
                    return (
                      <button
                        key={mood}
                        role="radio"
                        aria-checked={selected}
                        onClick={() => { setPickedMood(selected ? null : mood); setJustSaved(null); setMoodError(''); }}
                        style={{
                          background: selected ? theme.accent + '20' : theme.background,
                          border: `2px solid ${selected ? theme.accent : theme.border}`,
                          borderRadius: '1rem',
                          padding: '0.75rem 0.5rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: '0.35rem',
                        }}
                        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.borderColor = theme.accent + '80'; }}
                        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.borderColor = theme.border; }}
                      >
                        <span style={{ fontSize: '1.4rem' }}>{MOOD_EMOJI[mood]}</span>
                        <span style={{
                          fontSize: '0.75rem',
                          fontWeight: 500,
                          color: selected ? theme.accent : theme.text,
                          fontFamily: "'Poppins', sans-serif",
                        }}>
                          {mood}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setActiveTab?.('MoodCheckin')}
                  style={{ background: 'none', border: 'none', padding: 0, color: theme.secondary, cursor: 'pointer', fontSize: '0.8rem', marginBottom: '1rem' }}
                >
                  More moods, and how strongly →
                </button>

                {/* The note and the save button appear once a mood is picked,
                    so the next step is never a guess. */}
                {pickedMood && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.5rem' }}>
                    <input
                      type="text"
                      value={moodNote}
                      onChange={(e) => setMoodNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveCheckin(); }}
                      placeholder="Add a quick note (optional)"
                      maxLength={500}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        border: `1px solid ${theme.border}`,
                        borderRadius: '0.75rem',
                        background: theme.background,
                        color: theme.text,
                        fontSize: '0.9rem',
                        fontFamily: "'Poppins', sans-serif",
                        boxSizing: 'border-box'
                      }}
                    />
                    <button
                      onClick={saveCheckin}
                      disabled={savingMood}
                      style={{
                        background: theme.accent,
                        color: theme.background,
                        border: 'none',
                        borderRadius: '0.75rem',
                        padding: '0.7rem',
                        fontWeight: 600,
                        cursor: savingMood ? 'default' : 'pointer',
                        opacity: savingMood ? 0.7 : 1,
                        fontFamily: "'Poppins', sans-serif",
                      }}
                    >
                      {savingMood ? 'Saving…' : `Save check-in: ${pickedMood} ${MOOD_EMOJI[pickedMood] || ''}`}
                    </button>
                    {moodError && <div style={{ color: theme.error, fontSize: '0.8rem' }}>{moodError}</div>}
                  </div>
                )}

                {/* The last 14 days, from real check-ins and entries. A day
                    with nothing logged is an empty square, not a guess. */}
                <div>
                  <h4 style={{ 
                    fontSize: '0.9rem', 
                    fontWeight: '600', 
                    color: theme.text, 
                    marginBottom: '0.75rem',
                    fontFamily: "'Poppins', sans-serif"
                  }}>
                    Past 14 Days
                  </h4>
                  {/* Two rows of seven — one per week — so the grid never
                      wraps into an odd 13 + 1 on a phone. */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 18px)', gap: '6px', justifyContent: 'center' }}>
                    {(summary?.last14 ?? []).map((day) => (
                      <div
                        key={day.date}
                        role="img"
                        aria-label={`${shortDate(day.date)}: ${day.mood ?? 'nothing logged'}`}
                        title={`${shortDate(day.date)} — ${day.mood ? `${day.mood}${day.count > 1 ? ` (+${day.count - 1} more)` : ''}` : 'nothing logged'}`}
                        style={{
                          width: '18px',
                          height: '18px',
                          borderRadius: '4px',
                          background: moodColour(day.score),
                          outline: day.date === todayIso ? `1px solid ${theme.text}66` : 'none',
                          outlineOffset: '1px',
                          transition: 'transform 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                      />
                    ))}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: theme.text, opacity: 0.55, marginTop: '0.5rem' }}>
                    Brighter squares are better days. Hover a square to see the mood.
                  </div>
                </div>
              </div>

              {/* Today's Goal Tracker */}
              <div style={{
                background: theme.surface,
                borderRadius: '1.5rem',
                padding: '2rem',
                boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
                border: `1px solid ${theme.border}`,
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTab?.('Log')}
              onKeyDown={(e) => { if (e.key === 'Enter') setActiveTab?.('Log'); }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                <h3 style={{ 
                  fontSize: '1.3rem', 
                  fontWeight: '600', 
                  color: theme.text, 
                  marginBottom: '1.5rem',
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  Today's Goal 🎯
                </h3>

                {/* Progress Ring */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', marginBottom: '1.5rem' }}>
                  <div style={{ position: 'relative', width: '80px', height: '80px' }}>
                    <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke={theme.border}
                        strokeWidth="6"
                        fill="none"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="36"
                        stroke={theme.accent}
                        strokeWidth="6"
                        fill="none"
                        strokeDasharray={RING}
                        strokeDashoffset={RING - (RING * todayPercent) / 100}
                        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                      />
                    </svg>
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '50%',
                      transform: 'translate(-50%, -50%)',
                      fontSize: '1.2rem',
                      fontWeight: '700',
                      color: theme.accent,
                      fontFamily: "'Poppins', sans-serif"
                    }}>
                      {todayPercent}%
                    </div>
                  </div>
                  <div>
                    <div style={{ 
                      fontSize: '1.1rem', 
                      fontWeight: '600', 
                      color: theme.text,
                      marginBottom: '0.5rem',
                      fontFamily: "'Poppins', sans-serif"
                    }}>
                      Reflection Progress
                    </div>
                    <div style={{ 
                      fontSize: '0.9rem', 
                      color: theme.text, 
                      opacity: 0.7 
                    }}>
                      {todayDone} of {todayGoal} {todayGoal === 1 ? 'entry' : 'entries'} today
                    </div>
                  </div>
                </div>

                {/* Tips to reach goal */}
                <div style={{
                  background: theme.background,
                  borderRadius: '0.75rem',
                  padding: '1rem',
                  fontSize: '0.85rem',
                  color: theme.text,
                  opacity: 0.8
                }}>
                  {todayDone >= todayGoal
                    ? '🎉 Goal reached for today. Anything more is a bonus.'
                    : '💡 Try a 5-minute reflection to reach your goal — tap here to start.'}
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.4rem' }}>
                    Change your goal in Settings → Journaling.
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* CLUSTER 3: Quick Entry Panel */}
          <section>
            <div style={{
              background: theme.surface,
              borderRadius: '1.5rem',
              padding: '0.5rem',
              boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
              border: `1px solid ${theme.border}`
            }}>
              {/* Prompt of the Day */}
              <div style={{
                background: `linear-gradient(135deg, ${theme.secondary}15, ${theme.accent}15)`,
                borderRadius: '1rem',
                padding: '1.5rem',
                marginBottom: '2rem',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
              role="button"
              tabIndex={0}
              onClick={() => writeWith(promptOfDay.text)}
              onKeyDown={(e) => { if (e.key === 'Enter') writeWith(promptOfDay.text); }}
              onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>💭</span>
                  <h4 style={{ 
                    fontSize: '1.1rem', 
                    fontWeight: '600', 
                    color: theme.text, 
                    margin: 0,
                    fontFamily: "'Poppins', sans-serif"
                  }}>
                    Prompt of the Day
                  </h4>
                </div>
                <p style={{
                  fontSize: '1rem',
                  color: theme.text,
                  fontStyle: 'italic',
                  margin: 0,
                  fontFamily: "'Merriweather', serif",
                  lineHeight: 1.5
                }}>
                  "{promptOfDay.text}"
                </p>
                <div style={{
                  fontSize: '0.8rem',
                  color: theme.secondary,
                  marginTop: '0.5rem',
                  fontWeight: '500'
                }}>
                  Click to start writing with this prompt →
                </div>
              </div>

              {/* Quick Entry Options */}
              <h3 style={{ 
                fontSize: '1.3rem', 
                fontWeight: '600', 
                color: theme.text, 
                marginBottom: '1.5rem',
                fontFamily: "'Poppins', sans-serif"
              }}>
                Start Your Entry ✨
              </h3>

              <div style={{ 
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: '0.5rem'
              }}>
                {[
                  { title: 'Voice Note', icon: '🎙️', desc: 'Record your thoughts', shortcut: 'V' },
                  { title: 'Text Entry', icon: '📝', desc: 'Write it down', shortcut: 'T' },
                  { title: 'Photo Memory', icon: '📸', desc: 'Capture the moment', shortcut: 'P' },
                  { title: 'Mood Check', desc: 'Log feelings', icon: '💭', shortcut: 'M' },
                ].map((option, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      // All four are real now. Voice Note and Photo
                      // Memory open the composer, whose Voice and Photo
                      // controls record and attach for real — the gap
                      // these two used to apologise for is closed.
                      if (option.title === 'Mood Check') setActiveTab?.('MoodCheckin');
                      else setActiveTab?.('Log');
                    }}
                    style={{
                      background: theme.background,
                      border: `2px solid ${theme.border}`,
                      borderRadius: '1.25rem',
                      padding: '1.5rem',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '1rem',
                      position: 'relative',
                      textAlign: 'center'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = theme.accent + '10';
                      e.currentTarget.style.borderColor = theme.accent;
                      e.currentTarget.style.transform = 'translateY(-4px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = theme.background;
                      e.currentTarget.style.borderColor = theme.border;
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {/* Keyboard Shortcut */}
                    <div style={{
                      position: 'absolute',
                      top: '0.75rem',
                      right: '0.75rem',
                      background: theme.border,
                      color: theme.text,
                      width: '1.5rem',
                      height: '1.5rem',
                      borderRadius: '0.375rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.7rem',
                      fontWeight: '600'
                    }}>
                      {option.shortcut}
                    </div>

                    <span style={{ fontSize: '2.5rem' }}>{option.icon}</span>
                    <div>
                      <div style={{ 
                        fontSize: '1.1rem', 
                        fontWeight: '600', 
                        color: theme.text,
                        marginBottom: '0.25rem',
                        fontFamily: "'Poppins', sans-serif"
                      }}>
                        {option.title}
                      </div>
                      <div style={{ 
                        fontSize: '0.85rem', 
                        color: theme.text, 
                        opacity: 0.7 
                      }}>
                        {option.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* CLUSTER 4: Quick Stats Overview (Clickable) */}
          <section>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.5rem',
            }}>
              {[
                { label: 'Total Entries', value: String(stats.total_entries), icon: '📝', color: '#FF6B6B' },
                { label: 'Current Streak', value: String(stats.current_streak_days), icon: '🔥', color: '#4ECDC4' },
                { label: 'Insights Gained', value: String(stats.insights_gained), icon: '💡', color: '#FFD93D' },
                { label: 'Community Posts', value: String(stats.community_posts), icon: '👥', color: '#6BCF7F' }
              ].map((stat, index) => (
                <button
                  key={index}
                  onClick={() => {
                    if (stat.label === 'Total Entries' || stat.label === 'Current Streak') setActiveTab?.('Journal');
                    else if (stat.label === 'Insights Gained') setActiveTab?.('Insights');
                    else setActiveTab?.('Community');
                  }}
                  style={{
                  background: theme.surface,
                  borderRadius: '1rem',
                  padding: '1rem',
                  boxShadow: darkMode ? 'none' : '0 4px 20px rgba(0,0,0,0.08)',
                  border: `1px solid ${theme.border}`,
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = `0 8px 30px ${stat.color}20`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = darkMode ? 'none' : '0 4px 20px rgba(0,0,0,0.08)';
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{
                      width: '3rem',
                      height: '3rem',
                      borderRadius: '1rem',
                      background: stat.color + '20',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.25rem'
                    }}>
                      {stat.icon}
                    </div>
                    <div>
                      <div style={{ 
                        fontSize: '2rem', 
                        fontWeight: '700', 
                        color: stat.color,
                        fontFamily: "'Poppins', sans-serif"
                      }}>
                        {stat.value}
                      </div>
                      <div style={{ 
                        fontSize: '0.85rem', 
                        color: theme.text, 
                        opacity: 0.7,
                        fontWeight: '500'
                      }}>
                        {stat.label}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* CLUSTER 5: Content Grid - Recent Entries + Weekly Overview */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 2fr) minmax(0, 1fr)',
            gap: '0.75rem'
          }}>
            {/* Recent Entries */}
            <section style={{
              background: theme.surface,
              borderRadius: '1.5rem',
              padding: '0.75rem',
              boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
              border: `1px solid ${theme.border}`
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: '1rem' 
              }}>
                <h3 style={{ 
                  fontSize: '1.2rem', 
                  fontWeight: '600', 
                  color: theme.text, 
                  margin: 0,
                  fontFamily: "'Poppins', sans-serif"
                }}>
                  Recent Reflections 📖
                </h3>
                <button style={{
                  background: theme.secondary,
                  color: 'white',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '2rem',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onClick={() => setActiveTab?.('Journal')}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}>
                  View All
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {recentEntries.length === 0 && (
                  <div style={{
                    padding: '2rem 1.5rem',
                    background: theme.cardBg,
                    borderRadius: '1rem',
                    border: `1px solid ${theme.border}`,
                    color: theme.text,
                    opacity: 0.7,
                    textAlign: 'center',
                  }}>
                    Nothing written yet. Your entries will appear here.
                  </div>
                )}
                {recentEntries.map((entry) => (
                  <div key={entry.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveTab?.('Journal')}
                  onKeyDown={(e) => { if (e.key === 'Enter') setActiveTab?.('Journal'); }}
                  style={{
                    padding: '1.5rem',
                    background: theme.cardBg,
                    borderRadius: '1rem',
                    border: `1px solid ${theme.border}`,
                    transition: 'all 0.3s ease',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'translateX(8px)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'translateX(0)'}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '1rem', 
                      marginBottom: '1rem' 
                    }}>
                      <span style={{ fontSize: '1.5rem' }}>{entry.mood}</span>
                      <span style={{ 
                        fontSize: '0.85rem', 
                        color: theme.secondary, 
                        fontWeight: '500' 
                      }}>
                        {entry.date}
                      </span>
                    </div>
                    <p style={{ 
                      color: theme.text, 
                      lineHeight: 1.6, 
                      margin: '0 0 1rem 0',
                      fontFamily: "'Merriweather', serif",
                      textAlign: 'left'
                    }}>
                      {entry.preview}
                    </p>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                      {entry.tags.map((tag, tagIndex) => (
                        <span key={tagIndex} style={{
                          background: theme.accent + '20',
                          color: theme.accent,
                          padding: '0.25rem 0.75rem',
                          borderRadius: '1rem',
                          fontSize: '0.75rem',
                          fontWeight: '500'
                        }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <button
                    onClick={(e) => { e.stopPropagation(); setActiveTab?.('Insights'); }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: theme.secondary,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontFamily: "'Poppins', sans-serif"
                    }}>
                      🔍 See your patterns in Insights
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Weekly Overview Sidebar */}
            <aside style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* Combined Weekly Overview */}
              <div style={{
                background: theme.surface,
                borderRadius: '1.5rem',
                padding: '1.5rem',
                boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
                border: `1px solid ${theme.border}`
              }}>
                <h4 style={{ 
                  fontSize: '1.2rem', 
                  fontWeight: '600', 
                  color: theme.text, 
                  marginBottom: '1.5rem',
                  fontFamily: "'Poppins', sans-serif",
                }}>
                  Weekly Overview 📊
                </h4>
                
                {/* Weekly Goal Progress */}
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '0.75rem'
                  }}>
                    <span style={{ 
                      fontSize: '0.9rem', 
                      color: theme.text, 
                      fontWeight: '500'
                    }}>
                      Entries this week
                    </span>
                    <span style={{ 
                      fontSize: '0.9rem', 
                      color: theme.accent, 
                      fontWeight: '600'
                    }}>
                      {weekEntries} of {weekGoal}
                    </span>
                  </div>
                  <div style={{
                    background: theme.border,
                    height: '6px',
                    borderRadius: '1rem',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      background: theme.secondary,
                      height: '100%',
                      width: `${Math.min(100, Math.round((weekEntries / weekGoal) * 100))}%`,
                      borderRadius: '1rem',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>

                {/* Mood Line Graph */}
                <div style={{ marginBottom: '2rem' }}>
                  <h5 style={{ 
                    fontSize: '0.95rem', 
                    fontWeight: '600', 
                    color: theme.text, 
                    marginBottom: '1rem',
                    fontFamily: "'Poppins', sans-serif"
                  }}>
                    Mood Trend
                  </h5>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'end',
                    height: '60px',
                    marginBottom: '0.5rem'
                  }}>
                    {(summary?.week.days ?? []).map((day) => {
                      const future = day.date > todayIso;
                      return (
                        <div
                          key={day.date}
                          title={`${shortDate(day.date)} — ${future ? 'still to come' : day.mood ?? 'nothing logged'}`}
                          style={{
                            width: '8px',
                            // A day with no mood logged is a short stub, not
                            // a made-up bar; a day still to come is fainter.
                            height: `${day.score ? day.score * 12 : 4}px`,
                            background: day.score
                              ? `linear-gradient(to top, ${theme.secondary}, ${theme.accent})`
                              : theme.border,
                            opacity: future ? 0.35 : 1,
                            borderRadius: '4px',
                            transition: 'all 0.3s ease'
                          }}
                        />
                      );
                    })}
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    fontSize: '0.7rem', 
                    color: theme.text, 
                    opacity: 0.6
                  }}>
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
                      <span key={index}>{day}</span>
                    ))}
                  </div>
                </div>

                {/* Weekly Insight */}
                <div style={{
                  background: `linear-gradient(135deg, ${theme.accent}10, ${theme.secondary}10)`,
                  borderRadius: '1rem',
                  padding: '1rem'
                }}>
                  <div style={{ 
                    fontSize: '0.85rem', 
                    fontWeight: '600', 
                    color: theme.text,
                    marginBottom: '0.5rem',
                    fontFamily: "'Poppins', sans-serif"
                  }}>
                    💡 {summary?.highlight?.category ?? 'Insight'}
                  </div>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: theme.text,
                    fontStyle: 'italic',
                    lineHeight: 1.4
                  }}>
                    {summary?.highlight
                      ? summary.highlight.text
                      : 'Insights appear here once you have a few entries and check-ins for the engine to read. Nothing is guessed.'}
                  </div>
                  {summary?.highlight && (
                    <button
                      onClick={() => setActiveTab?.('Insights')}
                      style={{ background: 'none', border: 'none', padding: 0, marginTop: '0.5rem', color: theme.secondary, cursor: 'pointer', fontSize: '0.75rem', textDecoration: 'underline' }}
                    >
                      See all insights →
                    </button>
                  )}
                </div>
              </div>

              {/* Guided Prompts (Compact) */}
              <div style={{
                background: theme.surface,
                borderRadius: '1.5rem',
                padding: '1.5rem',
                boxShadow: darkMode ? 'none' : '0 8px 32px rgba(0,0,0,0.08)',
                border: `1px solid ${theme.border}`
              }}>
                <h4 style={{ 
                  fontSize: '1.1rem', 
                  fontWeight: '600', 
                  color: theme.text, 
                  marginBottom: '1rem',
                  fontFamily: "'Poppins', sans-serif",
                }}>
                  More Prompts 💭
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {morePrompts.map((prompt, index) => ({
                    category: prompt.category,
                    text: prompt.text,
                    prompt: `"${prompt.text}"`,
                    color: index === 0 ? '#4ECDC4' : '#FFD93D',
                  })).map((item) => (
                    <button
                      key={item.text}
                      onClick={() => writeWith(item.text)}
                      style={{
                        background: theme.background,
                        border: `1px solid ${theme.border}`,
                        borderRadius: '0.75rem',
                        padding: '1rem',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        textAlign: 'left',
                        width: '100%'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = item.color + '10';
                        e.currentTarget.style.borderColor = item.color + '40';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = theme.background;
                        e.currentTarget.style.borderColor = theme.border;
                      }}
                    >
                      <div style={{
                        fontSize: '0.7rem',
                        fontWeight: '600',
                        color: item.color,
                        marginBottom: '0.25rem',
                        fontFamily: "'Poppins', sans-serif",
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px'
                      }}>
                        {item.category}
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        color: theme.text,
                        lineHeight: 1.3,
                        fontFamily: "'Merriweather', serif",
                        fontStyle: 'italic'
                      }}>
                        {item.prompt}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </main>
    </>
  )
}

export default Overview

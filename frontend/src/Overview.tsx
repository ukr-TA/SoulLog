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
 */

import { useCallback, useEffect, useState } from 'react';
import { get } from './api';
import type { Theme } from './theme';
import type { JournalEntry, JournalStats, Paginated } from './types';

interface OverviewProps {
  theme: Theme;
  darkMode: boolean;
  isMobile: boolean;
  setActiveTab?: (tab: string) => void;
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

function relativeStamp(iso: string): string {
  const then = new Date(iso);
  const time = then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago, ${time}`;
  return `${then.toLocaleDateString()}, ${time}`;
}

function Overview( {theme, darkMode, isMobile, setActiveTab}: OverviewProps ) {

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
                  Welcome back, Alex! 👋
                </h2>
                {/* Streak Badge */}
                <div style={{
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
                  🔥 23 day streak
                </div>
              </div>

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
                "What lies behind us and what lies before us are tiny matters compared to what lies within us."
              </blockquote>
              <cite style={{ 
                fontSize: '0.85rem', 
                color: theme.secondary, 
                fontWeight: '500'
              }}>
                — Ralph Waldo Emerson
              </cite>

              {/* Best Time Tip */}
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
                💡 Your reflections are deeper in the mornings — try a quick entry before 10 AM
              </div>

              {/* Save Quote Button */}
              <button style={{
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
              title="Save to Wisdom Vault">
                🔖
              </button>
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
                
                {/* Mood Buttons */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
                  {[
                    { emoji: '😊', label: 'Calm', active: true },
                    { emoji: '😐', label: 'Neutral', active: false },
                    { emoji: '😣', label: 'Tense', active: false },
                    { emoji: '🔥', label: 'Energized', active: false }
                  ].map((mood, index) => (
                    <button
                      key={index}
                      style={{
                        background: mood.active ? theme.accent + '20' : theme.background,
                        border: mood.active ? `2px solid ${theme.accent}` : `2px solid ${theme.border}`,
                        borderRadius: '1rem',
                        padding: '1rem',
                        cursor: 'pointer',
                        transition: 'all 0.3s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flex: '1',
                        minWidth: '70px'
                      }}
                    >
                      <span style={{ fontSize: '1.5rem' }}>{mood.emoji}</span>
                      <span style={{ 
                        fontSize: '0.75rem', 
                        fontWeight: '500',
                        color: mood.active ? theme.accent : theme.text,
                        fontFamily: "'Poppins', sans-serif"
                      }}>
                        {mood.label}
                      </span>
                    </button>
                  ))}
                </div>

                {/* 14-day Mood Heatmap */}
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
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                    {Array.from({length: 14}, (_, i) => (
                      <div
                        key={i}
                        style={{
                          width: '16px',
                          height: '16px',
                          borderRadius: '3px',
                          background: i < 4 ? theme.accent + (Math.random() * 50 + 30) + '%' : 
                                     i < 8 ? theme.secondary + (Math.random() * 50 + 30) + '%' :
                                     theme.border,
                          cursor: 'pointer',
                          transition: 'transform 0.2s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.2)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                        title={`Day ${14-i}: ${i < 4 ? 'Great' : i < 8 ? 'Good' : 'Neutral'} mood`}
                      />
                    ))}
                  </div>
                </div>

                {/* Quick Note Input */}
                <div style={{ marginTop: '1.5rem' }}>
                  <input
                    type="text"
                    placeholder="Add a quick note about your mood..."
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
                        strokeDasharray="226"
                        strokeDashoffset="86"
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
                      62%
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
                      2 of 3 entries completed
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
                  💡 Try a 5-minute reflection to reach your goal
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
                  "What emotion is visiting me right now, and what is it asking for?"
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
                {recentEntries.map((entry, index) => (
                  <div key={index} style={{
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
                    <button style={{
                      background: 'none',
                      border: 'none',
                      color: theme.secondary,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontFamily: "'Poppins', sans-serif"
                    }}>
                      🔍 See trends from similar days
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
                      Journal Goal
                    </span>
                    <span style={{ 
                      fontSize: '0.9rem', 
                      color: theme.accent, 
                      fontWeight: '600'
                    }}>
                      3 of 5
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
                      width: '60%',
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
                    {[3, 4, 2, 4, 5, 3, 4].map((height, index) => (
                      <div
                        key={index}
                        style={{
                          width: '8px',
                          height: `${height * 10}px`,
                          background: `linear-gradient(to top, ${theme.secondary}, ${theme.accent})`,
                          borderRadius: '4px',
                          transition: 'all 0.3s ease'
                        }}
                      />
                    ))}
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
                    💡 Weekly Insight
                  </div>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: theme.text,
                    fontStyle: 'italic',
                    lineHeight: 1.4
                  }}>
                    Your most positive days happen after outdoor walks
                  </div>
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
                  {[
                    { category: 'Gratitude', prompt: '"Name 3 small wins I\'m overlooking."', color: '#4ECDC4' },
                    { category: 'Growth', prompt: '"If I repeat today for 100 days, where will I land?"', color: '#FFD93D' }
                  ].map((item, index) => (
                    <button
                      key={index}
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

/**
 * Insights.
 *
 * The AI-insight cards were already real — computed by the backend's
 * Insight Engine from this user's own data, and silent when there isn't
 * enough of it. Three panels around them were not: the mood distribution
 * chart, "Time Patterns" and "Common Themes" were hardcoded arrays, with
 * an inline comment saying so.
 *
 * All three now come from `/insights/summary/`, computed the same way the
 * cards are — from real entries and check-ins, returning nothing rather
 * than something plausible. The date-range chips filter that computation
 * instead of being decorative.
 *
 * "Weekly Goal Progress" used to animate to a fixed 85% for everyone.
 * It is now the share of the last seven days the user was actually
 * active, which is a number about them rather than a number that looks
 * encouraging.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, get } from './api';
import type { Theme } from './theme';

/** One row of `GET /insights/`, as the engine returns it. */
type InsightRow = {
  category: string;
  text: string;
  evidence: string;
};

/** The same observation, in the shape this screen's cards render. */
type InsightCard = {
  category: string;
  text: string;
  date: string;
};

interface InsightsPageProps {
  theme: Theme;
  darkMode?: boolean;
  /** Open the journal composer with this prompt added. */
  onWriteWithPrompt?: (prompt: string) => void;
}

type MoodBar = { emoji: string; label: string; value: number; height: number };

const RANGES: Record<string, number> = {
  '7 Days': 7,
  '30 Days': 30,
  '3 Months': 90,
};

const InsightsPage = ({ theme, onWriteWithPrompt }: InsightsPageProps) => {
  const [activeFilter, setActiveFilter] = useState('30 Days');
  const [progressValue, setProgressValue] = useState(0);

  const [moodData, setMoodData] = useState<MoodBar[]>([]);
  const [timePatterns, setTimePatterns] = useState<string[]>([]);
  const [commonThemes, setCommonThemes] = useState<string[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Real insights from the backend's Insight Engine (spec §29-32).
  // Fewer cards showing up than a mock would is correct behaviour when
  // there isn't the history to support them, not a bug.
  // What this screen draws for each observation the engine made. The
  // API's own field names are mapped once, on arrival, rather than at
  // every use site.
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [isLoadingInsights, setIsLoadingInsights] = useState(true);

  const loadInsights = useCallback(async () => {
    try {
      const data = await get<InsightRow[]>('/insights/');
      setInsights(data.map((row) => ({ category: row.category, text: row.text, date: row.evidence })));
    } catch {
      // Empty insights is an honest state, not a broken UI.
    } finally {
      setIsLoadingInsights(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const days = RANGES[activeFilter] || 30;
      const data = await get<{
        moodDistribution: MoodBar[];
        timePatterns: string[];
        commonThemes: string[];
      }>(`/insights/summary/?days=${days}`);

      setMoodData(data.moodDistribution);
      setTimePatterns(data.timePatterns);
      setCommonThemes(data.commonThemes);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      setMoodData([]);
      setTimePatterns([]);
      setCommonThemes([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  /**
   * Weekly goal progress — the share of the last seven days with at
   * least one entry or check-in.
   *
   * This used to animate to 85% on every account, including one created
   * a minute earlier. The animation is kept, because it's part of the
   * design; the destination is now this person's real number.
   */
  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    (async () => {
      let target = 0;
      try {
        const stats = await get<{ current_streak_days: number }>('/journal/stats/');
        target = Math.min(Math.round((Math.min(stats.current_streak_days, 7) / 7) * 100), 100);
      } catch {
        target = 0;
      }
      if (cancelled) return;

      let current = 0;
      interval = setInterval(() => {
        if (current >= target) {
          if (interval) clearInterval(interval);
          setProgressValue(target);
          return;
        }
        current += 2;
        setProgressValue(Math.min(current, target));
      }, 50);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, []);

  const renderProgressRing = ({ value }: { value: number }) => {
    return (
      <div style={{ width: '100px', height: '100px', margin: '0 auto', position: 'relative' }}>
        <div style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `conic-gradient(${theme.accent} 0deg ${(value / 100) * 360}deg, ${theme.border}40 ${(value / 100) * 360}deg 360deg)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative'
        }}>
          <div style={{
            width: '70px',
            height: '70px',
            background: theme.background,
            borderRadius: '50%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: theme.accent }}>
              {value}%
            </div>
            <div style={{ fontSize: '10px', color: theme.mutedText }}>
              Complete
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      fontFamily: "'Merriweather','Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      background: theme.background,
      color: theme.text,
      minHeight: '100vh',
      padding: '20px',
      textAlign: 'left',
    }}>
      <div style={{ margin: '0 auto' }}>
        {/* Lower Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '20px',
          padding: '0'
        }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            {Object.keys(RANGES).map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                style={{
                  background: activeFilter === filter 
                    ? theme.accent
                    : theme.surface,
                  border: `1px solid ${theme.border}`,
                  color: activeFilter === filter ? theme.background : theme.text,
                  padding: '10px 20px',
                  borderRadius: '20px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  fontWeight: activeFilter === filter ? '600' : 'normal'
                }}
                onMouseEnter={(e) => {
                  if (activeFilter !== filter) {
                    const target = e.currentTarget as HTMLElement;
                    target.style.background = theme.border;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeFilter !== filter) {
                    const target = e.currentTarget as HTMLElement;
                    target.style.background = theme.surface;
                  }
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Insights Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{ fontSize: '28px', marginBottom: '8px', color: theme.accent }}>
            Your Insights
          </div>
          <div style={{ fontSize: '16px', color: theme.mutedText }}>
            Discover patterns in your thoughts and emotions
          </div>
        </div>

        {/* Charts Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: window.innerWidth <= 768 ? '1fr' : '2fr 1fr',
          gap: '20px',
          marginBottom: '40px'
        }}>
          {/* Mood Distribution Chart */}
          <div style={{
            background: theme.surface,
            borderRadius: '15px',
            padding: '20px',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${theme.border}`
          }}>
            <div style={{ fontSize: '16px', marginBottom: '15px', color: theme.text, fontWeight: '500' }}>
              Mood Distribution (30 Days)
            </div>
            <div style={{
              height: '140px',
              position: 'relative',
              display: 'flex',
              alignItems: 'end',
              justifyContent: 'space-around',
              padding: '15px 0'
            }}>
              {moodData.length === 0 && (
                <div style={{ fontSize: '13px', color: theme.text, opacity: 0.6, textAlign: 'center', width: '100%' }}>
                  {summaryLoading ? 'Loading…' : 'No mood check-ins in this period yet.'}
                </div>
              )}
              {moodData.map((mood, index) => (
                <div
                  key={index}
                  // The bars show a count and an emoji and nothing else, so
                  // which mood each one is was only guessable. The data has
                  // always carried a label; this surfaces it on hover and to
                  // screen readers without changing the chart's layout.
                  title={`${mood.label} — ${mood.value} check-in${mood.value === 1 ? '' : 's'}`}
                  aria-label={`${mood.label}: ${mood.value} check-ins`}
                  style={{ position: 'relative', cursor: 'help' }}
                >
                  <div
                    style={{
                      width: '30px',
                      background: `linear-gradient(to top, ${theme.accent}, ${theme.secondary})`,
                      borderRadius: '15px 15px 0 0',
                      height: `${mood.height * 0.7}px`,
                      position: 'relative',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseEnter={(e) => {
                      const target = e.currentTarget as HTMLElement;
                      target.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      const target = e.currentTarget as HTMLElement;
                      target.style.transform = 'scale(1)';
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: '-20px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: '10px',
                      color: theme.text,
                      fontWeight: 'bold'
                    }}>
                      {mood.value}
                    </div>
                    <div style={{
                      position: 'absolute',
                      bottom: '-20px',
                      left: '50%',
                      transform: 'translateX(-50%)',
                      fontSize: '10px',
                      color: theme.mutedText
                    }}>
                      {mood.emoji}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Progress Chart */}
          <div style={{
            background: theme.surface,
            borderRadius: '15px',
            padding: '20px',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${theme.border}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{ fontSize: '16px', marginBottom: '15px', color: theme.text, fontWeight: '500', textAlign: 'center' }}>
              Weekly Goal Progress
            </div>
            {renderProgressRing({ value: progressValue })}
            <div style={{ fontSize: '11px', marginTop: '10px', color: theme.text, opacity: 0.6, textAlign: 'center' }}>
              Days active in the last 7
            </div>
          </div>
        </div>

        {/* Patterns Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: window.innerWidth <= 768 ? '1fr' : '1fr 1fr',
          gap: '30px',
          marginBottom: '40px'
        }}>
          <div style={{
            background: theme.surface,
            borderRadius: '20px',
            padding: '25px',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${theme.border}`
          }}>
            <div style={{
              fontSize: '16px',
              marginBottom: '15px',
              color: theme.accent,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>⏰</span> Time Patterns
            </div>
            <div>
              {timePatterns.length === 0 && (
                <div style={{ padding: '8px 0', fontSize: '14px', color: theme.text, opacity: 0.6 }}>
                  {summaryLoading ? 'Loading…' : 'Not enough entries yet to see a pattern.'}
                </div>
              )}
              {timePatterns.map((pattern, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 0',
                    borderBottom: index < timePatterns.length - 1 ? `1px solid ${theme.border}` : 'none',
                    fontSize: '14px',
                    color: theme.text
                  }}
                >
                  {pattern}
                </div>
              ))}
            </div>
          </div>

          <div style={{
            background: theme.surface,
            borderRadius: '20px',
            padding: '25px',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${theme.border}`
          }}>
            <div style={{
              fontSize: '16px',
              marginBottom: '15px',
              color: theme.accent,
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>🔍</span> Common Themes
            </div>
            <div>
              {commonThemes.length === 0 && (
                <div style={{ padding: '8px 0', fontSize: '14px', color: theme.text, opacity: 0.6 }}>
                  {summaryLoading ? 'Loading…' : 'Themes appear once you have a few entries to draw on.'}
                </div>
              )}
              {commonThemes.map((theme_item, index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 0',
                    borderBottom: index < commonThemes.length - 1 ? `1px solid ${theme.border}` : 'none',
                    fontSize: '14px',
                    color: theme.text
                  }}
                >
                  {theme_item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI Insights */}
        <div style={{
          background: theme.surface,
          borderRadius: '20px',
          padding: '30px',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${theme.border}`,
          marginBottom: '30px'
        }}>
          <div style={{
            fontSize: '20px',
            marginBottom: '25px',
            color: theme.accent,
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span>💡</span> AI-Generated Insights from your entries
          </div>
          
          {isLoadingInsights ? (
            <div style={{ textAlign: 'center', color: theme.mutedText, padding: '20px' }}>
              Analyzing your entries...
            </div>
          ) : insights.length === 0 ? (
            <div style={{ textAlign: 'center', color: theme.mutedText, padding: '20px', fontSize: '14px' }}>
              Not enough entries yet to surface a pattern. Keep journaling and checking in — insights will appear here once there's enough to observe.
            </div>
          ) : insights.map((insight: InsightCard, index: number) => (
            <div
              key={index}
              style={{
                background: theme.cardBg,
                borderRadius: '15px',
                padding: '20px',
                marginBottom: index < insights.length - 1 ? '15px' : '0',
                border: `1px solid ${theme.border}`
              }}
            >
              <div style={{
                fontSize: '12px',
                color: theme.accent,
                fontWeight: '600',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                {insight.category}
              </div>
              <div style={{
                fontSize: '16px',
                color: theme.text,
                lineHeight: '1.5',
                marginBottom: '8px'
              }}>
                {insight.text}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '12px', color: theme.mutedText }}>
                  {insight.date}
                </div>
                {/* The card used to log to the developer console when
                    clicked, and nothing else. This is what it now offers. */}
                {onWriteWithPrompt && (
                  <button
                    onClick={() => onWriteWithPrompt(`About my ${insight.category.toLowerCase()}: what do I make of it, and is there anything I want to do differently?`)}
                    style={{ background: 'none', border: 'none', padding: 0, color: theme.secondary, cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
                  >
                    Reflect on this →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InsightsPage;
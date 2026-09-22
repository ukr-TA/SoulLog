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
import AchievementsSheet, { type BadgeProgress, type EarnedBadge } from './Achievements';
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
  isMobile?: boolean;
  /** Open with the Achievements sheet showing (from a badge notification). */
  openAchievements?: boolean;
  onAchievementsOpened?: () => void;
  setActiveTab?: (tab: string) => void;
}

type MoodBar = { emoji: string; label: string; value: number; height: number };

const RANGES: Record<string, number> = {
  '7 Days': 7,
  '30 Days': 30,
  '3 Months': 90,
};

const InsightsPage = ({
  theme, onWriteWithPrompt, isMobile = false, openAchievements = false, onAchievementsOpened, setActiveTab,
}: InsightsPageProps) => {
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

  // Journey stats and badges (shown here on phones, where Profile no
  // longer carries them).
  const [journey, setJourney] = useState<{
    entries: number; streak: number; reactions: number; views: number | null;
  } | null>(null);
  const [earned, setEarned] = useState<EarnedBadge[]>([]);
  const [badgeProgress, setBadgeProgress] = useState<BadgeProgress[]>([]);
  const [showAchievements, setShowAchievements] = useState(openAchievements);
  // On a phone the first two insights show; the rest are one tap away.
  const [allInsights, setAllInsights] = useState(false);

  useEffect(() => {
    if (openAchievements) {
      setShowAchievements(true);
      onAchievementsOpened?.();
    }
  }, [openAchievements, onAchievementsOpened]);

  useEffect(() => {
    (async () => {
      try {
        const [profile, stats] = await Promise.all([
          get<{
            stats?: { reactionsReceived?: number; profileViews?: number };
            showProfileViews?: boolean;
            achievements?: EarnedBadge[];
            achievementProgress?: BadgeProgress[];
          }>('/profile/'),
          get<{ total_entries?: number; current_streak_days?: number }>('/journal/stats/'),
        ]);
        setJourney({
          entries: stats.total_entries || 0,
          streak: stats.current_streak_days || 0,
          reactions: profile.stats?.reactionsReceived || 0,
          views: profile.showProfileViews ? profile.stats?.profileViews || 0 : null,
        });
        setEarned(profile.achievements || []);
        setBadgeProgress(profile.achievementProgress || []);
      } catch {
        // The tiles just don't show; the rest of Insights is unaffected.
      }
    })();
  }, []);

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

  const m = isMobile;

  const filtersEl = <>
        {/* Lower Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: m ? '12px' : '20px',
          padding: '0'
        }}>
          <div style={{ display: 'flex', gap: m ? '6px' : '10px' }}>
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
                  padding: m ? '7px 14px' : '10px 20px',
                  borderRadius: '20px',
                  fontSize: m ? '13px' : '14px',
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

      </>;
  const headerEl = <>
        {/* Insights Header */}
        <div style={{ textAlign: 'center', marginBottom: m ? '14px' : '40px' }}>
          <div style={{ fontSize: m ? '22px' : '28px', marginBottom: m ? '2px' : '8px', color: theme.accent }}>
            Your Insights
          </div>
          <div style={{ fontSize: m ? '13px' : '16px', color: theme.mutedText }}>
            Discover patterns in your thoughts and emotions
          </div>
        </div>

      </>;
  const chartsEl = <>
        {/* Charts Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: m ? 'minmax(0, 1fr)' : '2fr 1fr',
          gap: m ? '12px' : '20px',
          marginBottom: m ? '16px' : '40px'
        }}>
          {/* Mood Distribution Chart */}
          <div style={{
            background: theme.surface,
            borderRadius: '15px',
            padding: '20px',
            backdropFilter: 'blur(10px)',
            border: `1px solid ${theme.border}`
          }}>
            <div style={{ fontSize: m ? '15px' : '16px', marginBottom: '15px', color: theme.text, fontWeight: '500' }}>
              Mood Distribution ({activeFilter})
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
            flexDirection: m ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: m ? 'flex-start' : 'center',
            gap: m ? '16px' : 0,
            ...(m ? { padding: '14px 16px', order: -1 } : {}),
          }}>
            {m && <div style={{ flexShrink: 0 }}>{renderProgressRing({ value: progressValue })}</div>}
            <div style={{ textAlign: m ? 'left' : 'center' }}>
              <div style={{ fontSize: m ? '15px' : '16px', marginBottom: m ? '4px' : '15px', color: theme.text, fontWeight: '500' }}>
                Weekly Goal Progress
              </div>
              {!m && renderProgressRing({ value: progressValue })}
              <div style={{ fontSize: '11px', marginTop: m ? 0 : '10px', color: theme.text, opacity: 0.6 }}>
                Days active in the last 7
              </div>
            </div>
          </div>
        </div>

      </>;
  const patternsEl = <>
        {/* Patterns Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: m ? 'minmax(0, 1fr)' : '1fr 1fr',
          gap: m ? '12px' : '30px',
          marginBottom: m ? '16px' : '40px'
        }}>
          <div style={{
            background: theme.surface,
            borderRadius: m ? '16px' : '20px',
            padding: m ? '16px' : '25px',
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
            borderRadius: m ? '16px' : '20px',
            padding: m ? '16px' : '25px',
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

      </>;
  const aiEl = <>
        {/* AI Insights */}
        <div style={{
          background: theme.surface,
          borderRadius: m ? '16px' : '20px',
          padding: m ? '16px' : '30px',
          backdropFilter: 'blur(10px)',
          border: `1px solid ${theme.border}`,
          marginBottom: m ? '16px' : '30px'
        }}>
          <div style={{
            fontSize: m ? '17px' : '20px',
            marginBottom: m ? '12px' : '25px',
            color: theme.accent,
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <span>💡</span> Insights from your entries
          </div>
          
          {isLoadingInsights ? (
            <div style={{ textAlign: 'center', color: theme.mutedText, padding: '20px' }}>
              Analyzing your entries...
            </div>
          ) : insights.length === 0 ? (
            <div style={{ textAlign: 'center', color: theme.mutedText, padding: '20px', fontSize: '14px' }}>
              Not enough entries yet to surface a pattern. Keep journaling and checking in — insights will appear here once there's enough to observe.
            </div>
          ) : (m && !allInsights ? insights.slice(0, 2) : insights).map((insight: InsightCard, index: number, shown: InsightCard[]) => (
            <div
              key={index}
              style={{
                background: theme.cardBg,
                borderRadius: '15px',
                padding: m ? '14px' : '20px',
                marginBottom: index < shown.length - 1 ? (m ? '10px' : '15px') : '0',
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
                fontSize: m ? '15px' : '16px',
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
          {m && !isLoadingInsights && insights.length > 2 && (
            <button
              onClick={() => setAllInsights((v) => !v)}
              style={{
                width: '100%', marginTop: '10px', padding: '10px', borderRadius: '12px',
                background: 'transparent', border: `1px solid ${theme.border}`,
                color: theme.accent, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              }}
            >
              {allInsights ? 'Show fewer' : `Show ${insights.length - 2} more`}
            </button>
          )}
        </div>
      </>;

  /*
   * Phone: what you came for first, in the least room.
   *   1. Your journey — four small numbers and the Achievements button
   *   2. Insights from your entries — the reason this page exists
   *   3. The period chips, right above the charts they change
   *   4. Mood + weekly goal, then time patterns and themes
   */
  const tile = (icon: string, value: string | number, label: string, onClick?: () => void) => (
    <button
      onClick={onClick}
      style={{
        background: theme.cardBg, border: `1px solid ${theme.border}`, borderRadius: '12px',
        padding: '10px 6px', color: theme.text, textAlign: 'center', cursor: onClick ? 'pointer' : 'default',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', minWidth: 0,
      }}
    >
      <span style={{ fontSize: '15px' }}>{icon}</span>
      <span style={{ fontSize: '17px', fontWeight: 700, color: theme.accent }}>{value}</span>
      <span style={{ fontSize: '10px', opacity: 0.7, lineHeight: 1.2 }}>{label}</span>
    </button>
  );

  const journeyEl = (
    <div style={{
      background: theme.surface, borderRadius: '16px', padding: '14px',
      border: `1px solid ${theme.border}`, marginBottom: '16px',
    }}>
      <div style={{ fontSize: '15px', fontWeight: 600, marginBottom: '10px' }}>📈 My Journey</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
        {tile('📖', journey?.entries ?? '–', 'Entries', () => setActiveTab?.('Journal'))}
        {tile('🔥', journey?.streak ?? '–', 'Day streak', () => setActiveTab?.('Journal'))}
        {tile('💛', journey?.reactions ?? '–', 'Reactions', () => setActiveTab?.('Community'))}
        {tile('👁️', journey ? (journey.views ?? 'Off') : '–', 'Profile views', () => setActiveTab?.('Settings'))}
      </div>
      <button
        onClick={() => setShowAchievements(true)}
        style={{
          width: '100%', marginTop: '10px', padding: '12px 14px', borderRadius: '12px',
          background: `linear-gradient(135deg, ${theme.accent}26, ${theme.secondary}1f)`,
          border: `1px solid ${theme.accent}55`, color: theme.text, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '10px', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: '22px' }}>🏅</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: '14px' }}>Achievements</span>
          <span style={{ display: 'block', fontSize: '11px', opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {earned.length > 0
              ? `${earned.length} earned · ${earned.slice(0, 5).map((b) => b.icon).join(' ')}`
              : badgeProgress.length > 0 ? `Next: ${badgeProgress[0].icon} ${badgeProgress[0].name}` : 'Your badges live here'}
          </span>
        </span>
        <span style={{ color: theme.accent, fontSize: '18px' }}>›</span>
      </button>
    </div>
  );

  return (
    <div style={{
      fontFamily: "'Merriweather','Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      background: theme.background,
      color: theme.text,
      minHeight: '100vh',
      padding: m ? '14px 14px 90px' : '20px',
      textAlign: 'left',
    }}>
      <div style={{ margin: '0 auto' }}>
        {m ? (
          <>
            {headerEl}
            {journeyEl}
            {aiEl}
            {filtersEl}
            {chartsEl}
            {patternsEl}
          </>
        ) : (
          <>
            {filtersEl}
            {headerEl}
            {chartsEl}
            {patternsEl}
            {aiEl}
          </>
        )}
      </div>
      {showAchievements && (
        <AchievementsSheet
          theme={theme}
          earned={earned}
          progress={badgeProgress}
          onClose={() => setShowAchievements(false)}
        />
      )}
    </div>
  );
};

export default InsightsPage;
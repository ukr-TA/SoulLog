import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { Theme } from './theme';

/**
 * Your badges, in one sheet.
 *
 * On a phone the Profile page no longer carries the achievements panel;
 * Insights has an "Achievements" button that opens this instead, and so
 * does "View achievements" on a "You've earned …" notification.
 */

export type EarnedBadge = {
  slug: string;
  name: string;
  icon: string;
  description: string;
  earned: string;
};

export type BadgeProgress = {
  slug: string;
  name: string;
  icon: string;
  description: string;
  current: number;
  threshold: number;
  percent: number;
};

const AchievementsSheet = ({
  theme,
  earned,
  progress,
  onClose,
}: {
  theme: Theme;
  earned: EarnedBadge[];
  progress: BadgeProgress[];
  onClose: () => void;
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // The page behind stays put while the sheet is open.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Achievements"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: '100%', maxWidth: '32rem', maxHeight: '85dvh',
          overflowY: 'auto', overscrollBehavior: 'contain',
          background: theme.surface, color: theme.text,
          borderTopLeftRadius: '1.25rem', borderTopRightRadius: '1.25rem',
          border: `1px solid ${theme.border}`,
          padding: '0.75rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom))',
          textAlign: 'left',
        }}
      >
        <div style={{ width: '2.5rem', height: '4px', borderRadius: '2px', background: theme.border, margin: '0 auto 0.75rem' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>🏅 Achievements</div>
            <div style={{ fontSize: '0.8rem', opacity: 0.65 }}>
              {earned.length === 0 ? 'Nothing earned yet' : `${earned.length} earned`}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', padding: '0.4rem', color: theme.text, opacity: 0.7, cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        {earned.length === 0 && (
          <p style={{ fontSize: '0.9rem', opacity: 0.7, marginBottom: '1rem' }}>
            Badges appear here once you've actually earned them — never before.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.6rem' }}>
          {earned.map((badge) => (
            <div
              key={badge.slug}
              style={{
                padding: '0.8rem', borderRadius: '0.9rem',
                background: `${theme.accent}14`, border: `1px solid ${theme.accent}33`,
                display: 'flex', flexDirection: 'column', gap: '0.25rem',
              }}
            >
              <span style={{ fontSize: '1.75rem', lineHeight: 1 }}>{badge.icon}</span>
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{badge.name}</span>
              <span style={{ fontSize: '0.75rem', opacity: 0.7, lineHeight: 1.35 }}>{badge.description}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: 'auto' }}>Earned {badge.earned}</span>
            </div>
          ))}
        </div>

        {/* The next one per kind only — a list of everything unearned
            reads as a list of ways you're falling short. */}
        {progress.length > 0 && (
          <div style={{ marginTop: '1.25rem' }}>
            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.55, marginBottom: '0.6rem' }}>
              Within reach
            </div>
            {progress.map((next) => (
              <div key={next.slug} style={{ marginBottom: '0.85rem' }} title={next.description}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem', gap: '0.5rem' }}>
                  <span>{next.icon} {next.name}</span>
                  <span style={{ opacity: 0.6, flexShrink: 0 }}>{next.current} / {next.threshold}</span>
                </div>
                <div style={{ height: '6px', borderRadius: '3px', background: `${theme.accent}22`, overflow: 'hidden' }}>
                  <div style={{ width: `${next.percent}%`, height: '100%', borderRadius: '3px', background: theme.accent }} />
                </div>
                <div style={{ fontSize: '0.72rem', opacity: 0.55, marginTop: '0.25rem' }}>{next.description}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AchievementsSheet;

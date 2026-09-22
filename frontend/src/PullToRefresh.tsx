import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Theme } from './theme';

/**
 * Pull down from the top of a page to reload just that page's list.
 *
 * The browser's own pull-to-refresh is switched off (it reloaded the
 * whole app by accident), so this brings back the gesture people expect
 * on a phone — without leaving the app: only `onRefresh` runs.
 *
 * It only starts when the page is already scrolled to the very top and
 * the finger moves down, so ordinary scrolling is never hijacked.
 */
const TRIGGER = 70;   // px of pull that counts as "refresh"
const MAX = 110;      // how far the indicator can be dragged

const atTop = () => {
  if (window.scrollY > 0) return false;
  const scrollers = document.querySelectorAll<HTMLElement>('.main-content');
  return Array.from(scrollers).every((el) => el.scrollTop <= 0);
};

const PullToRefresh = ({
  theme,
  onRefresh,
  children,
}: {
  theme: Theme;
  onRefresh: () => Promise<unknown> | unknown;
  children: ReactNode;
}) => {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const busy = useRef(false);
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      if (busy.current || event.touches.length !== 1 || !atTop()) return;
      start.current = event.touches[0].clientY;
    };
    const onMove = (event: TouchEvent) => {
      if (start.current === null) return;
      const distance = event.touches[0].clientY - start.current;
      if (distance <= 0 || !atTop()) {
        start.current = distance < 0 ? null : start.current;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Resistance: the further you pull, the slower it follows.
      const eased = Math.min(MAX, distance * 0.5);
      pullRef.current = eased;
      setPull(eased);
      if (eased > 4 && event.cancelable) event.preventDefault();
    };
    const onEnd = async () => {
      if (start.current === null) return;
      start.current = null;
      const reached = pullRef.current >= TRIGGER * 0.8;
      pullRef.current = 0;
      if (!reached) {
        setPull(0);
        return;
      }
      busy.current = true;
      setRefreshing(true);
      setPull(48);
      try {
        await refreshRef.current();
      } finally {
        busy.current = false;
        setRefreshing(false);
        setPull(0);
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  const ready = pull >= TRIGGER * 0.8;
  const settling = !refreshing && pull === 0;

  return (
    <div>
      <div
        aria-live="polite"
        style={{
          height: pull,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          transition: settling ? 'height 0.25s ease' : 'none',
        }}
      >
        {pull > 0 && (
          <div
            style={{
              marginBottom: 8,
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke={theme.accent}
              strokeWidth="2.5"
              strokeLinecap="round"
              style={{
                transform: refreshing ? undefined : `rotate(${pull * 3}deg)`,
                animation: refreshing ? 'ptr-spin 0.8s linear infinite' : undefined,
                opacity: ready || refreshing ? 1 : 0.6,
              }}
              aria-label={refreshing ? 'Refreshing' : ready ? 'Release to refresh' : 'Pull to refresh'}
            >
              <path d="M21 12a9 9 0 1 1-3-6.7" />
              <path d="M21 4v5h-5" />
            </svg>
          </div>
        )}
      </div>
      <style>{'@keyframes ptr-spin { to { transform: rotate(360deg); } }'}</style>
      {children}
    </div>
  );
};

export default PullToRefresh;

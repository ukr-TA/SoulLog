/**
 * Back/Forward for an app whose screens live in React state.
 *
 * Every screen change — and every step inside a screen that feels like a
 * new page (a Settings section, a Community tab) — adds an entry to the
 * browser's history. Back (the button, the macOS swipe, Android's back
 * key) then walks back through what you actually looked at, one page at
 * a time, and Back from the first page leaves the app.
 *
 * An entry records the top-level screen (`tab`), optionally a page inside
 * it (`sub`), and how many SoulLog entries lie behind it (`depth`), so an
 * in-app back arrow knows whether there is anywhere to go back to.
 *
 * The Dashboard is always the bottom entry (depth 0). Reaching it by any
 * route rewinds the history to that entry rather than adding one, so Back
 * from the Dashboard always leaves the app — however you got there.
 */
export interface NavState {
  soullog: true;
  tab: string;
  sub?: string;
  depth: number;
}

/** The SoulLog entry the browser is on, or null if it isn't one of ours. */
export function navState(): NavState | null {
  const state = window.history.state as Partial<NavState> | null;
  return state && state.soullog ? (state as NavState) : null;
}

/** Record a new page. */
export function pushNav(tab: string, sub?: string) {
  const depth = (navState()?.depth ?? 0) + 1;
  window.history.pushState({ soullog: true, tab, sub, depth } satisfies NavState, '', window.location.href);
}

/** Describe the current entry without adding one (the very first page). */
export function replaceNav(tab: string, sub?: string, depth: number = navState()?.depth ?? 0) {
  window.history.replaceState({ soullog: true, tab, sub, depth } satisfies NavState, '', window.location.href);
}

/**
 * What an in-app back arrow should do: the same as the browser's Back
 * when there is a previous SoulLog page, and `fallback` when this is the
 * first one (so the arrow never takes you out of the app).
 */
export function goBack(fallback: () => void) {
  if ((navState()?.depth ?? 0) > 0) window.history.back();
  else fallback();
}

/**
 * Start a newly opened page at its top. Every screen shares the same
 * scrolling area, so without this a page opened after scrolling a long
 * one appeared already scrolled part-way down.
 */
export function scrollToTop() {
  window.scrollTo(0, 0);
  document.querySelectorAll<HTMLElement>('.main-content').forEach((el) => {
    el.scrollTop = 0;
  });
}

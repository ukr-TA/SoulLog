/**
 * Profile links that actually open the profile.
 *
 * "Share profile" on someone else's page used to copy a link of the form
 * `…/#/profile/<username>`, but nothing in the app ever read the part
 * after the `#`, so following the link just opened the home screen. The
 * Dashboard now reads it on load (after sign-in, if needed) and opens the
 * profile; both profile screens build their links here.
 *
 * Inside the installed phone app there is no web address worth sharing —
 * the app's own origin is `capacitor://localhost` — so there the share is
 * the @username instead, which is how people find each other in the app.
 */

import { Capacitor } from '@capacitor/core';

const PROFILE_HASH = /^#\/profile\/([^/?#]+)/;

export function profileShare(username: string, name?: string): { text: string; url?: string } {
  const who = name ? `${name} (@${username})` : `@${username}`;
  if (Capacitor.isNativePlatform()) {
    return { text: `Find ${who} on SoulLog` };
  }
  const base = `${window.location.origin}${window.location.pathname}`;
  return { text: `Find ${who} on SoulLog`, url: `${base}#/profile/${encodeURIComponent(username)}` };
}

/** The username in a profile link the app was opened with, if any. */
export function readProfileLink(): string | null {
  const match = window.location.hash.match(PROFILE_HASH);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Remove the link from the address bar once it has been followed. */
export function clearProfileLink() {
  if (PROFILE_HASH.test(window.location.hash)) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

/**
 * Share via the system share sheet where there is one, else the clipboard.
 * Returns what happened, so the screen can say so.
 */
export async function shareOrCopy(share: { text: string; url?: string }): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ title: 'SoulLog', text: share.text, url: share.url });
      return 'shared';
    }
    await navigator.clipboard.writeText(share.url ? `${share.text}: ${share.url}` : share.text);
    return 'copied';
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
    return 'failed';
  }
}

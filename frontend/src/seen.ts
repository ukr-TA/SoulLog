/**
 * Which friend requests you've already looked at.
 *
 * Badges in SoulLog count only what's new: a friend request shows a number
 * on Community, Souls and Requests until you've opened the Requests list,
 * then the number goes (the request itself stays in the list until you
 * answer it). "Looked at" is remembered on this device.
 */
const KEY = 'soullog.seenRequests';

export function seenRequests(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

export function markRequestsSeen(ids: number[]) {
  try {
    const all = seenRequests();
    ids.forEach((id) => all.add(id));
    // Only the most recent few hundred are worth remembering.
    localStorage.setItem(KEY, JSON.stringify([...all].slice(-500)));
  } catch {
    // Private mode or storage blocked: the badge just stays until answered.
  }
}

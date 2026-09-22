/**
 * Appearance settings that change the whole app, applied in one place.
 *
 * Settings → Appearance offered "Font Size" and "Dark Mode" and neither
 * did anything: the font size was saved to the server and never read,
 * and the dark-mode switch flipped a copy of the setting that lived only
 * inside the Settings screen. Both now go through here.
 */

import { Preferences } from '@capacitor/preferences';

export type FontSize = 'small' | 'medium' | 'large';

/**
 * The root font size for each choice. Tailwind sizes and every `rem` in
 * the app scale from this, so one change resizes the text throughout.
 */
const ROOT_PX: Record<FontSize, number> = { small: 14, medium: 16, large: 18 };

export function applyFontSize(size: string | undefined | null) {
  const px = ROOT_PX[(size as FontSize) || 'medium'] ?? ROOT_PX.medium;
  document.documentElement.style.fontSize = `${px}px`;
}

/** Persist the theme the same way the sidebar toggle always has. */
export async function saveThemePreference(dark: boolean) {
  await Preferences.set({ key: 'theme', value: dark ? 'dark' : 'light' });
}

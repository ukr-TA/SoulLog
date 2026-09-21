/**
 * Session and theme storage.
 *
 * Split out of `SoulLogApp.tsx` so that file exports only its component:
 * a module that exports both a component and plain functions defeats
 * React Fast Refresh, which then does a full page reload on every edit.
 *
 * `logOut` clears exactly the keys the sign-in flow writes. It does not
 * clear the stored theme — someone signing out has not changed their mind
 * about dark mode.
 */

import { Preferences } from '@capacitor/preferences';

export type ThemeName = 'dark' | 'light';

export const logOut = async () => {
  await Preferences.remove({ key: 'access_token' });
  await Preferences.remove({ key: 'refresh_token' });
  await Preferences.remove({ key: 'token_type' });
  await Preferences.remove({ key: 'expires_in' });
};

export const saveTheme = async (name: ThemeName) => {
  await Preferences.set({ key: 'theme', value: name });
};

export const loadTheme = async (): Promise<ThemeName> => {
  const { value } = await Preferences.get({ key: 'theme' });
  return value === 'light' || value === 'dark' ? (value as ThemeName) : 'dark';
};

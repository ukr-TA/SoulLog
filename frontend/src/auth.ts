/**
 * Signing in, shared by the sign-in and sign-up screens.
 *
 * Sign-up used to end with an alert() saying the account was created, then
 * send you to the sign-in screen to type the same username and password
 * again. It now signs you in directly with what you just chose.
 */

import { Preferences } from '@capacitor/preferences';

/** What `POST /auth/login` returns on success. */
interface LoginTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: string;
}

export const NETWORK_ERROR = "Couldn't reach SoulLog. Check your connection and try again.";

/**
 * Sign in and keep the session. Returns null on success, or a sentence
 * to show the person on failure.
 */
export async function signIn(username: string, password: string): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    return NETWORK_ERROR;
  }

  if (response.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (!response.ok) return 'Invalid username or password';

  const { access_token, refresh_token, token_type, expires_in }: LoginTokens = await response.json();
  await Preferences.set({ key: 'access_token', value: access_token });
  await Preferences.set({ key: 'refresh_token', value: refresh_token });
  await Preferences.set({ key: 'token_type', value: token_type });
  await Preferences.set({ key: 'expires_in', value: String(expires_in) });
  return null;
}

/**
 * The first readable message in a DRF error body — "That username is
 * already taken." rather than "Failed to create account".
 */
export function firstFieldError(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (typeof record.detail === 'string') return record.detail;
  for (const value of Object.values(record)) {
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * The one place the frontend talks to the backend.
 *
 * Before this existed, every screen repeated the same block: read the
 * token out of Capacitor Preferences, build an Authorization header,
 * check `response.ok`, and on a 401 clear storage and reload. That was
 * fine while three screens did it. With a dozen screens it becomes a
 * dozen places to fix the same bug, and — the real problem — a dozen
 * slightly different ideas of what a 401 means.
 *
 * What this module adds beyond tidiness:
 *
 *   Token refresh.  A 401 no longer means "log the user out". It means
 *                   "try the refresh token once, and only log out if that
 *                   fails too". Access tokens live 60 minutes; without
 *                   this, anyone who left the app open for an hour was
 *                   silently signed out mid-sentence.
 *
 *   One in-flight refresh. Ten screens polling at once used to mean ten
 *                   simultaneous refresh attempts, nine of which would
 *                   fail because the backend rotates refresh tokens. The
 *                   promise is shared so there is only ever one.
 *
 *   Honest errors.  `ApiError` carries the status and the parsed body, so
 *                   a form can show the field errors DRF returned instead
 *                   of a generic "something went wrong".
 */

import { Preferences } from '@capacitor/preferences';

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:8000/api/v1';

/**
 * Whatever the server sent back with an error.
 *
 * `unknown` rather than `any`: an error body is genuinely unknown —
 * a DRF field-error object, a `{detail}`, a string, or nothing at all —
 * and `unknown` forces the two readers below to check which, instead of
 * letting every caller assume.
 */
export type ErrorBody = unknown;

/** Anything that can be sent as a JSON request body. */
export type JsonBody =
  | string
  | number
  | boolean
  | null
  | JsonBody[]
  | { [key: string]: JsonBody };

export class ApiError extends Error {
  status: number;
  data: ErrorBody;

  constructor(status: number, data: ErrorBody, message?: string) {
    super(message || ApiError.messageFrom(status, data));
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }

  /** Pull something a person can read out of a DRF error body. */
  static messageFrom(status: number, data: ErrorBody): string {
    // A server crash page (HTML) is never shown to people as text.
    if (typeof data === 'string' && data && !/^\s*</.test(data)) return data;
    if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
    if (data && typeof data === 'object') {
      const body = data as Record<string, unknown>;
      if (typeof body.detail === 'string') return body.detail;
      const firstKey = Object.keys(body)[0];
      const firstValue = firstKey ? body[firstKey] : null;
      if (Array.isArray(firstValue) && firstValue.length) return String(firstValue[0]);
      if (typeof firstValue === 'string') return firstValue;
    }
    if (status === 0) return "Couldn't reach the server. Check your connection.";
    if (status === 403) return "You don't have permission to do that.";
    if (status === 404) return "That isn't available.";
    if (status >= 500) return 'Something went wrong on our end. Please try again.';
    return 'Something went wrong.';
  }

  /** Field errors for a form, when the backend returned any. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (this.data && typeof this.data === 'object' && !Array.isArray(this.data)) {
      for (const [key, value] of Object.entries(this.data)) {
        if (key === 'detail') continue;
        out[key] = Array.isArray(value) ? String(value[0]) : String(value);
      }
    }
    return out;
  }
}

// --- token storage ----------------------------------------------------------

export async function getAccessToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: 'access_token' });
  return value || null;
}

async function getRefreshToken(): Promise<string | null> {
  const { value } = await Preferences.get({ key: 'refresh_token' });
  return value || null;
}

export async function setTokens(access: string, refresh?: string) {
  await Preferences.set({ key: 'access_token', value: access });
  if (refresh) await Preferences.set({ key: 'refresh_token', value: refresh });
}

export async function clearTokens() {
  await Preferences.remove({ key: 'access_token' });
  await Preferences.remove({ key: 'refresh_token' });
  await Preferences.remove({ key: 'token_type' });
  await Preferences.remove({ key: 'expires_in' });
}

/**
 * Called when the session really is over — refresh failed, or there was
 * never a token. Reloading is blunt but correct: it drops every screen's
 * in-memory state at once, so nothing is left rendering data belonging to
 * a session that no longer exists.
 */
async function endSession() {
  await clearTokens();
  if (typeof window !== 'undefined') window.location.reload();
}

// Shared so concurrent 401s produce exactly one refresh attempt.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refresh = await getRefreshToken();
    if (!refresh) return null;

    try {
      const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      });
      if (!response.ok) return null;

      const data = await response.json();
      const access = data.access || data.access_token;
      if (!access) return null;

      // The backend rotates refresh tokens, so store the new one when
      // it sends one back — otherwise the next refresh fails.
      await setTokens(access, data.refresh || undefined);
      return access;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// --- the request function ---------------------------------------------------

type RequestOptions = {
  method?: string;
  body?: JsonBody;
  /** FormData for uploads — the Content-Type header is left to the browser
   *  so it can set the multipart boundary. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skip the Authorization header (login, register, password reset). */
  anonymous?: boolean;
  /** Return null instead of throwing on 404 — for "is this there?" reads. */
  allowMissing?: boolean;
};

export async function api<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (token && !options.anonymous) headers['Authorization'] = `Bearer ${token}`;

    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return fetch(url, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: options.signal,
    });
  };

  let token = options.anonymous ? null : await getAccessToken();
  let response: Response;

  try {
    response = await send(token);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(0, null);
  }

  if (response.status === 401 && !options.anonymous) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      token = refreshed;
      response = await send(token);
    }
    if (response.status === 401) {
      await endSession();
      throw new ApiError(401, null, 'Your session has expired.');
    }
  }

  if (response.status === 404 && options.allowMissing) return null as T;
  if (response.status === 204) return null as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) throw new ApiError(response.status, data);
  return data as T;
}

export const get = <T = unknown>(path: string, signal?: AbortSignal) =>
  api<T>(path, { method: 'GET', signal });

export const post = <T = unknown>(path: string, body?: JsonBody) =>
  api<T>(path, { method: 'POST', body });

export const patch = <T = unknown>(path: string, body?: JsonBody) =>
  api<T>(path, { method: 'PATCH', body });

export const del = <T = unknown>(path: string, body?: JsonBody) =>
  api<T>(path, { method: 'DELETE', body });

export const upload = <T = unknown>(path: string, formData: FormData, method = 'POST') =>
  api<T>(path, { method, formData });

// --- WebSockets -------------------------------------------------------------

/**
 * The live connection used by Whispers and the notification bell.
 *
 * Derives its URL from `API_BASE_URL` so a deployment that moves the API
 * doesn't need a second environment variable that can drift out of step
 * with the first.
 *
 * Reconnects with exponential backoff, and — deliberately — stops
 * retrying on close code 4401 (bad token) and 4403 (not allowed here).
 * Those are answers, not outages; retrying them forever would hammer the
 * server and never succeed.
 */
export function socketUrl(path: string, token: string): string {
  const base = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  // A relative API address ("/api/v1", used when the dev server forwards
  // the API — see vite.config.ts) means "this same site": build the socket
  // address from the page's own, with wss:// when the page is https://.
  const wsBase = /^https?:/.test(base)
    ? base.replace(/^http/, 'ws')
    : `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${base}`;
  const separator = path.includes('?') ? '&' : '?';
  return `${wsBase}${path}${separator}token=${encodeURIComponent(token)}`;
}

/** A frame in either direction on a SoulLog socket. */
export type SocketFrame = { type: string; data?: Record<string, unknown> } & Record<string, unknown>;

export type LiveSocket = {
  send: (payload: SocketFrame) => void;
  close: () => void;
};

export function openSocket(
  path: string,
  handlers: {
    onMessage?: (data: SocketFrame) => void;
    onOpen?: () => void;
    onClose?: (code: number) => void;
  } = {},
): LiveSocket {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    if (closedByUs) return;

    const token = await getAccessToken();
    if (!token) return;

    try {
      socket = new WebSocket(socketUrl(path, token));
    } catch {
      scheduleRetry();
      return;
    }

    socket.onopen = () => {
      attempt = 0;
      handlers.onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        handlers.onMessage?.(JSON.parse(event.data));
      } catch {
        // A frame we can't parse is not worth tearing the socket down for.
      }
    };

    socket.onclose = (event) => {
      handlers.onClose?.(event.code);
      if (closedByUs) return;
      // 4401 = token rejected, 4403 = not a participant. Both are final.
      if (event.code === 4401 || event.code === 4403) return;
      scheduleRetry();
    };

    socket.onerror = () => {
      // onclose always follows; retry logic lives there so it runs once.
    };
  };

  const scheduleRetry = () => {
    attempt += 1;
    const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
    retryTimer = setTimeout(connect, delay);
  };

  connect();

  return {
    send(payload: SocketFrame) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
      }
    },
    close() {
      closedByUs = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    },
  };
}

// --- shared types -----------------------------------------------------------

import type { ProfileStats } from './types';

export type PublicUser = {
  id: number;
  username: string;
  name: string;
  initials: string;
  avatar_url: string | null;
  presence: 'active' | 'away' | 'never' | 'hidden';
  presence_label: string | null;
  bio?: string;
  location?: string;
  interests?: string[];
  mentor_available?: boolean;
  mutual_connections?: number;
  relationship?: { state: string; direction: string | null; connection_id: number | null };
  is_following?: boolean;
  reason?: string;
  connection_id?: number;
  requested_at?: string;
  restricted?: boolean;
  /**
   * Used to be `Record<string, number>`, which typechecked every possible
   * misspelling. It is the real shape now, so `stats.reactionsRecieved`
   * is a compile error rather than a tile that shows nothing.
   */
  stats?: ProfileStats;
};

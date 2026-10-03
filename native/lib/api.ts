import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";

const TOKEN_KEY         = "mycloset_token";
const REFRESH_TOKEN_KEY = "mycloset_refresh_token";

// In-memory cache so every API call doesn't hit the Keychain/Keystore fresh.
let cachedToken:        string | null | undefined;
let cachedRefreshToken: string | null | undefined;

export async function saveToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function saveRefreshToken(token: string): Promise<void> {
  cachedRefreshToken = token;
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

export async function getRefreshToken(): Promise<string | null> {
  if (cachedRefreshToken !== undefined) return cachedRefreshToken;
  cachedRefreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  return cachedRefreshToken;
}

export async function clearRefreshToken(): Promise<void> {
  cachedRefreshToken = null;
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// Called when refresh fails — AuthContext registers this to sign the user out.
let onAuthExpired: (() => void) | null = null;
export function setAuthExpiredHandler(fn: () => void): void {
  onAuthExpired = fn;
}

// Prevent multiple simultaneous refresh attempts — share the in-flight promise.
let refreshPromise: Promise<string | null> | null = null;

async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { token: string; refreshToken: string };
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      return data.token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Thin wrapper around fetch that carries the Bearer token.
// On 401: attempts a silent token refresh and retries the request once.
// If refresh also fails, clears all auth state and fires onAuthExpired.
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status !== 401) return res;

  // 401 — try a silent refresh
  const newToken = await tryRefreshToken();
  if (!newToken) {
    // Refresh failed — session is dead
    await clearToken();
    await clearRefreshToken();
    onAuthExpired?.();
    return res;
  }

  // Retry with the new token
  const retryHeaders = new Headers(options.headers);
  retryHeaders.set("Authorization", `Bearer ${newToken}`);
  if (options.body && !isFormData && !retryHeaders.has("Content-Type")) retryHeaders.set("Content-Type", "application/json");
  return fetch(`${API_BASE_URL}${path}`, { ...options, headers: retryHeaders });
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json();
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

import { getCached, setCached, invalidateCached } from "./dataCache";

// Concurrent callers of the same path share ONE request instead of each firing their own —
// several tabs mount at once on launch and ask for the same data (e.g. /api/wardrobe/state from
// Closet and Wardrobe), and a cold cache used to mean one full round trip per caller.
const inFlight = new Map<string, Promise<unknown>>();

// Also forgets in-flight requests for the invalidated paths — a request that started BEFORE a
// mutation may return pre-mutation data, and must not be handed to a caller that asked after it.
export function invalidateCache(prefix?: string): void {
  invalidateCached(prefix);
  for (const k of [...inFlight.keys()]) if (!prefix || k.startsWith(prefix)) inFlight.delete(k);
}

const DEFAULT_TTL = 45_000;

export async function apiJsonCached<T>(path: string, ttl = DEFAULT_TTL): Promise<T> {
  const cached = getCached<T>(path, ttl);
  if (cached !== undefined) return cached;
  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;
  const req = apiJson<T>(path)
    // Only cache if this request wasn't invalidated mid-flight (see invalidateCache).
    .then(data => { if (inFlight.get(path) === req) setCached(path, data); return data; })
    .finally(() => { if (inFlight.get(path) === req) inFlight.delete(path); });
  inFlight.set(path, req);
  return req;
}

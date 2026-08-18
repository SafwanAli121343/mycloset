import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "./config";

const TOKEN_KEY = "mycloset_token";

// In-memory cache so every API call doesn't hit the Keychain/Keystore fresh — SecureStore reads
// are a real native-bridge round trip (tens of ms each), and since every single apiFetch call
// was reading it independently, that added up across a screen making several requests.
// undefined = not loaded yet (forces one real read); after that, always in sync via
// saveToken/clearToken.
let cachedToken: string | null | undefined;

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

// Thin wrapper around fetch that talks to the exact same API routes the website uses —
// same request/response shapes, same validation, same scoring/AI logic server-side. The only
// difference from the web client is how the session is carried: Bearer token here instead of
// an httpOnly cookie (see lib/auth/session.ts on the server for the matching Bearer support).
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getToken();
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // FormData bodies (file uploads) need fetch to set its own multipart boundary — forcing
  // application/json here would break the upload server-side.
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
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

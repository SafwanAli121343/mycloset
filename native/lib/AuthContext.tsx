import { createContext, useContext, useEffect, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import {
  apiJson, saveToken, clearToken, getToken,
  saveRefreshToken, clearRefreshToken, getRefreshToken,
  setAuthExpiredHandler, ApiError, invalidateCache,
} from "./api";

type AuthUser = { id: string; email: string } | null;

type AuthContextType = {
  user: AuthUser;
  isLoaded: boolean;
  isSignedIn: boolean;
  // True once a signed-in state is no longer just an optimistic guess from the on-device cache.
  // isLoaded/user flip immediately using the CACHED user so returning visits feel instant, but a
  // background /api/auth/me call right afterward can still find the session actually expired and
  // sign the user back out — until that round trip resolves, `isSignedIn` is a promise, not a
  // fact. App.tsx's ENTER gate waits for this specifically: showing ENTER on the strength of the
  // cache alone, then yanking it away the moment the background check disagreed, is what read as
  // "loading screen -> ENTER flashes -> log in screen" instead of going straight to the login
  // screen when a session genuinely isn't valid.
  sessionConfirmed: boolean;
  emailVerified: boolean;
  verificationRequired: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  verifyEmail: (code: string) => Promise<{ error?: string }>;
  resendVerification: () => Promise<{ error?: string }>;
  // Guest mode (App Store guideline 5.1.1(v)): use the app without registering. A guest is a real
  // account with no personal info (see the server's lib/auth/guest.ts); claimAccount attaches an
  // email + password to it later, keeping everything.
  isGuest: boolean;
  continueAsGuest: () => Promise<{ error?: string }>;
  claimAccount: (email: string, password: string) => Promise<{ error?: string }>;
};

const GUEST_EMAIL_DOMAIN = "guest.mycloset.invalid";
// The guest's generated sign-in, kept only in the device's secure storage so the guest closet
// survives an expired session (refresh tokens lapse after 30 days unused).
const GUEST_CREDS_KEY = "mc_guest_creds_v1";

const AuthContext = createContext<AuthContextType | null>(null);
const USER_CACHE_KEY = "mc_user_v1";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [sessionConfirmed, setSessionConfirmed] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [verificationRequired, setVerificationRequired] = useState(false);

  const applyVerification = useCallback((data: { emailVerified?: boolean; verificationRequired?: boolean } | null) => {
    setEmailVerified(data?.emailVerified ?? true);
    setVerificationRequired(data?.verificationRequired ?? false);
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort server-side logout (revokes refresh tokens in DB)
    getToken().then(token => {
      if (token) {
        fetch(`${require("./config").API_BASE_URL}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    });
    await clearToken();
    await clearRefreshToken();
    SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
    SecureStore.deleteItemAsync(GUEST_CREDS_KEY).catch(() => {});
    // The data cache persists to AsyncStorage across launches — without clearing it, the next
    // person to sign in on this device briefly saw the previous user's closet/calendar/scores.
    invalidateCache();
    setUser(null);
  }, []);

  useEffect(() => {
    // Register the handler so apiFetch can sign the user out when refresh fails
    setAuthExpiredHandler(() => {
      SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
      invalidateCache(); // same reason as signOut
      setUser(null);
    });
  }, []);

  // A guest whose session lapsed signs back in with the credentials stored at creation.
  const restoreGuest = useCallback(async () => {
    const raw = await SecureStore.getItemAsync(GUEST_CREDS_KEY).catch(() => null);
    if (!raw) return;
    try {
      const { email, password } = JSON.parse(raw) as { email: string; password: string };
      const data = await apiJson<{ id: string; email: string; token: string; refreshToken: string }>(
        "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      const u = { id: data.id, email: data.email };
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
      setUser(u);
    } catch { /* offline or account gone: stay signed out */ }
  }, []);

  useEffect(() => {
    async function init() {
      const token = await getToken();
      if (!token) {
        // Check for a refresh token — we might be able to silently restore the session
        const refreshToken = await getRefreshToken();
        if (!refreshToken) {
          await restoreGuest();
          setIsLoaded(true);
          setSessionConfirmed(true);
          return;
        }
        // Have a refresh token but no access token — try to get a new one silently
        try {
          const { API_BASE_URL } = require("./config");
          const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (res.ok) {
            const data = await res.json() as { token: string; refreshToken: string };
            await saveToken(data.token);
            await saveRefreshToken(data.refreshToken);
          } else {
            await clearRefreshToken();
            await restoreGuest();
            setIsLoaded(true);
            setSessionConfirmed(true);
            return;
          }
        } catch {
          setIsLoaded(true);
          setSessionConfirmed(true);
          return;
        }
      }

      // Token exists (or was just refreshed) — restore cached user immediately
      const cached = await SecureStore.getItemAsync(USER_CACHE_KEY).catch(() => null);
      if (cached) {
        try { setUser(JSON.parse(cached)); } catch {}
      }
      setIsLoaded(true);
      // Nothing cached to optimistically trust — there's no "confirm it wasn't a lie" step
      // needed, isSignedIn is already whatever the token/refresh flow above established.
      if (!cached) setSessionConfirmed(true);

      // Silently validate in background — apiFetch will auto-refresh if the JWT expired
      apiJson<AuthUser & { emailVerified?: boolean; verificationRequired?: boolean }>("/api/auth/me")
        .then(u => {
          setUser(u);
          applyVerification(u);
          if (u) SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
          setSessionConfirmed(true);
        })
        .catch((e) => {
          // apiFetch already attempted refresh; if we're still getting 401 here, session is dead
          if (e instanceof ApiError && e.status === 401) {
            clearToken();
            clearRefreshToken();
            setUser(null);
            SecureStore.deleteItemAsync(USER_CACHE_KEY).catch(() => {});
          }
          // Network errors: keep the cached session — it's the best available answer, and
          // there's nothing further to wait on offline.
          setSessionConfirmed(true);
        });
    }
    init();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const data = await apiJson<{ id: string; email: string; token: string; refreshToken: string; emailVerified?: boolean; verificationRequired?: boolean }>(
        "/api/auth/login",
        { method: "POST", body: JSON.stringify({ email, password }), signal: controller.signal }
      ).finally(() => clearTimeout(timeout));
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      const u = { id: data.id, email: data.email };
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
      setUser(u);
      applyVerification(data);
      return {};
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { error: "Request timed out. Check your connection and try again." };
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, [applyVerification]);

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const data = await apiJson<{ id: string; email: string; token: string; refreshToken: string; emailVerified?: boolean; verificationRequired?: boolean }>(
        "/api/auth/register",
        { method: "POST", body: JSON.stringify({ email, password }), signal: controller.signal }
      ).finally(() => clearTimeout(timeout));
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      const u = { id: data.id, email: data.email };
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
      setUser(u);
      applyVerification(data);
      return {};
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { error: "Request timed out. Check your connection and try again." };
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, [applyVerification]);

  const continueAsGuest = useCallback(async () => {
    try {
      const data = await apiJson<{ id: string; email: string; token: string; refreshToken: string; guestPassword: string }>(
        "/api/auth/guest", { method: "POST" });
      await SecureStore.setItemAsync(GUEST_CREDS_KEY, JSON.stringify({ email: data.email, password: data.guestPassword }));
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      const u = { id: data.id, email: data.email };
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
      setUser(u);
      applyVerification({ emailVerified: true, verificationRequired: false });
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, [applyVerification]);

  const claimAccount = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiJson<{ id: string; email: string; token: string; refreshToken: string; emailVerified?: boolean; verificationRequired?: boolean }>(
        "/api/auth/claim", { method: "POST", body: JSON.stringify({ email, password }) });
      await saveToken(data.token);
      await saveRefreshToken(data.refreshToken);
      SecureStore.deleteItemAsync(GUEST_CREDS_KEY).catch(() => {});
      const u = { id: data.id, email: data.email };
      SecureStore.setItemAsync(USER_CACHE_KEY, JSON.stringify(u)).catch(() => {});
      setUser(u);
      applyVerification(data);
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, [applyVerification]);

  const verifyEmail = useCallback(async (code: string) => {
    try {
      await apiJson("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ code }) });
      setEmailVerified(true);
      setVerificationRequired(false);
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, []);

  const resendVerification = useCallback(async () => {
    try {
      await apiJson("/api/auth/resend-verification", { method: "POST" });
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, isLoaded, isSignedIn: !!user, sessionConfirmed, emailVerified, verificationRequired,
      signIn, signUp, signOut, verifyEmail, resendVerification,
      isGuest: !!user?.email?.endsWith(`@${GUEST_EMAIL_DOMAIN}`), continueAsGuest, claimAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

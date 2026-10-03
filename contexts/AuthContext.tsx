"use client";
import { invalidateClientCache } from "@/lib/clientCache";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type AuthUser = { id: string; email: string } | null;

type AuthContextType = {
  user: AuthUser;
  isLoaded: boolean;
  isSignedIn: boolean;
  emailVerified: boolean;
  verificationRequired: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  verifyEmail: (code: string) => Promise<{ error?: string }>;
  resendVerification: () => Promise<{ error?: string }>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [emailVerified, setEmailVerified] = useState(true);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const router = useRouter();

  const applyVerification = useCallback((data: { emailVerified?: boolean; verificationRequired?: boolean }) => {
    setEmailVerified(data.emailVerified ?? true);
    setVerificationRequired(data.verificationRequired ?? false);
  }, []);

  const refreshMe = useCallback(async () => {
    const data = await fetch("/api/auth/me").then(r => r.json()).catch(() => null);
    setUser(data);
    if (data) applyVerification(data);
  }, [applyVerification]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => { setUser(data); if (data) applyVerification(data); setIsLoaded(true); })
      .catch(() => setIsLoaded(true));
  }, [applyVerification]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
    setUser(data);
    applyVerification(data);
    router.push(data.verificationRequired ? "/verify-email" : "/dashboard");
    return {};
  }, [router, applyVerification]);

  const signUp = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
    setUser(data);
    applyVerification(data);
    router.push("/dashboard");
    return {};
  }, [router, applyVerification]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // Per-user browser caches — left behind, the next person to sign in on this browser would
    // briefly see the previous user's calendar/wardrobe data before fresh data loaded.
    try {
      for (const key of Object.keys(localStorage)) {
        if (/^(outfits_cache_|outfit_setup_|wa_cache_|mycloset_userloc)/.test(key)) localStorage.removeItem(key);
      }
    } catch { /* storage unavailable */ }
    invalidateClientCache(); // in-memory page data too (lib/clientCache.ts)
    setUser(null);
    router.push("/");
  }, [router]);

  const verifyEmail = useCallback(async (code: string) => {
    const res = await fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
    setEmailVerified(true);
    setVerificationRequired(false);
    return {};
  }, []);

  const resendVerification = useCallback(async () => {
    const res = await fetch("/api/auth/resend-verification", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error ?? "Something went wrong. Please try again." };
    return {};
  }, []);

  return (
    <AuthContext.Provider value={{
      user, isLoaded, isSignedIn: !!user, emailVerified, verificationRequired,
      signIn, signUp, signOut, verifyEmail, resendVerification, refreshMe,
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

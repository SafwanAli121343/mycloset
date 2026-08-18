import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { apiJson, saveToken, clearToken, ApiError } from "./api";

type AuthUser = { id: string; email: string } | null;

type AuthContextType = {
  user: AuthUser;
  isLoaded: boolean;
  isSignedIn: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    apiJson<AuthUser>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoaded(true));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiJson<{ id: string; email: string; token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await saveToken(data.token);
      setUser({ id: data.id, email: data.email });
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiJson<{ id: string; email: string; token: string }>("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      await saveToken(data.token);
      setUser({ id: data.id, email: data.email });
      return {};
    } catch (e) {
      return { error: e instanceof ApiError ? e.message : "Something went wrong. Please try again." };
    }
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoaded, isSignedIn: !!user, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

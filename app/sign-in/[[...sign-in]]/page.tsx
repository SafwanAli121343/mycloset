"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

const FONT = { fontFamily: "Arial, sans-serif" };

export default function SignInPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await signIn(email, password);
    if (result.error) { setError(result.error); setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm" style={{ transform: "translateY(-8vh)" }}>
        <p className="text-2xl font-bold uppercase tracking-[0.04em] mb-10 text-center text-white" style={FONT}>
          LOG IN
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <label className="text-xs font-bold uppercase tracking-wide mb-1 text-neutral-400" style={FONT}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-neutral-700 bg-neutral-950 text-white px-3 py-3 text-sm mb-4 outline-none focus:border-neutral-400"
            style={FONT}
          />

          <label className="text-xs font-bold uppercase tracking-wide mb-1 text-neutral-400" style={FONT}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="border border-neutral-700 bg-neutral-950 text-white px-3 py-3 text-sm mb-6 outline-none focus:border-neutral-400"
            style={FONT}
          />

          {error && <p className="text-red-400 text-xs mb-4 uppercase tracking-wide" style={FONT}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-neutral-950 text-white font-bold uppercase text-sm border border-neutral-700 transition-colors duration-150 hover:bg-neutral-800 disabled:opacity-50 outline-none focus:outline-none"
            style={FONT}
          >
            {loading ? "LOGGING IN..." : "LOG IN"}
          </button>
        </form>

        <p className="text-xs text-center mt-6 uppercase tracking-wide text-neutral-500" style={FONT}>
          No account?{" "}
          <Link href="/sign-up" className="underline font-bold text-neutral-300">Create one</Link>
        </p>
      </div>
    </main>
  );
}

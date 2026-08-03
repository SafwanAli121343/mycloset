"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

const FONT = { fontFamily: "Arial, sans-serif" };

export default function SignUpPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    const result = await signUp(email, password);
    if (result.error) { setError(result.error); setLoading(false); }
  }

  return (
    <main className="min-h-screen bg-white flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm" style={{ transform: "translateY(-8vh)" }}>
        <p className="text-2xl font-bold uppercase tracking-[0.04em] mb-10 text-center" style={FONT}>
          CREATE AN ACCOUNT
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <label className="text-xs font-bold uppercase tracking-wide mb-1" style={FONT}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-black px-3 py-3 text-sm mb-4 outline-none focus:ring-1 focus:ring-black"
            style={FONT}
          />

          <label className="text-xs font-bold uppercase tracking-wide mb-1" style={FONT}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="border border-black px-3 py-3 text-sm mb-4 outline-none focus:ring-1 focus:ring-black"
            style={FONT}
          />

          <label className="text-xs font-bold uppercase tracking-wide mb-1" style={FONT}>Confirm Password</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            className="border border-black px-3 py-3 text-sm mb-6 outline-none focus:ring-1 focus:ring-black"
            style={FONT}
          />

          {error && <p className="text-red-600 text-xs mb-4 uppercase tracking-wide" style={FONT}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-white text-black font-bold uppercase text-sm border border-black transition-colors duration-150 hover:bg-black hover:text-white disabled:opacity-50"
            style={FONT}
          >
            {loading ? "CREATING ACCOUNT..." : "CREATE ACCOUNT"}
          </button>
        </form>

        <p className="text-xs text-center mt-6 uppercase tracking-wide text-gray-500" style={FONT}>
          By creating an account you agree to our{" "}
          <Link href="/terms" className="underline font-bold text-black">Terms of Service</Link>.
        </p>

        <p className="text-xs text-center mt-4 uppercase tracking-wide" style={FONT}>
          Already have an account?{" "}
          <Link href="/sign-in" className="underline font-bold">Log in</Link>
        </p>
      </div>
    </main>
  );
}

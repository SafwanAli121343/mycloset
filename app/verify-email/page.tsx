"use client";
import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Link from "next/link";

const FONT = { fontFamily: "Arial, sans-serif" };

export default function VerifyEmailPage() {
  const { verifyEmail, resendVerification, verificationRequired, signOut } = useAuth();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const result = await verifyEmail(code.trim());
    setLoading(false);
    if (result.error) { setError(result.error); return; }
    setDone(true);
  }

  async function handleResend() {
    setError("");
    setResent(false);
    const result = await resendVerification();
    if (result.error) setError(result.error);
    else setResent(true);
  }

  if (done) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4 center-lift">
        <p className="text-2xl font-bold uppercase tracking-[0.04em] text-white text-center" style={FONT}>
          Email verified.
        </p>
        <Link href="/dashboard" className="text-sm uppercase tracking-wide font-bold text-neutral-300 underline mt-6" style={FONT}>
          Continue
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4 center-lift">
      <div className="w-full max-w-sm" style={{ transform: "translateY(-8vh)" }}>
        <p className="text-2xl font-bold uppercase tracking-[0.04em] mb-4 text-center text-white" style={FONT}>
          Verify Your Email
        </p>
        {verificationRequired && (
          <p className="text-xs text-center mb-6 uppercase tracking-wide text-red-400" style={FONT}>
            You must verify your email to keep using this account.
          </p>
        )}
        <p className="text-xs text-center mb-8 uppercase tracking-wide text-neutral-500" style={FONT}>
          Enter the 6-digit code we emailed you.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            required
            placeholder="000000"
            className="border border-neutral-700 bg-neutral-950 text-white text-center text-2xl tracking-[0.4em] px-3 py-3 mb-4 outline-none focus:border-neutral-400"
            style={FONT}
          />

          {error && <p className="text-red-400 text-xs mb-4 uppercase tracking-wide text-center" style={FONT}>{error}</p>}
          {resent && !error && <p className="text-neutral-400 text-xs mb-4 uppercase tracking-wide text-center" style={FONT}>Code resent.</p>}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            className="w-full py-4 bg-neutral-950 text-white font-bold uppercase text-sm border border-neutral-700 transition-colors duration-150 hover:bg-neutral-800 disabled:opacity-50 outline-none focus:outline-none"
            style={FONT}
          >
            {loading ? "VERIFYING..." : "VERIFY"}
          </button>
        </form>

        <button
          onClick={handleResend}
          className="text-xs text-center mt-6 uppercase tracking-wide text-neutral-500 underline w-full"
          style={FONT}
        >
          Resend code
        </button>

        <button
          onClick={() => signOut()}
          className="text-xs text-center mt-4 uppercase tracking-wide text-neutral-600 underline w-full"
          style={FONT}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

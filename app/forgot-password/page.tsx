"use client";
import { useState } from "react";
import Link from "next/link";

const FONT = { fontFamily: "Arial, sans-serif" };
const INPUT_CLS = "border border-neutral-700 bg-neutral-950 text-white px-3 py-3 text-sm mb-4 outline-none focus:border-neutral-400";
const BUTTON_CLS = "w-full py-4 bg-neutral-950 text-white font-bold uppercase text-sm border border-neutral-700 transition-colors duration-150 hover:bg-neutral-800 disabled:opacity-50 outline-none focus:outline-none";
const LABEL_CLS = "text-xs font-bold uppercase tracking-wide mb-1 text-neutral-400";

type Step = "email" | "code" | "password" | "done";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setLoading(false);
    setStep("code");
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/auth/verify-reset-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: code.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); return; }
    setStep("password");
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code: code.trim(), newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); return; }
    setStep("done");
  }

  return (
    <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4 center-lift">
      <div className="w-full max-w-sm" style={{ transform: "translateY(-8vh)" }}>
        {step === "done" ? (
          <>
            <p className="text-2xl font-bold uppercase tracking-[0.04em] text-center text-white" style={FONT}>
              Password reset.
            </p>
            <Link href="/sign-in" className="text-xs text-center mt-6 uppercase tracking-wide text-neutral-400 underline block" style={FONT}>
              Return to log-in
            </Link>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold uppercase tracking-[0.04em] mb-10 text-center text-white" style={FONT}>
              Reset Password
            </p>

            {step === "email" && (
              <form onSubmit={submitEmail} className="flex flex-col">
                <label className={LABEL_CLS} style={FONT}>Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={INPUT_CLS} style={FONT} />
                {error && <p className="text-red-400 text-xs mb-4 uppercase tracking-wide" style={FONT}>{error}</p>}
                <button type="submit" disabled={loading} className={BUTTON_CLS} style={FONT}>
                  {loading ? "SENDING..." : "SEND CODE"}
                </button>
              </form>
            )}

            {step === "code" && (
              <form onSubmit={submitCode} className="flex flex-col">
                <p className="text-xs text-center mb-6 uppercase tracking-wide text-neutral-500" style={FONT}>
                  Enter the 6-digit code we sent to {email}.
                </p>
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
                <button type="submit" disabled={loading || code.length !== 6} className={BUTTON_CLS} style={FONT}>
                  {loading ? "CHECKING..." : "CONTINUE"}
                </button>
              </form>
            )}

            {step === "password" && (
              <form onSubmit={submitPassword} className="flex flex-col">
                <label className={LABEL_CLS} style={FONT}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} className={INPUT_CLS} style={FONT} />
                <label className={LABEL_CLS} style={FONT}>Confirm Password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className={INPUT_CLS} style={FONT} />
                {error && <p className="text-red-400 text-xs mb-4 uppercase tracking-wide" style={FONT}>{error}</p>}
                <button type="submit" disabled={loading} className={BUTTON_CLS} style={FONT}>
                  {loading ? "SAVING..." : "RESET PASSWORD"}
                </button>
              </form>
            )}

            <p className="text-xs text-center mt-6 uppercase tracking-wide text-neutral-500" style={FONT}>
              <Link href="/sign-in" className="font-bold text-neutral-300">Return to log-in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

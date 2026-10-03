"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const FONT = { fontFamily: "Arial, sans-serif" };

// Soft gate for the first 7 days after signup (see lib/auth/verificationGate.ts): a thin
// dismiss-free reminder bar, the rest of the app works normally. Past 7 days, verificationRequired
// flips true and this becomes a full block — matches the app's existing "no client-side content
// hiding without a real gate" pattern (see LockedFeature.tsx's native equivalent).
export default function EmailVerificationGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn, emailVerified, verificationRequired } = useAuth();
  const pathname = usePathname();

  if (!isSignedIn || emailVerified) return <>{children}</>;

  if (verificationRequired && pathname !== "/verify-email") {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center px-4 text-center center-lift">
        <p className="text-lg font-bold uppercase tracking-[0.04em] text-white mb-3" style={FONT}>
          You must verify your email to keep using this account.
        </p>
        <Link href="/verify-email" className="text-sm uppercase tracking-wide font-bold text-neutral-300 underline" style={FONT}>
          Verify now
        </Link>
      </main>
    );
  }

  return (
    <>
      {/* The reminder shows on the main menu only — not on every page. */}
      {!verificationRequired && pathname === "/dashboard" && (
        <div className="bg-neutral-900 border-b border-neutral-700 text-center py-2 px-4">
          <p className="text-xs uppercase tracking-wide text-neutral-300" style={FONT}>
            Please verify your email.{" "}
            <Link href="/verify-email" className="font-bold text-white underline">Verify now</Link>
          </p>
        </div>
      )}
      {children}
    </>
  );
}

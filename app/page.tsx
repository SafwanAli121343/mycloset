"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const FONT = { fontFamily: "Arial, sans-serif" };

const BUTTONS = [
  { label: "CREATE AN ACCOUNT", href: "/sign-up" },
  { label: "LOG IN", href: "/sign-in" },
];

export default function LandingPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && isSignedIn) router.replace("/dashboard");
  }, [isLoaded, isSignedIn, router]);

  if (!isLoaded || isSignedIn) return null;

  return (
    <main className="relative min-h-screen bg-black flex flex-col items-center justify-center overflow-hidden">
      <div className="relative z-10 flex flex-col items-center" style={{ transform: "translateY(-12vh)" }}>
        <p className="text-3xl font-bold uppercase tracking-[0.04em] mb-10 text-white" style={FONT}>
          MYCLOSET
        </p>
        <div className="divide-y divide-neutral-800 w-64">
          {BUTTONS.map(({ label, href }) => (
            <button
              key={label}
              onClick={() => router.push(href)}
              className="w-full py-4 bg-neutral-950 text-white font-bold uppercase text-sm transition-colors duration-150 hover:bg-neutral-800 outline-none focus:outline-none"
              style={FONT}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

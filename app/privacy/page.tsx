import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_SECTIONS as sections } from "@/lib/legal/content";

export const metadata: Metadata = {
  title: "Privacy Policy — MYCLOSET",
};

const FONT = { fontFamily: "Arial, sans-serif" };

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-xs uppercase tracking-[0.16em] text-gray-400 mb-3" style={FONT}>
          MYCLOSET
        </p>
        <h1 className="text-2xl font-bold uppercase tracking-[0.06em] mb-2" style={FONT}>
          Privacy Policy
        </h1>
        <p className="text-xs text-gray-400 mb-12" style={FONT}>
          Last updated August 22, 2026
        </p>

        <div className="space-y-10">
          {sections.map(s => (
            <section key={s.heading}>
              <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
                {s.heading}
              </h2>
              <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
                {s.body}
              </p>
            </section>
          ))}
        </div>

        <p className="text-xs text-gray-400 mt-14 space-x-4" style={FONT}>
          <Link href="/terms" className="underline font-bold text-black">Terms of Service</Link>
          {" · "}
          <Link href="/eula" className="underline font-bold text-black">EULA</Link>
          {" · "}
          <Link href="/cookies" className="underline font-bold text-black">Cookie Policy</Link>
        </p>
      </div>
    </main>
  );
}

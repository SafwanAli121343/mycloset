import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — MYCLOSET",
};

const FONT = { fontFamily: "Arial, sans-serif" };

const sections = [
  {
    heading: "1. What We Collect",
    body: "Account info (email address, and a securely hashed password — we never store your password in plain text). Wardrobe content (photos you upload or import via product URL, and the details you or our AI systems generate about those items — brand, category, color, style tags, and similar metadata). Location (only with your permission, or a location you type in yourself) — used to fetch local weather so outfit suggestions and the calendar match real conditions. Basic technical data (device/browser type, IP address) for security and reliability.",
  },
  {
    heading: "2. How We Use It",
    body: "To run the service: storing your wardrobe, generating AI style analysis and outfit recommendations, and factoring in weather where relevant. To keep the service secure and working. To contact you about your account when necessary (e.g. a security notice). We do not use your data for advertising, and we do not sell your personal information.",
  },
  {
    heading: "3. Who We Share It With",
    body: "Only the providers that power the features you use, and only what each one needs to do its job: AI/vision providers (OpenAI, Google Cloud Vision) receive garment photos and text to generate analysis, tags, and recommendations. Our database/storage provider (Supabase) hosts your account and wardrobe data. Weather and location providers (Open-Meteo, and a reverse-geocoding provider) turn coordinates into weather and place names. Product-lookup providers (used only for links you personally submit) help auto-fill item details from a URL you provide. We do not sell data to anyone, and we do not share it for advertising purposes.",
  },
  {
    heading: "4. Your Choices",
    body: "You can delete individual wardrobe items, or your entire account, at any time from within the app. You can deny or revoke location access at any time through your browser or device settings and enter a location manually instead. To request a copy of your data or ask us to delete it, email safwan200817@gmail.com.",
  },
  {
    heading: "5. Data Retention",
    body: "We keep your account and wardrobe data as long as your account is active. Deleting an item or your account removes it from our active systems; backups, where they exist, are purged on a rolling basis.",
  },
  {
    heading: "6. Children's Privacy",
    body: "MYCLOSET is not directed to children under 13, and we do not knowingly collect information from anyone under 13. If you believe a child has given us information, contact us and we'll remove it.",
  },
  {
    heading: "7. Security",
    body: "We use industry-standard measures — hashed passwords, encrypted connections, and access controls limiting who can reach your data — to protect your information. No online service can guarantee perfect security, but we take reasonable steps to keep your wardrobe private to you.",
  },
  {
    heading: "8. Changes",
    body: "We may update this Privacy Policy from time to time. We'll post the revised policy here with a new effective date.",
  },
  {
    heading: "9. Contact",
    body: "Questions about this Privacy Policy? Email safwan200817@gmail.com.",
  },
];

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
          Last updated June 2026
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

        <p className="text-xs text-gray-400 mt-14" style={FONT}>
          See also our <Link href="/terms" className="underline font-bold text-black">Terms of Service</Link>.
        </p>
      </div>
    </main>
  );
}

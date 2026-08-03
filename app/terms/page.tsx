import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service — MYCLOSET",
};

const FONT = { fontFamily: "Arial, sans-serif" };

const sections = [
  {
    heading: "1. Acceptance",
    body: "By creating an account or using MYCLOSET you agree to these Terms. If you do not agree, do not use the service.",
  },
  {
    heading: "2. Your Content",
    body: "You may upload photos, paste product URLs, and enter item details to build your personal wardrobe. By submitting content — including images retrieved from third-party URLs on your behalf — you represent that your use of that content is lawful and, where applicable, constitutes fair use for personal, non-commercial wardrobe management. MYCLOSET is not responsible for content you submit.",
  },
  {
    heading: "3. URL Import",
    body: 'When you provide a product URL, you are directing MYCLOSET to retrieve information from that URL on your behalf, in the same way a browser retrieves a page you navigate to. Retrieved content is stored solely within your private wardrobe and is not shared publicly. You authorize MYCLOSET to perform this fetch each time you submit a URL. Some sites may block automated access — MYCLOSET will notify you when a URL cannot be imported and provide a manual entry option.',
  },
  {
    heading: "4. Game Mode & Bot Opponents",
    body: "Game mode opponents (bots) are curated characters with wardrobes assembled from publicly available product data and fictional metadata. Any resemblance to real persons is coincidental. As MYCLOSET grows, real user wardrobes may be used as opponents — but only with your explicit opt-in consent. You may opt in or out of this feature at any time through Settings. If you opt in: (a) only your wardrobe's scoring metadata is used (brand, category, style tags) — no personal information is shared; (b) your wardrobe appears anonymously (no name or account information is attached); (c) individual items you mark as private will never appear in game mode.",
  },
  {
    heading: "5. Intellectual Property",
    body: "MYCLOSET and its original content (algorithms, design, scoring engine) are owned by MYCLOSET. You retain ownership of any original photos you take and upload. You grant MYCLOSET a limited license to store and display your uploaded content solely to provide the service to you.",
  },
  {
    heading: "6. Prohibited Use",
    body: "You may not use MYCLOSET to: (a) infringe any intellectual property rights; (b) upload content you do not have the right to use; (c) attempt to scrape, reverse-engineer, or overload the service; (d) use the service for any commercial purpose without written permission.",
  },
  {
    heading: "7. Disclaimers",
    body: "MYCLOSET is provided \"as is\" without warranties of any kind. Wardrobe scores and outfit recommendations are for entertainment and personal styling purposes only.",
  },
  {
    heading: "8. Changes",
    body: "We may update these Terms at any time. Continued use of the service after changes are posted constitutes acceptance of the new Terms.",
  },
  {
    heading: "9. Contact",
    body: "Questions about these Terms? Email safwan200817@gmail.com.",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-xs uppercase tracking-[0.16em] text-gray-400 mb-3" style={FONT}>
          MYCLOSET
        </p>
        <h1 className="text-2xl font-bold uppercase tracking-[0.06em] mb-2" style={FONT}>
          Terms of Service
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
      </div>
    </main>
  );
}

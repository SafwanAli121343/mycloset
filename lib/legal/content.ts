// Single source of truth for the legal documents' text. The four app/{terms,privacy,eula,
// cookies}/page.tsx pages import their `sections` array from here instead of declaring it
// inline, and app/api/legal/[doc]/route.ts serves the same data as JSON for the native app to
// render in-app (see native/screens/LegalScreen.tsx): one place to edit, both surfaces stay in
// sync instead of drifting the way a hand-duplicated copy would.

export type LegalSection = { heading: string; body: string };
export type LegalDoc = { title: string; lastUpdated: string; sections: LegalSection[] };

const LAST_UPDATED = "October 2, 2026";

export const TERMS_SECTIONS: LegalSection[] = [
  {
    heading: "1. Acceptance of Terms",
    body: "By creating an account or using MYCLOSET (the \"Service\") you agree to these Terms of Service (\"Terms\"). If you do not agree, do not use the Service. These Terms form a binding agreement between you and MYCLOSET (\"we\", \"us\", \"our\"). These Terms were last updated August 22, 2026.",
  },
  {
    heading: "2. Eligibility",
    body: "You must be at least 13 years old (16 in the EU/EEA) to use MYCLOSET. By using the Service, you represent that you meet this requirement. We do not knowingly collect data from children under 13.",
  },
  {
    heading: "3. License to Use",
    body: "We grant you a personal, non-exclusive, non-transferable, revocable license to use the Service for your personal, non-commercial wardrobe management. You may not sublicense, sell, or transfer this license. All rights not expressly granted are reserved by MYCLOSET.",
  },
  {
    heading: "4. Your Content",
    body: "You retain ownership of the photos and other content you upload (\"Your Content\"). By uploading content you grant MYCLOSET a limited, worldwide, royalty-free license to store, process, and display Your Content solely to provide the Service to you. You represent that you have the right to submit Your Content and that doing so does not infringe any third party's rights.",
  },
  {
    heading: "5. URL Import",
    body: "When you provide a product URL, you direct MYCLOSET to retrieve information from that URL on your behalf, in the same way a browser retrieves a page you navigate to. Retrieved content is stored solely within your private wardrobe and is not shared publicly. Some sites may block automated access; MYCLOSET will notify you when a URL cannot be imported.",
  },
  {
    heading: "6. Subscriptions and Payments",
    body: "MYCLOSET offers paid subscription plans and one-time purchases, available exclusively as in-app purchases through the Apple App Store and Google Play. Apple or Google is the merchant of record for every purchase and bills your payment method directly; we do not process payments ourselves and never see or store your card number, CVV, or bank account details. Subscriptions automatically renew at the end of each billing period (monthly, as selected) at the then-current price unless canceled before the renewal date, per Apple's or Google's respective billing terms. We use RevenueCat, Inc. to receive purchase and subscription event data from Apple and Google on our behalf and to determine your plan entitlement; RevenueCat does not process your payment method. You may cancel your subscription at any time through your App Store or Google Play account settings; access continues until the end of the current billing period. Refund requests must be made to Apple or Google respectively, per their refund policies — we cannot issue refunds directly.",
  },
  {
    heading: "7. Auto-Renewal Disclosure",
    body: "Subscriptions automatically renew unless canceled at least 24 hours before the end of the current period. The renewal charge will be made to your payment method within 24 hours prior to the end of the current period. You can manage or cancel your subscription through your App Store or Google Play account settings. No refund is given for the unused portion of a billing period.",
  },
  {
    heading: "8. Game Mode and Bot Opponents",
    body: "Game mode opponents (bots) are curated characters with wardrobes assembled from publicly available product data and fictional metadata. Any resemblance to real persons is coincidental. As MYCLOSET grows, real user wardrobes may be used as anonymous opponents, but only with your explicit opt-in. You may opt in or out at any time through Settings. If you opt in: only scoring metadata is used (brand, category, style tags); no personal information or photos are shared; items you mark private never appear in game mode.",
  },
  {
    heading: "9. Prohibited Conduct",
    body: "You may not: (a) infringe any intellectual property rights; (b) upload content you do not have the right to use; (c) attempt to scrape, reverse-engineer, probe, or overload the Service; (d) use the Service for any commercial purpose without our written permission; (e) circumvent any rate limits, authentication, or security controls; (f) use the Service to violate any applicable law.",
  },
  {
    heading: "10. Intellectual Property",
    body: "MYCLOSET and its original content (algorithms, scoring engine, design, UI, and software) are owned by MYCLOSET. Nothing in these Terms transfers any intellectual property rights to you other than the limited license in Section 3.",
  },
  {
    heading: "11. Disclaimer of Warranties",
    body: "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. Wardrobe scores and outfit recommendations are for personal styling and entertainment purposes only and do not constitute professional fashion, financial, or any other type of advice. We do not warrant that the Service will be uninterrupted, error-free, or free of viruses.",
  },
  {
    heading: "12. Limitation of Liability",
    body: "TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, MYCLOSET SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS OR DATA, ARISING FROM YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY TO YOU FOR CLAIMS ARISING FROM THESE TERMS OR THE SERVICE SHALL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU HAVE PAID TO US IN THE TWELVE MONTHS PRIOR TO THE CLAIM, OR (B) FIFTY US DOLLARS ($50).",
  },
  {
    heading: "13. Account Deletion",
    body: "You may delete your account at any time from Settings → Delete Account. Deletion is permanent and removes all your wardrobe content, outfit data, and personal information from our active systems. See our Privacy Policy for data retention details. EU/EEA users may also submit a deletion request under GDPR Art. 17 by emailing alizsafwan@outlook.com.",
  },
  {
    heading: "14. Termination",
    body: "We may suspend or terminate your account for violation of these Terms, fraudulent activity, or as required by law. Upon termination, your license to use the Service ends immediately. You may request export of your data before termination using the data export feature in Settings.",
  },
  {
    heading: "15. Governing Law and Dispute Resolution",
    body: "These Terms are governed by the laws of the State of Texas, USA, without regard to conflict-of-law principles. Any dispute arising under these Terms shall be resolved by binding arbitration administered under the American Arbitration Association rules (except for claims eligible for small claims court). Class action and class arbitration waiver: you waive any right to bring or participate in a class action lawsuit or class-wide arbitration. Some jurisdictions do not allow mandatory arbitration or class action waivers; if you reside in such a jurisdiction, the local law controls to the extent it conflicts with this section.",
  },
  {
    heading: "16. Changes to These Terms",
    body: "We may update these Terms at any time. We will post the revised Terms here with a new effective date. For material changes, we will notify you via email or an in-app notice. Continued use of the Service after changes are posted constitutes acceptance of the revised Terms.",
  },
  {
    heading: "17. Apple App Store: Additional Terms",
    body: "These Terms are entered into between you and MYCLOSET only, not with Apple Inc. Apple is not responsible for the Service and has no obligation to furnish any maintenance or support services for it. Apple has no warranty obligations with respect to the Service, except to refund any applicable purchase price to you. Apple is not responsible for addressing any claims by you or a third party relating to the Service. If there is a claim that the Service infringes a third party's intellectual property, Apple is not responsible for the investigation or settlement of such claim. Apple and Apple's subsidiaries are third-party beneficiaries of these Terms and may enforce these Terms against you. Our EULA is available at mycloset.app/eula.",
  },
  { heading: "18. Contact", body: "Questions about these Terms? Email alizsafwan@outlook.com." },
];

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    heading: "1. About This Policy",
    body: "This Privacy Policy explains how MYCLOSET (\"we\", \"us\", \"our\") collects, uses, shares, and protects your personal information when you use the MYCLOSET app or website. It also explains the rights you have over your data. Effective date: September 25, 2026. This policy applies to all users worldwide, with additional disclosures for EU/EEA residents (GDPR) and California residents (CalOPPA / CCPA).",
  },
  {
    heading: "2. What We Collect",
    body: "Account information: your email address and a securely hashed password; we never store your password in plain text. Wardrobe content: photos you upload or import via product URL, and the metadata generated about those items (brand, category, color, style tags, scores, and similar). AI analysis data: structured attributes generated by our AI pipeline about your clothing items and outfit scores. Payment information: subscriptions and one-time purchases are billed exclusively through the Apple App Store or Google Play, who process your payment method directly; we use RevenueCat, Inc. to receive purchase/subscription event data from Apple and Google and determine your plan entitlement; we never see or store your card number, CVV, or bank account details. Location data: only when you grant permission, or when you manually type a location, used solely to fetch local weather for outfit suggestions and your calendar. Profile details: your age and gender, only if you choose to enter them, used to tailor AI analysis to you. Feedback: messages you send us from the Feedback page, along with your account email so we can follow up. Technical data: device and browser type, IP address, session identifiers, and error logs for security and reliability. Usage data: which features you use, in aggregate, to improve the service.",
  },
  {
    heading: "3. Legal Basis for Processing (GDPR)",
    body: "For users in the EU/EEA, we rely on the following legal bases: Contract performance (Art. 6(1)(b)): processing your account data, wardrobe content, and payment data is necessary to provide the service you signed up for. Legitimate interests (Art. 6(1)(f)): security monitoring, fraud prevention, and improving service reliability. Consent (Art. 6(1)(a)): location data and any optional analytics or marketing communications. For sensitive processing such as biometric-adjacent photo analysis, we rely on your explicit consent given at account creation and reinforced by your voluntary upload of each photo.",
  },
  {
    heading: "4. How We Use Your Data",
    body: "To provide the service: storing your wardrobe, generating AI style analysis and outfit recommendations, computing wardrobe and outfit scores, factoring in weather where relevant. To process payments and manage your subscription. To keep the service secure: detecting and preventing fraud, enforcing rate limits, maintaining an audit log of security-relevant events (login, logout, account deletion, data exports). To communicate with you about your account when necessary (e.g., a security notice or subscription confirmation). To comply with legal obligations. We do not use your data for advertising, and we do not sell your personal information to any third party.",
  },
  {
    heading: "5. Who We Share Your Data With",
    body: "We share data only with the providers that power the features you use, and only what each one needs: AI/vision providers: OpenAI, Inc. (USA) and Google LLC (USA) receive garment photos and text — and, for OpenAI, your wardrobe details and the age and gender you've entered — to generate analysis and tags. AI analysis only runs with your explicit permission, which the app asks for before any data is sent and which you can turn off at any time in Settings (AI ANALYSIS); with it off, nothing is sent to an AI provider. Email delivery: Resend, Inc. (USA) sends account emails such as verification and password-reset codes. Database and storage: Supabase, Inc. (USA) hosts your account and wardrobe data. Payment processing: purchases are billed directly by Apple (App Store) or Google (Google Play), who process your payment method; RevenueCat, Inc. (USA) receives purchase/subscription event data from Apple and Google to manage your plan entitlement. We do not process or store card data ourselves. Weather and location: Open-Meteo (Switzerland) provides weather data from coordinates you supply. Product lookup: third-party scraping and web-search services are used only when you submit a URL to auto-fill item details. All US-based sub-processors process data under Standard Contractual Clauses (SCCs) to the extent required by GDPR. We do not share data for advertising and do not sell personal information.",
  },
  {
    heading: "6. Data Retention",
    body: "Account and wardrobe data: retained for as long as your account is active. Session tokens (JWTs): expire after 1 hour; refresh tokens expire after 30 days. Audit log entries: retained for 1 year for security purposes. Backups: purged on a rolling 30-day cycle. If you delete an item or your account, data is removed from active systems immediately; backup purge follows the cycle above. Payment records required by law (tax/accounting): retained for 7 years.",
  },
  {
    heading: "7. Your Rights",
    body: "All users: right to access the data we hold about you; right to correct inaccurate data; right to delete your account and all associated data. EU/EEA residents (GDPR): right of access (Art. 15); right to rectification (Art. 16); right to erasure / \"right to be forgotten\" (Art. 17): exercisable in-app under Settings → Delete Account or by emailing alizsafwan@outlook.com; right to data portability (Art. 20): exercisable in-app under Settings → Export My Data (downloads a JSON file of your wardrobe); right to restriction of processing (Art. 18); right to object (Art. 21); right to withdraw consent at any time; right to lodge a complaint with your local supervisory authority. California residents (CalOPPA / CCPA): right to know what personal information is collected and how it is used; right to delete; right to opt out of sale of personal information (we do not sell data); right to non-discrimination for exercising these rights. We do not respond to Do Not Track (DNT) browser signals because we do not use cross-site tracking technologies. To exercise any right, email alizsafwan@outlook.com or use the in-app options in Settings.",
  },
  {
    heading: "8. Children's Privacy",
    body: "MYCLOSET is not directed to children under 13 (or under 16 in the EU/EEA), and we do not knowingly collect information from anyone under those ages. If you believe a child has created an account, contact us at alizsafwan@outlook.com and we will delete the account promptly.",
  },
  {
    heading: "9. Cookies and Tracking",
    body: "We use only essential session cookies (an httpOnly, Secure, SameSite=Strict cookie that keeps you logged in) and a short-lived refresh token cookie scoped to the /api/auth/refresh path. We do not use advertising cookies, cross-site tracking, or third-party analytics cookies. See our Cookie Policy for details.",
  },
  {
    heading: "10. Security",
    body: "We use industry-standard measures: bcrypt-hashed passwords, encrypted HTTPS connections, httpOnly session cookies, JWT authentication with refresh token rotation, and access controls limiting who can reach your data. Payment data is handled exclusively by Apple and Google as part of their respective app store billing platforms. No online service can guarantee perfect security, but we take reasonable steps to keep your wardrobe private.",
  },
  {
    heading: "11. Changes to This Policy",
    body: "We may update this Privacy Policy from time to time. When we do, we will post the revised policy here with a new effective date. For material changes, we will notify you via email or an in-app notice.",
  },
  {
    heading: "12. Contact",
    body: "Data controller: MYCLOSET (individual developer, Safwan Ali). For any privacy questions, rights requests, or complaints: alizsafwan@outlook.com. We respond to all requests within 30 days.",
  },
];

export const EULA_SECTIONS: LegalSection[] = [
  {
    heading: "1. Parties",
    body: "This End User License Agreement (\"EULA\") is a legal agreement between you (\"User\") and MYCLOSET (\"Licensor\"). IMPORTANT: Apple Inc. and Google LLC are not parties to this EULA and have no obligations or responsibilities with respect to the MYCLOSET application. Apple has no warranty obligation for the application, other than to refund the purchase price of the application to you in accordance with Apple's terms. This EULA is between you and MYCLOSET only.",
  },
  {
    heading: "2. License Grant",
    body: "Subject to the terms of this EULA, MYCLOSET grants you a personal, non-exclusive, non-transferable, revocable license to install and use the MYCLOSET application (the \"App\") on any Apple-branded device or Android device that you own or control, solely for your personal, non-commercial wardrobe management. This license does not include the right to sublicense, sell, redistribute, or create derivative works of the App.",
  },
  {
    heading: "3. Restrictions",
    body: "You may not: (a) copy, modify, or distribute the App; (b) reverse engineer, disassemble, or attempt to derive the source code of the App; (c) sell, rent, lease, or sublicense the App; (d) use the App for any commercial purpose without our written permission; (e) remove or alter any proprietary notices or labels on the App; (f) circumvent any technical protection measures in the App.",
  },
  {
    heading: "4. Scope of License",
    body: "The license granted in Section 2 is limited to use on devices you own or control. The terms of this EULA will govern any content, material, or service accessible from or purchased within the App, except where those terms are superseded by a separate agreement between you and the content or service provider. You may not transfer the App to another person or a third party.",
  },
  {
    heading: "5. Maintenance and Support",
    body: "MYCLOSET is solely responsible for providing any maintenance and support services with respect to the App, as required under applicable law and as described in our Terms of Service. Apple and Google have no obligation whatsoever to furnish any maintenance or support services with respect to the App.",
  },
  {
    heading: "6. Warranty",
    body: "MYCLOSET is solely responsible for any product warranties, whether express or implied by law, to the extent not effectively disclaimed. In the event of any failure of the App to conform to any applicable warranty, you may notify Apple (for iOS) or Google (for Android) and they may refund the purchase price, if any, for the App to you. To the maximum extent permitted by applicable law, Apple and Google will have no other warranty obligation whatsoever with respect to the App, and any other claims, losses, liabilities, damages, costs, or expenses attributable to any failure to conform to any warranty will be MYCLOSET's sole responsibility.",
  },
  {
    heading: "7. Product Claims",
    body: "MYCLOSET, not Apple or Google, is responsible for addressing any claims by you or any third party relating to the App or your possession and/or use of the App, including but not limited to: (a) product liability claims; (b) any claim that the App fails to conform to any applicable legal or regulatory requirement; and (c) claims arising under consumer protection or similar legislation.",
  },
  {
    heading: "8. Intellectual Property Rights",
    body: "In the event of any third-party claim that the App or your possession and use of the App infringes a third party's intellectual property rights, MYCLOSET, not Apple or Google, will be solely responsible for the investigation, defense, settlement, and discharge of any such intellectual property infringement claim.",
  },
  {
    heading: "9. Legal Compliance",
    body: "You represent and warrant that: (a) you are not located in a country subject to a U.S. Government embargo or that has been designated by the U.S. Government as a terrorist-supporting country; and (b) you are not listed on any U.S. Government list of prohibited or restricted parties.",
  },
  {
    heading: "10. Third-Party Beneficiaries",
    body: "Apple, Inc. and Google LLC, and their subsidiaries, are third-party beneficiaries of this EULA and, upon your acceptance of this EULA, Apple and Google will each have the right (and will be deemed to have accepted the right) to enforce this EULA against you as a third-party beneficiary thereof.",
  },
  {
    heading: "11. Termination",
    body: "This EULA is effective until terminated. Your rights under this EULA will terminate automatically without notice from MYCLOSET if you fail to comply with any term of this EULA. Upon termination of this EULA, you shall cease all use of the App and destroy all copies of the App in your possession.",
  },
  { heading: "12. Governing Law", body: "This EULA is governed by the laws of the State of Texas, USA, without regard to conflict-of-law principles." },
  { heading: "13. Contact", body: "Questions about this EULA? Contact us at alizsafwan@outlook.com." },
];

// Mirrors app/cookies/page.tsx's content, which renders the two-cookie table as actual HTML on
// the web. Folded into plain sentences here so the same information reads naturally as native
// text (see native/screens/LegalScreen.tsx) without needing a table-layout component; the web
// page itself is untouched and keeps its table.
export const COOKIES_SECTIONS: LegalSection[] = [
  {
    heading: "1. What Are Cookies",
    body: "Cookies are small text files placed on your device by a website. They help the site remember information about your visit so it can work correctly and provide features like staying logged in between page loads.",
  },
  {
    heading: "2. Cookies We Use",
    body: "MYCLOSET uses only the following cookies, all of which are strictly necessary to operate the service. We do not use advertising cookies, cross-site tracking cookies, or third-party analytics cookies. mycloset_session: keeps you logged in between pages, contains a signed JWT identifying your session, httpOnly/Secure/SameSite=Strict, expires after 1 hour. mycloset_refresh: allows your session to be silently renewed without logging in again, scoped to the /api/auth/refresh path only, httpOnly/Secure/SameSite=Strict, expires after 30 days.",
  },
  {
    heading: "3. What We Do Not Use",
    body: "We do not use: advertising or marketing cookies; cross-site tracking pixels; third-party analytics scripts (Google Analytics, Mixpanel, etc.); social media tracking buttons; or any persistent identifiers beyond the session and refresh tokens described above. Because we use only strictly necessary cookies, no cookie consent banner is shown; your use of the Service constitutes acknowledgment of this minimal essential use only.",
  },
  {
    heading: "4. Do Not Track",
    body: "We do not respond to Do Not Track (DNT) browser signals because we do not engage in any cross-site tracking. Our cookies are first-party, strictly necessary, and scoped to mycloset.app only.",
  },
  {
    heading: "5. Managing Cookies",
    body: "You can block or delete cookies through your browser settings. Note that blocking the session cookies listed above will prevent you from logging in. To log out and remove the session cookie, use the Sign Out button in the app.",
  },
  { heading: "6. Changes", body: "If we introduce new cookies we will update this policy and notify you in the app." },
  { heading: "7. Contact", body: "Questions? Email alizsafwan@outlook.com." },
];

export const LEGAL_DOCS: Record<"terms" | "privacy" | "eula" | "cookies", LegalDoc> = {
  terms: { title: "Terms of Service", lastUpdated: LAST_UPDATED, sections: TERMS_SECTIONS },
  privacy: { title: "Privacy Policy", lastUpdated: LAST_UPDATED, sections: PRIVACY_SECTIONS },
  eula: { title: "End User License Agreement", lastUpdated: LAST_UPDATED, sections: EULA_SECTIONS },
  cookies: { title: "Cookie Policy", lastUpdated: LAST_UPDATED, sections: COOKIES_SECTIONS },
};

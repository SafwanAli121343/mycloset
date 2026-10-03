import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy — MYCLOSET",
};

const FONT = { fontFamily: "Arial, sans-serif" };

export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-white text-black" style={FONT}>
      <div className="max-w-2xl mx-auto px-6 py-16">
        <p className="text-xs uppercase tracking-[0.16em] text-gray-400 mb-3" style={FONT}>
          MYCLOSET
        </p>
        <h1 className="text-2xl font-bold uppercase tracking-[0.06em] mb-2" style={FONT}>
          Cookie Policy
        </h1>
        <p className="text-xs text-gray-400 mb-12" style={FONT}>
          Last updated August 22, 2026
        </p>

        <div className="space-y-10">

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              1. What Are Cookies
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              Cookies are small text files placed on your device by a website. They help the site remember information about your visit so it can work correctly and provide features like staying logged in between page loads.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              2. Cookies We Use
            </h2>
            <p className="text-sm leading-relaxed text-gray-700 mb-4" style={FONT}>
              MYCLOSET uses only the following cookies, all of which are strictly necessary to operate the service. We do not use advertising cookies, cross-site tracking cookies, or third-party analytics cookies.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse" style={FONT}>
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 pr-4 font-bold uppercase tracking-wider text-gray-500">Name</th>
                    <th className="text-left py-2 pr-4 font-bold uppercase tracking-wider text-gray-500">Purpose</th>
                    <th className="text-left py-2 pr-4 font-bold uppercase tracking-wider text-gray-500">Duration</th>
                    <th className="text-left py-2 font-bold uppercase tracking-wider text-gray-500">Type</th>
                  </tr>
                </thead>
                <tbody className="text-gray-700">
                  <tr className="border-b border-gray-100">
                    <td className="py-3 pr-4 font-mono">mycloset_session</td>
                    <td className="py-3 pr-4">Keeps you logged in between pages. Contains a signed JWT that identifies your session. httpOnly, Secure, SameSite=Strict — not accessible to JavaScript.</td>
                    <td className="py-3 pr-4">1 hour</td>
                    <td className="py-3">Strictly necessary</td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="py-3 pr-4 font-mono">mycloset_refresh</td>
                    <td className="py-3 pr-4">Allows your session to be silently renewed without requiring you to log in again. Scoped to the /api/auth/refresh path only. httpOnly, Secure, SameSite=Strict.</td>
                    <td className="py-3 pr-4">30 days</td>
                    <td className="py-3">Strictly necessary</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              3. What We Do Not Use
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              We do not use: advertising or marketing cookies; cross-site tracking pixels; third-party analytics scripts (Google Analytics, Mixpanel, etc.); social media tracking buttons; or any persistent identifiers beyond the session and refresh tokens described above. Because we use only strictly necessary cookies, no cookie consent banner is shown — your use of the Service constitutes acknowledgment of this minimal essential use only.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              4. Do Not Track
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              We do not respond to Do Not Track (DNT) browser signals because we do not engage in any cross-site tracking. Our cookies are first-party, strictly necessary, and scoped to mycloset.app only.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              5. Managing Cookies
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              You can block or delete cookies through your browser settings. Note that blocking the session cookies listed above will prevent you from logging in. To log out and remove the session cookie, use the Sign Out button in the app.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              6. Changes
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              If we introduce new cookies we will update this policy and notify you in the app.
            </p>
          </section>

          <section>
            <h2 className="text-sm font-bold uppercase tracking-widest mb-3" style={FONT}>
              7. Contact
            </h2>
            <p className="text-sm leading-relaxed text-gray-700" style={FONT}>
              Questions? Email safwan200817@gmail.com.
            </p>
          </section>

        </div>

        <p className="text-xs text-gray-400 mt-14" style={FONT}>
          <Link href="/privacy" className="underline font-bold text-black">Privacy Policy</Link>
          {" · "}
          <Link href="/terms" className="underline font-bold text-black">Terms of Service</Link>
          {" · "}
          <Link href="/eula" className="underline font-bold text-black">EULA</Link>
        </p>
      </div>
    </main>
  );
}

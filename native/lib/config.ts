// Same underlying backend as the website — every screen in this app calls the exact same
// Next.js API routes (scoring, AI analysis, wardrobe state, etc.) that mycloset.com uses, so
// there is exactly one implementation of every algorithm, shared by web and native.
//
// Point this at wherever the Next.js server is reachable, same considerations as the
// Capacitor build's DEV_SERVER_URL (see ../../capacitor.config.ts):
//   - iOS Simulator: your Mac's http://localhost:3000 works as-is.
//   - Android Emulator: use http://10.0.2.2:3000 instead (its alias for host localhost).
//   - A physical phone (either platform): use your Mac's LAN IP, e.g. http://10.0.0.139:3000,
//     phone and Mac on the same Wi-Fi, and run the Next.js server with
//     `npm run dev -- -H 0.0.0.0` so it accepts non-localhost connections.
//   - Once the site is deployed: your real https:// production URL.
// __DEV__-gated so a store build can never silently ship pointing at your own Mac — a build
// with EAS's "production" profile has __DEV__ false, so this falls through to the placeholder
// below instead of localhost. Simulator/emulator/physical-device dev URL swapping (see the
// comment above) still means editing the __DEV__ branch by hand, exactly as before.
export const API_BASE_URL = __DEV__
  ? "http://localhost:3000" // iOS Simulator shares the Mac's network stack directly — localhost just works
  : "https://mycloset-production-a2c2.up.railway.app"; // Railway deployment — swap for the custom domain once it's set up.

// In-app purchases. false = the free-only release: no Upgrade tab, no plan/purchase UI, no
// "Pro" mentions, and the RevenueCat SDK is never started. For the paid update: create the
// products in App Store Connect + RevenueCat, paste the RevenueCat iOS public key below, flip
// this to true and ship a new build (full checklist: docs/PAID_UPDATE.md).
export const PAYMENTS_ENABLED = false;
export const REVENUECAT_IOS_API_KEY = ""; // "appl_..." from RevenueCat → Project → API keys
export const REVENUECAT_ANDROID_API_KEY = ""; // "goog_..." once the Play Store version exists

// Legal docs (Terms/Privacy/EULA/Cookies) render in-app via GET /api/legal/[doc] — see
// components/LegalModal.tsx — not by opening the website. The website's own /terms, /privacy
// etc. pages still need to be live at a real production domain regardless: App Store Connect
// and Google Play Console both require a working, publicly reachable privacy policy URL in the
// store listing metadata, separate from what the app itself shows.

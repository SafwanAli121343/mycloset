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
export const API_BASE_URL = "http://10.0.0.31:3000"; // your Mac's current LAN IP — for a physical phone on the same Wi-Fi

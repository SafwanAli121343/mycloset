# mycloset — native app (React Native / Expo)

Real native iOS + Android app, built from scratch as a separate project — not a WebView wrapper.
Every screen renders true native components and calls the exact same Next.js API routes
(`../app/api/**`) the website uses, so scoring, AI analysis, and every algorithm are identical
between web and native; only the UI layer is reimplemented per platform.

## Setup

```
cd native
npm install
```

Edit `lib/config.ts` and set `API_BASE_URL` to wherever the Next.js server (the `mycloset`
project one level up) is reachable — same considerations as the website's Capacitor build:

- iOS Simulator: `http://localhost:3000` works as-is.
- Android Emulator: use `http://10.0.2.2:3000` instead (its alias for host `localhost`).
- A physical phone: use your computer's LAN IP (e.g. `http://192.168.1.x:3000`), phone and
  computer on the same Wi-Fi, and run the Next.js server with `npm run dev -- -H 0.0.0.0` in
  the main project directory so it accepts non-localhost connections.
- Once the site is deployed: its real `https://` URL.

Make sure the Next.js dev server (or the deployed site) is actually running before launching
the app — every screen depends on it, there is no offline/bundled content.

## Run

```
npm run ios      # opens iOS Simulator (needs Xcode installed)
npm run android   # opens Android Emulator (needs Android Studio + a configured emulator)
npm start         # starts Metro only — scan the QR code with Expo Go on a physical device
```

## What's here vs. the website

Implemented natively: sign in/up, a persistent bottom tab bar (Closet, Add, Calendar, Builder,
Wardrobe), settings/sign out, and all five core screens with real functionality against the
live backend.

Simplified vs. the website for this first pass (noted in each screen's own comments where it
applies):
- Wardrobe screen shows a fresh analysis snapshot each time rather than the website's
  persistent level/crossing-progress system (`wardrobe_analysis_state`).
- Calendar's day detail is a simple inline panel rather than the website's full edit-in-place
  outfit builder.
- Add Item is manual-entry (photo + typed fields) rather than the website's AI-autofill-from-
  photo flow.

None of the website's other screens (game, battle, score, generate, preview, outfits) have
native equivalents yet.

## Auth

The website uses an httpOnly cookie; native has no browser cookie jar, so it uses a Bearer
token instead — the exact same JWT, just carried differently. `POST /api/auth/login` and
`/api/auth/register` return `{ token }` in the response body specifically for this; the token
is stored via `expo-secure-store` and sent as `Authorization: Bearer <token>` on every request
(see `lib/api.ts`). The server (`../lib/auth/session.ts`) checks the cookie first, falling back
to the Bearer header — so this is purely additive and doesn't change the website's behavior.

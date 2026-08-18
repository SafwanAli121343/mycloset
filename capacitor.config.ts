import type { CapacitorConfig } from "@capacitor/cli";

// This app leans on server-side API routes (OpenAI calls, Supabase writes via the
// service-role key, weather/geocoding fetches) that can't run inside a statically-bundled
// mobile binary. So instead of `webDir` (a static export Capacitor ships inside the app),
// the native shell loads the live Next.js site in a WebView via `server.url` below — the
// same architecture Twitter/Instagram-style hybrid apps use when the web app is the real
// backend-connected surface and native is just the container + a few native bridges
// (camera, geolocation, status bar, splash screen).
//
// Before building for a device/simulator, point `server.url` at wherever the site is
// actually reachable:
//   - Local dev on the SAME machine as the simulator: http://localhost:3000 works for iOS
//     Simulator; Android emulator needs http://10.0.2.2:3000 instead (its alias for host
//     localhost).
//   - Local dev on a PHYSICAL device: use your machine's LAN IP, e.g. http://10.0.0.139:3000
//     (device and computer must be on the same Wi-Fi network), and run `npm run dev -- -H
//     0.0.0.0` so the dev server accepts non-localhost connections.
//   - Once deployed: your real https:// production URL. Switch `cleartext` to false then too
//     — it's only needed for the plain-http local-dev cases above.
const DEV_SERVER_URL = "http://localhost:3000"; // TODO: swap for your LAN IP or prod URL, see above

const config: CapacitorConfig = {
  appId: "com.mycloset.app",
  appName: "mycloset",
  webDir: "public", // unused while server.url is set, but required by the CapacitorConfig type
  server: {
    url: DEV_SERVER_URL,
    cleartext: true,
  },
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: "#ffffff",
      androidSplashResourceName: "splash",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK", // dark icons/text on the site's white background
      backgroundColor: "#ffffff",
    },
  },
};

export default config;

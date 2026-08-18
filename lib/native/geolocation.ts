"use client";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";

// Progressive enhancement: inside the native Capacitor shell, use the native geolocation
// plugin (proper native permission dialog, works even when the WebView's own geolocation
// API is restricted); everywhere else (regular browser) this is a thin wrapper around the
// standard web API, so desktop/web behavior is completely unchanged.
export async function getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted") {
        const req = await Geolocation.requestPermissions();
        if (req.location !== "granted") return null;
      }
      const pos = await Geolocation.getCurrentPosition({ timeout: 8000 });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude };
    } catch {
      return null;
    }
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000 },
    );
  });
}

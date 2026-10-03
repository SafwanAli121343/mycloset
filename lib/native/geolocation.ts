"use client";

// Thin wrapper around the standard web Geolocation API.
export async function getCurrentLocation(): Promise<{ lat: number; lon: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null),
      // enableHighAccuracy defaults to false, which on many browsers/desktops resolves via a
      // coarse WiFi/IP lookup instead of GPS — sometimes miles off, a real contributor to
      // "weather isn't specific to my location" complaints that has nothing to do with the
      // weather API itself.
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}

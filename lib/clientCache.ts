"use client";

// In-memory stale-while-revalidate cache for the website's page data. Client-side navigation
// keeps this module alive, so revisiting a page within a session opens INSTANTLY with what it
// last showed and refreshes quietly in the background, instead of every visit starting from an
// empty page and the loading dots. Cleared on a full page load (fresh module) and on sign-out.
const mem = new Map<string, unknown>();

export function peekCache<T>(key: string): T | undefined {
  return mem.get(key) as T | undefined;
}

export function rememberCache<T>(key: string, data: T): void {
  mem.set(key, data);
}

// Anything that changes the user's wardrobe clears what depends on it (no prefix → everything).
export function invalidateClientCache(prefix?: string): void {
  for (const k of [...mem.keys()]) if (!prefix || k.startsWith(prefix)) mem.delete(k);
}

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "dc2:";
type Entry = { data: unknown; ts: number };
const mem = new Map<string, Entry>();

// Call once before any screen renders. Hydrates the in-memory Map from AsyncStorage
// so every subsequent getCached() is a synchronous hit, not a network call.
export async function initDataCache(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(k => k.startsWith(PREFIX));
    if (cacheKeys.length === 0) return;
    const pairs = await AsyncStorage.multiGet(cacheKeys);
    for (const [rawKey, raw] of pairs) {
      if (!raw) continue;
      try {
        const entry = JSON.parse(raw) as Entry;
        mem.set(rawKey.slice(PREFIX.length), entry);
      } catch {}
    }
  } catch {}
}

// Synchronous read. Returns undefined if key was never fetched, or if the entry is
// older than `ttl` ms (when ttl is provided).
export function getCached<T>(key: string, ttl?: number): T | undefined {
  const entry = mem.get(key);
  if (!entry) return undefined;
  if (ttl !== undefined && Date.now() - entry.ts > ttl) return undefined;
  return entry.data as T;
}

// Lets an always-mounted screen (the bottom tabs never unmount) pick up fresh data the moment
// ANOTHER screen writes it, instead of only on its own next focus — e.g. Closet showing a just-
// added item before the user has even switched tabs, rather than flashing its old state first.
const listeners = new Map<string, Set<(data: unknown) => void>>();
export function subscribeCached<T>(key: string, fn: (data: T) => void): () => void {
  let set = listeners.get(key);
  if (!set) { set = new Set(); listeners.set(key, set); }
  const cb = fn as (data: unknown) => void;
  set.add(cb);
  return () => { set!.delete(cb); };
}

export function setCached<T>(key: string, data: T): void {
  const entry: Entry = { data, ts: Date.now() };
  mem.set(key, entry);
  AsyncStorage.setItem(PREFIX + key, JSON.stringify(entry)).catch(() => {});
  listeners.get(key)?.forEach(fn => fn(data));
}

export function invalidateCached(prefix?: string): void {
  const toDelete: string[] = [];
  for (const k of mem.keys()) {
    if (!prefix || k.startsWith(prefix)) toDelete.push(k);
  }
  for (const k of toDelete) {
    mem.delete(k);
    AsyncStorage.removeItem(PREFIX + k).catch(() => {});
  }
}

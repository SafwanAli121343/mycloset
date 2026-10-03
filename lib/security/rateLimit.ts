// In-memory sliding-window rate limiter + account lockout.
//
// Works for single-process deployments. For multi-instance production (e.g. Vercel with multiple
// warm function replicas), replace `store` and `loginFailures` with a shared Redis-backed store
// such as @upstash/ratelimit — see SECURITY_DEFERRED.md.

interface Bucket {
  timestamps: number[];
  lockedUntil?: number;
}

interface FailureRecord {
  count: number;
  firstAt: number;
  lockedUntil?: number;
}

// Singletons — shared across all requests hitting the same Node.js process
const store = new Map<string, Bucket>();
const loginFailures = new Map<string, FailureRecord>();

const LOCKOUT_AFTER = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

let pruneTimer: ReturnType<typeof setInterval> | undefined;

function schedulePrune() {
  if (pruneTimer) return;
  pruneTimer = setInterval(() => {
    const n = Date.now();
    for (const [key, bucket] of store) {
      const windowMs = key.startsWith("auth:") ? 15 * 60 * 1000 : 60 * 1000;
      bucket.timestamps = bucket.timestamps.filter(t => t > n - windowMs);
      if (!bucket.timestamps.length && (!bucket.lockedUntil || bucket.lockedUntil < n)) {
        store.delete(key);
      }
    }
    for (const [email, rec] of loginFailures) {
      if (rec.firstAt + FAILURE_WINDOW_MS < n && (!rec.lockedUntil || rec.lockedUntil < n)) {
        loginFailures.delete(email);
      }
    }
  }, 5 * 60 * 1000);
  // Don't prevent process exit
  if (typeof pruneTimer === "object" && pruneTimer !== null && "unref" in pruneTimer) {
    (pruneTimer as { unref(): void }).unref();
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSecs: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  schedulePrune();
  const n = Date.now();
  let bucket = store.get(key);
  if (!bucket) { bucket = { timestamps: [] }; store.set(key, bucket); }

  if (bucket.lockedUntil && bucket.lockedUntil > n) {
    return { allowed: false, remaining: 0, resetAt: bucket.lockedUntil, retryAfterSecs: Math.ceil((bucket.lockedUntil - n) / 1000) };
  }

  bucket.timestamps = bucket.timestamps.filter(t => t > n - windowMs);
  const resetAt = (bucket.timestamps[0] ?? n) + windowMs;

  if (bucket.timestamps.length >= limit) {
    return { allowed: false, remaining: 0, resetAt, retryAfterSecs: Math.max(1, Math.ceil((resetAt - n) / 1000)) };
  }

  bucket.timestamps.push(n);
  return { allowed: true, remaining: limit - bucket.timestamps.length, resetAt, retryAfterSecs: 0 };
}

export interface AccountLockResult {
  locked: boolean;
  attemptsLeft?: number;
  retryAfterSecs?: number;
}

export function checkAccountLockout(email: string): AccountLockResult {
  const key = email.toLowerCase();
  const rec = loginFailures.get(key);
  if (!rec) return { locked: false, attemptsLeft: LOCKOUT_AFTER };

  const n = Date.now();
  if (rec.lockedUntil && rec.lockedUntil > n) {
    return { locked: true, retryAfterSecs: Math.ceil((rec.lockedUntil - n) / 1000) };
  }
  if (rec.firstAt + FAILURE_WINDOW_MS < n) {
    loginFailures.delete(key);
    return { locked: false, attemptsLeft: LOCKOUT_AFTER };
  }
  return { locked: false, attemptsLeft: Math.max(0, LOCKOUT_AFTER - rec.count) };
}

export function recordFailedLogin(email: string): AccountLockResult {
  const key = email.toLowerCase();
  const n = Date.now();
  let rec = loginFailures.get(key);

  if (!rec || rec.firstAt + FAILURE_WINDOW_MS < n) {
    rec = { count: 1, firstAt: n };
    loginFailures.set(key, rec);
  } else {
    rec.count++;
  }

  if (rec.count >= LOCKOUT_AFTER) {
    rec.lockedUntil = n + LOCKOUT_DURATION_MS;
    return { locked: true, retryAfterSecs: Math.ceil(LOCKOUT_DURATION_MS / 1000) };
  }
  return { locked: false, attemptsLeft: LOCKOUT_AFTER - rec.count };
}

export function clearFailedLogins(email: string): void {
  loginFailures.delete(email.toLowerCase());
}

// Extracts the real client IP from standard proxy headers.
// Trust only the first value in X-Forwarded-For (set by the outermost proxy).
export function getClientIp(req: { headers: { get(n: string): string | null } }): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

// Convenience wrapper for API route handlers.
// Returns a 429 NextResponse if over limit, or null if the request is allowed.
// Usage: const block = applyApiRateLimit(req); if (block) return block;
export function applyApiRateLimit(
  req: { headers: { get(n: string): string | null } },
  routeKey = "api",
  limit = 60,
  windowMs = 60 * 1000
): Response | null {
  const ip = getClientIp(req);
  const result = checkRateLimit(`${routeKey}:${ip}`, limit, windowMs);
  if (!result.allowed) {
    return new Response(JSON.stringify({ error: "Too many requests. Please slow down." }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSecs),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    });
  }
  return null;
}

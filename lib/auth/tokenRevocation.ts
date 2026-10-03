// In-memory JWT revocation list. Stores JTI (JWT ID) → expiry (Unix seconds).
//
// This prevents reuse of tokens after explicit logout within the same process lifetime.
// Limitation: resets on server restart and is not shared across multiple instances.
// Production upgrade path: replace with a Redis SET with TTL per entry — see SECURITY_DEFERRED.md.

const blocklist = new Map<string, number>(); // jti → exp (Unix seconds)

export function revokeToken(jti: string, exp: number): void {
  blocklist.set(jti, exp);
  pruneExpired();
}

export function isRevoked(jti: string): boolean {
  return blocklist.has(jti);
}

function pruneExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of blocklist) {
    if (exp < now) blocklist.delete(jti);
  }
}

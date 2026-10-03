import CircuitBreaker from "opossum";
import OpenAI from "openai";

// Shared OpenAI client — imported by aiInference, outfitInference, and productLookup.
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Circuit breaker wrapping arbitrary async functions that call OpenAI.
// Opens after 3 consecutive failures within 10 s, stays open for 30 s, then half-opens.
// Prevents cascading failures from hammering the API when it's down or rate-limiting.
const BREAKER_OPTIONS: CircuitBreaker.Options = {
  // Was 15s — too tight for a vision call at detail:"high" against a full-size inline base64
  // image (e.g. a native camera/library photo, which has no resize step before analysis unlike
  // a typical hosted-URL upload). That combination could legitimately take longer than 15s,
  // aborting via the breaker's own timeout and surfacing as a generic "Analysis failed" — not
  // an actual OpenAI outage. 25s gives real slow-but-working calls room to finish.
  timeout:              25_000,   // ms — abort individual call if OpenAI takes longer
  errorThresholdPercentage: 50,   // open after ≥50% failure rate in the rolling window
  volumeThreshold:      3,        // need at least 3 calls before percentages mean anything
  resetTimeout:         30_000,   // ms after opening before trying again (half-open)
};

// Cache one breaker per action label so each call-site has its own state. The breaker's action
// is a trampoline that runs whatever function each fire() passes in. It used to be built around
// the FIRST function ever passed for a label, and opossum re-runs a breaker's stored action on
// every fire(), so every later call under that label silently re-sent the first request instead
// of its own (e.g. a second item's analysis returning the first item's result).
const breakers = new Map<string, CircuitBreaker<[() => Promise<unknown>], unknown>>();

export function getBreaker(label: string, timeoutMs?: number): CircuitBreaker<[() => Promise<unknown>], unknown> {
  let b = breakers.get(label);
  if (!b) {
    b = new CircuitBreaker((fn: () => Promise<unknown>) => fn(), { ...BREAKER_OPTIONS, timeout: timeoutMs ?? BREAKER_OPTIONS.timeout });
    b.on("open",     () => console.warn(`[circuit-breaker] ${label}: OPEN — failing fast`));
    b.on("halfOpen", () => console.info( `[circuit-breaker] ${label}: half-open — probing`));
    b.on("close",    () => console.info( `[circuit-breaker] ${label}: CLOSED — recovered`));
    breakers.set(label, b);
  }
  return b;
}

// Convenience: fire a single async function through the named breaker.
// Throws CircuitBreakerOpenError when open (caller should surface a 503).
// timeoutMs applies from the label's first use (one breaker per label).
export async function withBreaker<T>(label: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  return getBreaker(label, timeoutMs).fire(fn) as Promise<T>;
}

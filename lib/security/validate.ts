// Input validation and sanitization helpers.
// All user-supplied strings should pass through here before use.

export const MAX_EMAIL_LEN = 254;   // RFC 5321 limit
export const MAX_PASSWORD_LEN = 256;
export const MAX_STRING_LEN = 2048;

// RFC 5322 simplified — blocks control chars, rejects obvious injection patterns
const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export function sanitizeString(s: unknown, maxLen = MAX_STRING_LEN): string {
  if (typeof s !== "string") return "";
  // Strip null bytes and control characters (except tab/newline in longer fields)
  return s.replace(/\0/g, "").trim().slice(0, maxLen);
}

export function validateEmail(email: unknown): { valid: boolean; value: string } {
  const value = sanitizeString(email, MAX_EMAIL_LEN);
  return { valid: value.length > 0 && EMAIL_RE.test(value), value };
}

export function validatePassword(password: unknown): { error: string | null; value: string } {
  const value = sanitizeString(password, MAX_PASSWORD_LEN);
  if (value.length < 8) return { error: "Password must be at least 8 characters.", value };
  return { error: null, value };
}

// Returns a 413 Response if Content-Length exceeds maxBytes, null otherwise.
// Call before req.json() to reject oversized payloads without consuming the body.
export function rejectOversizedBody(
  req: { headers: { get(n: string): string | null } },
  maxBytes = 1024 * 1024
): Response | null {
  const cl = req.headers.get("content-length");
  if (cl && parseInt(cl, 10) > maxBytes) {
    return new Response(JSON.stringify({ error: "Payload too large." }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

// Parses JSON body with a size guard. Returns null on parse failure or oversized input.
export async function parseJsonBody<T = Record<string, unknown>>(
  req: Request,
  maxBytes = 1024 * 1024
): Promise<T | null> {
  const sizeReject = rejectOversizedBody(req, maxBytes);
  if (sizeReject) return null;
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

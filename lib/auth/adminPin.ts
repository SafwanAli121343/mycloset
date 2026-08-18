import { timingSafeEqual } from "node:crypto";

// Constant-time PIN comparison — a naive `!==` check leaks timing information proportional
// to how many leading characters match, which (combined with no rate limiting on these
// routes) makes a short numeric PIN meaningfully more brute-forceable over the network.
export function checkAdminPin(provided: string | null): boolean {
  const expected = process.env.ADMIN_PIN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

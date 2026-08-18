import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Guards server-side fetches of user-supplied URLs (garment "add via link", product-page
// scraping, background-removal image fetch) against SSRF: a malicious link like
// "http://169.254.169.254/latest/meta-data/" (cloud metadata service) or
// "http://localhost:5432" could otherwise make this server hit internal-only infrastructure
// on the attacker's behalf. We block non-http(s) schemes outright, then resolve the hostname
// and reject any address that lands in a private/loopback/link-local range — this also covers
// DNS-rebinding, where a public-looking domain resolves to a private IP.

function isPrivateOrReservedIp(ip: string, family: 4 | 6): boolean {
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts;
    if (a === 127) return true;                          // loopback
    if (a === 10) return true;                            // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
    if (a === 192 && b === 168) return true;               // 192.168.0.0/16
    if (a === 169 && b === 254) return true;               // link-local / cloud metadata
    if (a === 0) return true;                              // "this" network
    if (a >= 224) return true;                             // multicast/reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return true;                        // loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) return isPrivateOrReservedIp(lower.slice(7), 4); // IPv4-mapped
  return false;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

// Throws UnsafeUrlError if the URL is not safe to fetch server-side. Call this immediately
// before every fetch() of a URL that originated from user input (link, image, productUrl).
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "0.0.0.0") {
    throw new UnsafeUrlError("Localhost URLs are not allowed");
  }

  // Hostname is already a literal IP — check it directly, no DNS lookup needed.
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 && isPrivateOrReservedIp(hostname, 4)) {
    throw new UnsafeUrlError("Private/reserved IP addresses are not allowed");
  }
  if (literalFamily === 6 && isPrivateOrReservedIp(hostname, 6)) {
    throw new UnsafeUrlError("Private/reserved IP addresses are not allowed");
  }
  if (literalFamily) return; // valid public IP literal

  // Resolve every address the hostname maps to and reject if ANY of them is private —
  // prevents DNS rebinding where a public domain resolves to an internal address.
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Could not resolve hostname");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("Could not resolve hostname");
  for (const { address, family } of addresses) {
    if (isPrivateOrReservedIp(address, family === 6 ? 6 : 4)) {
      throw new UnsafeUrlError("URL resolves to a private/reserved address");
    }
  }
}

// Convenience wrapper: returns false instead of throwing, for call sites that already
// swallow fetch errors into a null/fallback result.
export async function isSafeUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

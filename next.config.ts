import type { NextConfig } from "next";

// img-src is intentionally broad (https: + data: + blob:) because garment photos are pulled
// live from arbitrary retailer/brand CDNs (product URL scraping) as well as Supabase Storage —
// there's no fixed allowlist of image hosts to pin to.
//
// script-src needs 'unsafe-eval' in development only — React's dev-mode debugging (Fast
// Refresh / callstack reconstruction) and Turbopack's HMR both eval() in dev, but never in a
// production build, so production keeps the stricter policy without it.
const isDev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  // js.stripe.com: the website checkout's secure card fields (app/upgrade). Only Stripe's own
  // domains are allowed, as listed in Stripe's CSP documentation.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://js.stripe.com https://*.js.stripe.com`,
  "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: 'camera=(self), geolocation=(self), microphone=(), payment=(self "https://js.stripe.com")' },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

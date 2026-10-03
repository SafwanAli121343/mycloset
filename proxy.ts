import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

// Fail-closed allowlist: every page route requires a session UNLESS listed here. (Previously
// this was an allowlist of protected routes, which silently left new pages like /add-item,
// /builder, /calendar, /preview, /wardrobe-analysis, /admin, /database, etc. unprotected at
// the routing layer whenever a new page was added without also updating this list.)
// API routes are excluded entirely — every route under app/api/** does its own
// getSessionFromCookies() check, so gating them here too would just risk breaking
// unauthenticated-by-design endpoints like /api/auth/login and /api/auth/register.
// /forgot-password must be public — its whole purpose is a user who CAN'T sign in (the sign-in
// page links straight to it, and gating it redirected right back to /sign-in, making password
// reset impossible on web). /eula and /cookies are legal pages linked from the public
// /terms and /privacy pages, so they have to be readable signed-out too.
const PUBLIC_PAGES = ["/", "/terms", "/privacy", "/eula", "/cookies", "/sign-in", "/sign-up", "/forgot-password"];

// Common scanner/exploit probe paths — return 404 immediately, no route handler overhead.
const BLOCKED_PATH_RE = /\.(php|asp|aspx|env|htaccess|htpasswd|bak|backup|sql|sh|bash)$/i;
const BLOCKED_SEGMENT_RE = /\/(wp-admin|wp-login|phpMyAdmin|\.git|\.env|xmlrpc)/i;

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Block scanner probes before anything else
  if (BLOCKED_PATH_RE.test(pathname) || BLOCKED_SEGMENT_RE.test(pathname)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Reject absurdly large requests at the edge (before image-processing routes can be abused)
  const cl = req.headers.get("content-length");
  if (cl && parseInt(cl, 10) > 50 * 1024 * 1024) {
    return new NextResponse(JSON.stringify({ error: "Payload too large." }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (pathname.startsWith("/api/")) return NextResponse.next();

  const isPublic = PUBLIC_PAGES.some((p) => (p === "/" ? pathname === "/" : pathname.startsWith(p)));

  if (!isPublic) {
    const session = await getSessionFromRequest(req);
    if (!session) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

// Fail-closed allowlist: every page route requires a session UNLESS listed here. (Previously
// this was an allowlist of protected routes, which silently left new pages like /add-item,
// /builder, /calendar, /preview, /wardrobe-analysis, /admin, /database, etc. unprotected at
// the routing layer whenever a new page was added without also updating this list.)
// API routes are excluded entirely — every route under app/api/** does its own
// getSessionFromCookies() check, so gating them here too would just risk breaking
// unauthenticated-by-design endpoints like /api/auth/login and /api/auth/register.
const PUBLIC_PAGES = ["/", "/terms", "/privacy", "/sign-in", "/sign-up"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
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

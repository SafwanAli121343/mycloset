"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DoorOpen, Settings } from "lucide-react";
import { useIsMobileResolved } from "@/lib/hooks/useIsMobile";

const HIDDEN_ON = new Set(["/", "/dashboard", "/sign-in", "/sign-up"]);
const DARK_PAGES = new Set(["/admin/tag"]);

export default function Navbar() {
  const pathname = usePathname();
  // null until the screen size is known — see useIsMobileResolved (avoids a desktop→mobile jump).
  const isMobile = useIsMobileResolved();
  if (HIDDEN_ON.has(pathname) || isMobile === null) return null;

  const isDark = DARK_PAGES.has(pathname) || (pathname.startsWith("/admin") && pathname !== "/admin/tag");
  const cls = isDark
    ? "text-white/25 hover:text-white/60 transition-colors duration-150"
    : "text-black/30 hover:text-black/60 transition-colors duration-150";

  // Mobile: bottom-right collides with every screen's own bottom-anchored UI (sticky action
  // bars, footer buttons) and reads as "lost" rather than "hidden" — native apps put exit/
  // menu controls up by the status bar instead, so mobile moves this to top-right. A high
  // explicit z-index (above every in-page banner/picker this app uses, which top out around
  // 2100) keeps it reachable from any screen; real full-screen modals still render above it.
  return (
    <div
      data-nav
      data-tutorial="navbar-desktop"
      className={`fixed flex z-[9999] ${isMobile ? "right-4 flex-row-reverse gap-4 items-center" : "bottom-6 right-6 flex-col items-center gap-3"}`}
      // Mobile: the shared top-band line (globals.css --nav-row-*) every page's own top-row
      // control is aligned to via the .nav-row helpers.
      style={isMobile ? { top: "calc(var(--safe-top) + var(--nav-row-top))", height: "var(--nav-row-h)" } : undefined}
    >
      <Link href="/settings" className={cls} title="Settings"><Settings size={19} /></Link>
      <Link href="/dashboard" data-tutorial="navbar-door" className={isDark ? "text-white/35 hover:text-white/70 transition-colors duration-150" : "text-black/40 hover:text-black/70 transition-colors duration-150"} title="Exit">
        <DoorOpen size={22} />
      </Link>
    </div>
  );
}

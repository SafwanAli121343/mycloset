"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Shirt, PlusCircle, CalendarDays, LayoutGrid, Sparkles } from "lucide-react";
import { useIsMobile } from "@/lib/hooks/useIsMobile";

// The real "native app structure" fix: a persistent bottom tab bar for the 5 core screens,
// so mobile navigation isn't a menu page you have to detour through (dashboard) plus a small
// corner icon — it's always one tap away from anywhere, like every native app's primary nav.
export const TAB_BAR_H = 60; // px, excluding safe-area inset — pages pad their own bottom UI by this

const TABS = [
  { label: "Closet",   href: "/closet",            Icon: Shirt },
  { label: "Add",      href: "/add-item",          Icon: PlusCircle },
  { label: "Calendar", href: "/calendar",          Icon: CalendarDays },
  { label: "Builder",  href: "/builder",           Icon: LayoutGrid },
  { label: "Wardrobe", href: "/wardrobe-analysis",  Icon: Sparkles },
];

const SHOWN_ON = new Set(TABS.map(t => t.href).concat(["/dashboard"]));

export default function MobileTabBar() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  if (!isMobile || !SHOWN_ON.has(pathname)) return null;

  return (
    <nav style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9998,
      height: `calc(${TAB_BAR_H}px + var(--safe-bottom))`,
      paddingBottom: "var(--safe-bottom)",
      background: "#fff", borderTop: "1px solid #ebebeb",
      display: "flex", alignItems: "stretch",
    }}>
      {TABS.map(({ label, href, Icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: 3, textDecoration: "none",
              color: active ? "#111" : "#bbb",
            }}
          >
            <Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
            <span style={{
              fontFamily: "Arial, sans-serif", fontSize: 8.5, fontWeight: active ? 700 : 400,
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

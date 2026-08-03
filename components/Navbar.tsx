"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DoorOpen, Settings } from "lucide-react";

const HIDDEN_ON = new Set(["/", "/dashboard", "/sign-in", "/sign-up"]);
const DARK_PAGES = new Set(["/database", "/admin/tag"]);

export default function Navbar() {
  const pathname = usePathname();
  if (HIDDEN_ON.has(pathname)) return null;

  const isDark = DARK_PAGES.has(pathname) || (pathname.startsWith("/admin") && pathname !== "/admin/tag");
  const cls = isDark
    ? "text-white/25 hover:text-white/60 transition-colors duration-150"
    : "text-black/30 hover:text-black/60 transition-colors duration-150";

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3">
      <Link href="/settings" className={cls} title="Settings"><Settings size={19} /></Link>
      <Link href="/dashboard" className={isDark ? "text-white/35 hover:text-white/70 transition-colors duration-150" : "text-black/40 hover:text-black/70 transition-colors duration-150"}>
        <DoorOpen size={22} />
      </Link>
    </div>
  );
}

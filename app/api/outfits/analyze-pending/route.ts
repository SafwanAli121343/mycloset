// POST /api/outfits/analyze-pending  { year, month } → { done }
// Pro: analyzes this month's calendar outfits that still have no analysis, right now, and answers
// once they're saved. The calendar calls it whenever a day is waiting on its analysis, instead of
// relying only on the background step after an edit/generation (lost if the server restarts).
// Already-analyzed outfits are skipped, so this never pays twice; it goes through the AI gateway,
// so the Pro monthly cap applies.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getUserById } from "@/lib/db/users";
import { analyzeCalendarOutfits } from "@/lib/calendarAnalysis";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "outfits:analyze-pending", 300, 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const year = Number(body?.year), month = Number(body?.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }
  const user = await getUserById(session.userId).catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mm = String(month).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();
  const done = await analyzeCalendarOutfits(
    user,
    { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` },
    Date.now() + 45_000,
  );
  return NextResponse.json({ done });
}

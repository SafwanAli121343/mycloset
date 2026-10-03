// POST /api/jobs/ack { ids: string[] } — the app has shown the outcome of these finished jobs.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { acknowledgeJobs } from "@/lib/analysisJobs";

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  await acknowledgeJobs(session.userId, ids);
  return NextResponse.json({ ok: true });
}

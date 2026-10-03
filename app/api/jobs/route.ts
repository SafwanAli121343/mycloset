// GET  /api/jobs → { jobs, credits, wardrobe }   — everything the app needs to show purchased
//      analyses: running/finished jobs (to resume a loading screen after the app was closed, or
//      explain one that didn't finish), credits available right now, and the Wardrobe tab's
//      report status. Also starts Pro's catch-up analysis when there's something to catch up on.
// POST /api/jobs { kind: "item", garmentId } | { kind: "wardrobe" } → { job }
//      Starts a purchased analysis ("Use score?" / "Perform analysis?"). The credit is only
//      spent once the result is saved — see lib/analysisJobs.ts.
import { NextRequest, NextResponse, after } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import {
  getJobs, availableCredits, wardrobeStatus, startJob, runJob, maybeStartProBackfill, JobError,
} from "@/lib/analysisJobs";

// Jobs run after the response within this limit; anything longer is caught by the stale check.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "jobs:get", 120, 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const backfill = await maybeStartProBackfill(session.userId).catch(() => null);
  if (backfill) after(() => runJob(backfill));

  const jobs = await getJobs(session.userId);
  const [credits, wardrobe] = await Promise.all([
    availableCredits(session.userId, jobs),
    wardrobeStatus(session.userId),
  ]);
  return NextResponse.json(
    {
      jobs: jobs.map(j => ({ id: j.id, kind: j.kind, targetId: j.target_id, status: j.status, error: j.error, createdAt: j.created_at })),
      credits,
      wardrobe,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "jobs:start", 20, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { kind?: string; garmentId?: string } | null;
  if (body?.kind !== "item" && body?.kind !== "wardrobe") {
    return NextResponse.json({ error: "kind must be item or wardrobe" }, { status: 400 });
  }
  try {
    const job = await startJob(session.userId, body.kind, body.garmentId);
    after(() => runJob(job));
    return NextResponse.json({ job: { id: job.id, kind: job.kind, targetId: job.target_id, status: job.status } });
  } catch (e) {
    if (e instanceof JobError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[jobs POST]", e);
    return NextResponse.json({ error: "Couldn't start the analysis. Nothing was used — please try again." }, { status: 500 });
  }
}

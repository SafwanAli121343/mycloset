// Server-side analysis jobs (supabase/add_analysis_jobs.sql → analysis_jobs):
//   item         — "Use score?": a free user spends one Single Item Analysis on one item
//   wardrobe     — "Perform analysis?": a free user spends one Full Wardrobe Analysis on the report
//   pro_backfill — right after someone becomes Pro: analyze everything they added while free
//
// Guarantees, in order of importance:
// 1. A purchased credit is spent ONLY after the result has been saved. A job that fails, or
//    dies silently (server restart, crash), never costs anything. Ordering inside a job:
//    save the result → mark the job done (only if it's still "running") → spend the credit. A
//    crash after the save but before the spend favors the user (they keep the credit), never
//    the reverse.
// 2. Jobs run after the response (next/server `after`), so closing the app doesn't stop them;
//    the result is waiting when the user comes back.
// 3. A running paid job RESERVES its credit (available = balance − running paid jobs), so the
//    same credit can't be used twice by two quick taps or two devices; the DB also allows only
//    one running job of each kind per user (analysis_jobs_one_running).
// 4. A job with no heartbeat for STALE_MS is treated as dead: marked failed, its reservation
//    released, nothing charged.
import { createClient } from "@supabase/supabase-js";
import { getUserById, type User } from "@/lib/db/users";
import { resolveEntitlement } from "@/lib/billing/entitlements";
import { aiAnalyzeGarmentRow, type GarmentRowForAnalysis } from "@/lib/garmentAnalysis";
import { AiNotAllowedError } from "@/lib/aiGateway";
import {
  buildOrAdvanceReport, hasEnoughForWardrobeAnalysis, loadWardrobeState, canAdvance,
} from "@/lib/wardrobeReportBuilder";
import { analyzeTopOutfits } from "@/lib/outfitAnalysisStore";
import { computePairings } from "@/lib/pairings";
import { analyzeCalendarOutfits } from "@/lib/calendarAnalysis";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type JobKind = "item" | "wardrobe" | "pro_backfill";
export type Job = {
  id: string; user_id: string; kind: JobKind; target_id: string | null; paid: boolean;
  status: "running" | "done" | "failed"; error: string | null;
  created_at: string; heartbeat_at: string; finished_at: string | null; acknowledged: boolean;
};

export const STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 20 * 1000;
// Don't re-run Pro's catch-up more often than this (each run only does what's still missing).
const BACKFILL_COOLDOWN_MS = 30 * 60 * 1000;

// Items added in the last few minutes may still be mid-analysis from Add Item itself — the
// catch-up leaves them alone rather than paying for the same analysis twice.
const settledBefore = () => new Date(Date.now() - 5 * 60 * 1000).toISOString();

const ANALYSIS_COLS = "id, title, brand, category, sub_type, material, color_primary, color_secondary, fit, formality, image, aesthetic_source";

// ── Bookkeeping ──────────────────────────────────────────────────────────────

async function expireStale(userId: string): Promise<void> {
  await sb.from("analysis_jobs")
    .update({ status: "failed", error: "timed_out", finished_at: new Date().toISOString() })
    .eq("user_id", userId).eq("status", "running")
    .lt("heartbeat_at", new Date(Date.now() - STALE_MS).toISOString());
}

async function balances(userId: string): Promise<{ item: number; wardrobe: number }> {
  const { data } = await sb.from("users").select("ai_credits, wardrobe_scan_credits").eq("id", userId).single();
  const d = data as { ai_credits?: number; wardrobe_scan_credits?: number } | null;
  return { item: d?.ai_credits ?? 0, wardrobe: d?.wardrobe_scan_credits ?? 0 };
}

export async function getJobs(userId: string): Promise<Job[]> {
  await expireStale(userId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb.from("analysis_jobs").select("*")
    .eq("user_id", userId).gte("created_at", since)
    .or("status.eq.running,acknowledged.eq.false")
    .order("created_at", { ascending: false }).limit(20);
  return (data ?? []) as Job[];
}

// Credits the user can start a job with right now: balance minus credits held by running jobs.
export async function availableCredits(userId: string, jobs?: Job[]): Promise<{ item: number; wardrobe: number; itemBalance: number; wardrobeBalance: number }> {
  const all = jobs ?? await getJobs(userId);
  const bal = await balances(userId);
  const held = (k: JobKind) => all.filter(j => j.status === "running" && j.paid && j.kind === k).length;
  return {
    item: Math.max(0, bal.item - held("item")),
    wardrobe: Math.max(0, bal.wardrobe - held("wardrobe")),
    itemBalance: bal.item,
    wardrobeBalance: bal.wardrobe,
  };
}

export async function acknowledgeJobs(userId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await sb.from("analysis_jobs").update({ acknowledged: true })
    .eq("user_id", userId).in("id", ids).neq("status", "running");
}

// ── Wardrobe report status (what the Wardrobe tab should show) ──────────────

export type WardrobeStatus = {
  enoughPieces: boolean;
  report: "none" | "purchased" | "subscription"; // which report exists, if any
  canAdvance: boolean; // the current level is complete, so a new analysis would add a level
};

export async function wardrobeStatus(userId: string): Promise<WardrobeStatus> {
  const [{ data }, state] = await Promise.all([
    sb.from("garments").select("sub_type, category, title").eq("user_id", userId),
    loadWardrobeState(userId),
  ]);
  return {
    enoughPieces: hasEnoughForWardrobeAnalysis((data ?? []) as { sub_type: string | null; category: string | null; title: string | null }[]),
    report: !state ? "none" : state.purchased ? "purchased" : "subscription",
    canAdvance: !!state && canAdvance(state),
  };
}

// ── Starting ─────────────────────────────────────────────────────────────────

export class JobError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

// Validates, reserves and records a job. The caller runs it with `after(() => runJob(job))`.
export async function startJob(userId: string, kind: "item" | "wardrobe", targetId?: string): Promise<Job> {
  const user = await getUserById(userId).catch(() => null);
  if (!user) throw new JobError("Unauthorized", 401);
  if (resolveEntitlement(user).hasAI) {
    // Pro already has every item scored and the full report — a purchased credit would be wasted.
    throw new JobError("You already have this with Pro — no need to use a purchase.", 409);
  }

  const jobs = await getJobs(userId);
  if (jobs.some(j => j.status === "running" && j.kind === kind)) {
    throw new JobError("An analysis is already running.", 409);
  }
  const avail = await availableCredits(userId, jobs);

  if (kind === "item") {
    if (avail.item < 1) throw new JobError("You don't have any scores left.", 402);
    if (!targetId) throw new JobError("garmentId required");
    const { data: g } = await sb.from("garments").select("id, ai_unlocked").eq("id", targetId).eq("user_id", userId).maybeSingle();
    if (!g) throw new JobError("That item no longer exists.", 404);
    if ((g as { ai_unlocked?: boolean }).ai_unlocked) throw new JobError("This item is already scored.", 409);
  } else {
    if (avail.wardrobe < 1) throw new JobError("You don't have any wardrobe analyses left.", 402);
    const status = await wardrobeStatus(userId);
    if (!status.enoughPieces) throw new JobError("Add a few more pieces first: a wardrobe analysis needs at least 5 items that make a complete outfit.", 409);
    if (status.report === "purchased" && !status.canAdvance) throw new JobError("Finish your current level first.", 409);
  }

  const { data, error } = await sb.from("analysis_jobs")
    .insert({ user_id: userId, kind, target_id: kind === "item" ? targetId : null, paid: true })
    .select("*").single();
  if (error || !data) {
    // 23505 = the one-running-job-per-kind index caught a concurrent start (double tap / 2 devices).
    if (error?.code === "23505") throw new JobError("An analysis is already running.", 409);
    throw new JobError("Couldn't start the analysis. Nothing was used — please try again.", 500);
  }
  return data as Job;
}

// Pro's catch-up after upgrading (also re-checked whenever the app asks for job status, so a
// missed webhook or an interrupted run still gets finished). Returns the job if one was started.
export async function maybeStartProBackfill(userId: string): Promise<Job | null> {
  const user = await getUserById(userId).catch(() => null);
  if (!user || !resolveEntitlement(user).hasAI) return null;

  const { data: recent } = await sb.from("analysis_jobs").select("id, status, created_at")
    .eq("user_id", userId).eq("kind", "pro_backfill").order("created_at", { ascending: false }).limit(1);
  const last = recent?.[0] as { status: string; created_at: string } | undefined;
  if (last && (last.status === "running" || Date.now() - new Date(last.created_at).getTime() < BACKFILL_COOLDOWN_MS)) return null;

  // Anything to do? Unanalyzed items, or no report yet with enough pieces.
  const [{ count }, status] = await Promise.all([
    sb.from("garments").select("id", { count: "exact", head: true }).eq("user_id", userId).is("pros", null).lt("created_at", settledBefore()),
    wardrobeStatus(userId),
  ]);
  const needsWork = (count ?? 0) > 0 || (status.report === "none" && status.enoughPieces) || !last;
  if (!needsWork) return null;

  const { data, error } = await sb.from("analysis_jobs")
    .insert({ user_id: userId, kind: "pro_backfill", paid: false, acknowledged: true })
    .select("*").single();
  if (error || !data) return null; // 23505: one is already running
  return data as Job;
}

// ── Running ──────────────────────────────────────────────────────────────────

export async function runJob(job: Job): Promise<void> {
  const beat = setInterval(() => {
    sb.from("analysis_jobs").update({ heartbeat_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "running").then(() => {}, () => {});
  }, HEARTBEAT_MS);
  try {
    const user = await getUserById(job.user_id);
    if (!user) throw new Error("user not found");
    if (job.kind === "item") await runItem(job, user);
    else if (job.kind === "wardrobe") await runWardrobe(job, user);
    else await runProBackfill(user);

    // Mark done only if still running — if it was declared stale meanwhile, the user was already
    // told it failed, so it isn't charged (the saved result is a free bonus).
    const { data: marked } = await sb.from("analysis_jobs")
      .update({ status: "done", finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "running").select("id");
    // Became Pro while it ran (Pro includes this anyway) → the purchase isn't spent.
    const nowPro = job.paid ? resolveEntitlement((await getUserById(job.user_id).catch(() => null)) ?? { email: "", tier: "free" }).hasAI : false;
    if (job.paid && marked?.length && !nowPro) {
      const { data: spent, error } = await sb.rpc("spend_purchase_credit", { p_user: job.user_id, p_kind: job.kind });
      if (error || spent !== true) console.error("[analysisJobs] credit not spent (user keeps it):", job.id, error?.message);
    }
  } catch (e) {
    const reason = e instanceof AiNotAllowedError ? e.reason : e instanceof Error ? e.message : String(e);
    console.error("[analysisJobs] job failed:", job.kind, job.id, reason);
    await sb.from("analysis_jobs")
      .update({ status: "failed", error: reason.slice(0, 200), finished_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "running")
      .then(() => {}, () => {});
  } finally {
    clearInterval(beat);
  }
}

async function runItem(job: Job, user: User): Promise<void> {
  const { data: g } = await sb.from("garments").select(ANALYSIS_COLS).eq("id", job.target_id!).eq("user_id", user.id).maybeSingle();
  if (!g) throw new Error("item deleted");
  const updates = await aiAnalyzeGarmentRow(g as unknown as GarmentRowForAnalysis, user, { paidByCredit: true });
  if (!updates) throw new Error("analysis produced nothing");
  // One write for the analysis AND the unlock, so the user can never pay for an item that
  // isn't visible to them. Zero rows updated = the item was deleted mid-job → not charged.
  const { data: saved, error } = await sb.from("garments")
    .update({ ...updates, ai_unlocked: true })
    .eq("id", job.target_id!).eq("user_id", user.id).select("id");
  if (error || !saved?.length) throw new Error("couldn't save the analysis");
  // Its AI "Pairs With", computed once now (kept for the item from here on — see
  // /api/garments/pairings). Best effort: the score and analysis above are what was bought.
  await computePairings(user.id, job.target_id!, user, { persist: true, ai: { paidByCredit: true } }).catch(() => {});
}

async function runWardrobe(job: Job, user: User): Promise<void> {
  const outcome = await buildOrAdvanceReport(user.id, user, { purchased: true, ai: { paidByCredit: true } });
  // Nothing new to add to a finished report: nothing delivered → not charged.
  if (outcome === "nothing_new") throw new Error("nothing_new");
}

async function runProBackfill(user: User): Promise<void> {
  const deadline = Date.now() + 240_000; // stop with room to spare before the function limit
  try {
    // 1. Every item added while free.
    const { data } = await sb.from("garments").select(ANALYSIS_COLS).eq("user_id", user.id).is("pros", null).lt("created_at", settledBefore());
    const queue = [...((data ?? []) as unknown as GarmentRowForAnalysis[])];
    const worker = async () => {
      for (let g = queue.shift(); g && Date.now() < deadline; g = queue.shift()) {
        try {
          const updates = await aiAnalyzeGarmentRow(g, user);
          if (updates) await sb.from("garments").update(updates).eq("id", g.id).eq("user_id", user.id);
        } catch (e) {
          if (e instanceof AiNotAllowedError) { queue.length = 0; throw e; }
          console.error("[analysisJobs] backfill item failed:", g.id, e);
        }
      }
    };
    await Promise.all(Array.from({ length: 3 }, worker));

    // 2. The Wardrobe report, if there isn't one yet.
    if (Date.now() < deadline) {
      const status = await wardrobeStatus(user.id);
      if (status.report === "none" && status.enoughPieces) {
        await buildOrAdvanceReport(user.id, user, { purchased: false }).catch(e => {
          if (e instanceof AiNotAllowedError) throw e;
          console.error("[analysisJobs] backfill report failed:", e);
        });
      }
    }

    // 3. The first outfits on the Outfits page.
    if (Date.now() < deadline) await analyzeTopOutfits(user, deadline);

    // 4. Calendar outfits for this month and next (generated while free → no scores yet).
    if (Date.now() < deadline) {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
      await analyzeCalendarOutfits(user, { from, to }, deadline);
    }
  } catch (e) {
    // Out of monthly budget: whatever finished is kept; the rest waits for the next window.
    if (!(e instanceof AiNotAllowedError)) throw e;
  }
}

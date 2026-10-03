// Client for purchased analyses (server: lib/analysisJobs.ts, /api/jobs). A job keeps running on
// the server if the app is closed; the screens that start one also check for running/finished
// jobs when they open, so the loading screen picks up where it left off and a result that
// finished while the app was closed is simply there.
import { apiJson, ApiError } from "./api";

export type JobInfo = {
  id: string;
  kind: "item" | "wardrobe" | "pro_backfill";
  targetId: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
  createdAt?: string;
};

export type JobsStatus = {
  jobs: JobInfo[];
  credits: { item: number; wardrobe: number; itemBalance: number; wardrobeBalance: number };
  wardrobe: { enoughPieces: boolean; report: "none" | "purchased" | "subscription"; canAdvance: boolean };
};

export function fetchJobs(): Promise<JobsStatus> {
  return apiJson<JobsStatus>("/api/jobs");
}

export async function startJob(kind: "item" | "wardrobe", garmentId?: string): Promise<JobInfo> {
  const r = await apiJson<{ job: JobInfo }>("/api/jobs", { method: "POST", body: JSON.stringify({ kind, garmentId }) });
  return r.job;
}

export function ackJobs(ids: string[]): void {
  if (!ids.length) return;
  apiJson("/api/jobs/ack", { method: "POST", body: JSON.stringify({ ids }) }).catch(() => {});
}

// Server marks a job with no heartbeat for 10 minutes as failed; waiting a little longer than
// that means this can never spin forever.
const GIVE_UP_MS = 11 * 60 * 1000;
const POLL_MS = 2000;

// Resolves once the job has finished (done or failed). Network errors while polling are
// retried, not treated as failure — the job is still running on the server either way.
export async function waitForJob(id: string, isCancelled: () => boolean = () => false): Promise<JobInfo> {
  const start = Date.now();
  while (!isCancelled()) {
    await new Promise(r => setTimeout(r, POLL_MS));
    try {
      const s = await fetchJobs();
      const job = s.jobs.find(j => j.id === id);
      // Not listed = already acknowledged elsewhere (e.g. another device) → treat as finished.
      if (!job) return { id, kind: "item", targetId: null, status: "done", error: null };
      if (job.status !== "running") return job;
    } catch { /* offline for a moment — keep waiting */ }
    if (Date.now() - start > GIVE_UP_MS) return { id, kind: "item", targetId: null, status: "failed", error: "timed_out" };
  }
  return { id, kind: "item", targetId: null, status: "running", error: null };
}

export function jobFailureMessage(job: JobInfo): string {
  if (job.kind === "wardrobe" && job.error === "nothing_new") {
    return "Your wardrobe analysis didn't find anything new to add. Nothing was used.";
  }
  return job.kind === "wardrobe"
    ? "Your wardrobe analysis didn't finish. Nothing was used — you can try again."
    : "That score didn't finish. Nothing was used — you can try again.";
}

export function startErrorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : "Couldn't start the analysis. Nothing was used — please try again.";
}

export const ITEM_STAGES = [
  "Looking at the piece...",
  "Reading its color and fabric...",
  "Judging fit and style...",
  "Finding what it pairs with...",
  "Scoring...",
];

export const WARDROBE_STAGES = [
  "Reading your closet...",
  "Mapping your colors...",
  "Checking your aesthetics...",
  "Finding gaps...",
  "Spotting weaknesses...",
  "Scoring your wardrobe...",
];

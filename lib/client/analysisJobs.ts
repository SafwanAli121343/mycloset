// Website client for purchased analyses — same behavior as native/lib/analysisJobs.ts (server:
// lib/analysisJobs.ts, /api/jobs). A job keeps running on the server if the tab is closed; the
// pages that start one check for running/finished jobs when they open.
export type JobInfo = {
  id: string;
  kind: "item" | "wardrobe" | "pro_backfill";
  targetId: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
};

export type JobsStatus = {
  jobs: JobInfo[];
  credits: { item: number; wardrobe: number; itemBalance: number; wardrobeBalance: number };
  wardrobe: { enoughPieces: boolean; report: "none" | "purchased" | "subscription"; canAdvance: boolean };
};

export class JobStartError extends Error {}

export async function fetchJobs(): Promise<JobsStatus> {
  const r = await fetch("/api/jobs", { cache: "no-store" });
  if (!r.ok) throw new Error(`jobs ${r.status}`);
  return r.json();
}

export async function startJob(kind: "item" | "wardrobe", garmentId?: string): Promise<JobInfo> {
  const r = await fetch("/api/jobs", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, garmentId }),
  }).catch(() => null);
  const body = await r?.json().catch(() => null);
  if (!r || !r.ok) throw new JobStartError(body?.error ?? "Couldn't start the analysis. Nothing was used — please try again.");
  return body.job as JobInfo;
}

export function ackJobs(ids: string[]): void {
  if (!ids.length) return;
  fetch("/api/jobs/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => {});
}

const GIVE_UP_MS = 11 * 60 * 1000; // the server declares a silent job dead after 10 minutes
const POLL_MS = 2000;

export async function waitForJob(id: string, isCancelled: () => boolean = () => false): Promise<JobInfo> {
  const start = Date.now();
  while (!isCancelled()) {
    await new Promise(r => setTimeout(r, POLL_MS));
    try {
      const s = await fetchJobs();
      const job = s.jobs.find(j => j.id === id);
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

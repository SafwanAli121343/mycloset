// GET  /api/billing/web/subscription → { active, cancelAtPeriodEnd, renewsAt } | { active: false }
// POST /api/billing/web/subscription { action: "cancel" | "resume" }
// The website subscription only (App Store / Play subscriptions are managed in the stores).
// Cancelling keeps Pro until the end of the period already paid for.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { stripe } from "@/lib/billing/stripe";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function currentSub(userId: string) {
  const s = stripe();
  if (!s) return null;
  const { data } = await sb.from("users").select("stripe_subscription_id").eq("id", userId).maybeSingle();
  const id = (data as { stripe_subscription_id?: string | null } | null)?.stripe_subscription_id;
  if (!id) return null;
  const sub = await s.subscriptions.retrieve(id).catch(() => null);
  return sub && ["active", "trialing", "past_due"].includes(sub.status) ? { s, sub } : null;
}

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cur = await currentSub(session.userId);
  if (!cur) return NextResponse.json({ active: false });
  const end = Math.max(...cur.sub.items.data.map(i => i.current_period_end ?? 0));
  return NextResponse.json({ active: true, cancelAtPeriodEnd: cur.sub.cancel_at_period_end, renewsAt: end ? new Date(end * 1000).toISOString() : null });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as { action?: string } | null;
  if (body?.action !== "cancel" && body?.action !== "resume") return NextResponse.json({ error: "Bad action" }, { status: 400 });
  const cur = await currentSub(session.userId);
  if (!cur) return NextResponse.json({ error: "No website subscription found." }, { status: 404 });
  await cur.s.subscriptions.update(cur.sub.id, { cancel_at_period_end: body.action === "cancel" });
  return NextResponse.json({ ok: true });
}

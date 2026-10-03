// GET  /api/user/tutorial → { pending: boolean }  — show the "Tutorial?" prompt?
// POST /api/user/tutorial                         — answered (yes or no): never prompt again.
// One flag per account (users.tutorial_pending, set on sign-up), so the prompt appears once
// whether the new user first opens the app or the website.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await sb.from("users").select("tutorial_pending").eq("id", session.userId).single();
  // Column missing (migration not run) or any error → no prompt, never a broken first screen.
  if (error) return NextResponse.json({ pending: false });
  return NextResponse.json({ pending: !!(data as { tutorial_pending?: boolean }).tutorial_pending });
}

export async function POST() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await sb.from("users").update({ tutorial_pending: false }).eq("id", session.userId).then(() => {}, () => {});
  return NextResponse.json({ ok: true });
}

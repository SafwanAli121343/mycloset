// GET  /api/user/profile → { age: number | null, gender: "male" | "female" | "unisex" | null }
// PATCH /api/user/profile  { age?: number | null, gender?: … | null } → { ok: true }
// The user's own profile details that tailor AI analysis (age + gender — see lib/userAge.ts).
// Each field is optional on PATCH, so saving one never touches the other.
import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { getUserProfile, setUserAge, setUserGender, getAiConsent, setAiConsent, MIN_AGE, MAX_AGE, type Gender } from "@/lib/userAge";

export async function GET() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [profile, aiConsent] = await Promise.all([getUserProfile(session.userId), getAiConsent(session.userId)]);
  return NextResponse.json({ ...profile, aiConsent });
}

export async function PATCH(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "user:profile", 30, 60 * 1000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null) as { age?: unknown; gender?: unknown; aiConsent?: unknown } | null;
  if (!body || (!("age" in body) && !("gender" in body) && !("aiConsent" in body))) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  if ("aiConsent" in body) {
    if (typeof body.aiConsent !== "boolean") return NextResponse.json({ error: "Invalid aiConsent." }, { status: 400 });
    const r = await setAiConsent(session.userId, body.aiConsent);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  if ("age" in body) {
    const raw = body.age;
    let age: number | null;
    if (raw === null || raw === "") age = null;
    else if (typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_AGE && raw <= MAX_AGE) age = raw;
    else return NextResponse.json({ error: `Age must be a whole number from ${MIN_AGE} to ${MAX_AGE}.` }, { status: 400 });
    const r = await setUserAge(session.userId, age);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }
  if ("gender" in body) {
    const g = body.gender;
    if (g !== null && g !== "male" && g !== "female" && g !== "unisex") return NextResponse.json({ error: "Invalid gender." }, { status: 400 });
    const r = await setUserGender(session.userId, g as Gender | null);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

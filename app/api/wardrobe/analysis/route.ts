import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { createClient } from "@supabase/supabase-js";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import type { WardrobeAnalysis, CrossedEntry } from "@/lib/wardrobeAnalysis";
import { aiErrorMessage } from "@/lib/aiGateway";
import { analyzeWardrobe, requireAi, GARMENT_FIELDS, type RawGarment } from "@/lib/wardrobeAnalyzer";

export const maxDuration = 60;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "wardrobe:analysis", 10, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ai = await requireAi(session.userId);
  if (!ai.allowed) {
    return NextResponse.json({ error: ai.errorMessage, locked: true }, { status: 402 });
  }

  let body: { priorAnalyses?: WardrobeAnalysis[]; crossed?: CrossedEntry[] } = {};
  try { body = await req.json(); } catch { /* ignore, treat as no context */ }

  const { data, error } = await sb
    .from("garments")
    .select(GARMENT_FIELDS)
    .eq("user_id", session.userId);
  if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });

  try {
    return NextResponse.json(await analyzeWardrobe(data as unknown as RawGarment[], body.priorAnalyses ?? [], body.crossed ?? [], ai.user!));
  } catch (err) {
    const msg = aiErrorMessage(err);
    if (msg) return NextResponse.json({ error: msg, locked: true }, { status: 402 });
    console.error("[wardrobe/analysis POST]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ai = await requireAi(session.userId);
  if (!ai.allowed) {
    return NextResponse.json({ error: ai.errorMessage, locked: true }, { status: 402 });
  }

  const sp       = req.nextUrl.searchParams;
  // Prompt-testing mode builds a wardrobe from OTHER users' garments — local development only,
  // never in production (it would expose other people's items to any Pro user).
  const testMode = sp.get("test") === "1" && process.env.NODE_ENV !== "production";
  const testN    = Math.min(parseInt(sp.get("n") ?? "20", 10), 60);

  let garments: RawGarment[];

  if (testMode) {
    // Random wardrobe from all available garments (for prompt testing)
    const { data, error } = await sb.from("garments").select(GARMENT_FIELDS);
    if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    garments = shuffled.slice(0, testN) as unknown as RawGarment[];
  } else {
    const { data, error } = await sb
      .from("garments")
      .select(GARMENT_FIELDS)
      .eq("user_id", session.userId);
    if (error || !data?.length) return NextResponse.json({ error: "No garments" }, { status: 404 });
    garments = data as unknown as RawGarment[];
  }

  try {
    return NextResponse.json(await analyzeWardrobe(garments, [], [], ai.user!));
  } catch (err) {
    console.error("[wardrobe/analysis GET]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}

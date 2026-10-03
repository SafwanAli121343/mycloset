import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { auditLog } from "@/lib/security/auditLog";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/user/export
// Returns all user data as JSON (GDPR right to data portability).
export async function GET(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "user:export", 5, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.userId;

  const [garmentsRes, outfitsRes] = await Promise.all([
    adminClient.from("garments").select("*").eq("user_id", userId).order("created_at", { ascending: true }),
    adminClient.from("outfits").select("*, outfit_items(*)").eq("user_id", userId).order("created_at", { ascending: true }),
  ]);

  auditLog("data_exported", userId, req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null);

  const payload = {
    exported_at: new Date().toISOString(),
    user: { id: userId, email: session.email },
    garments: garmentsRes.data ?? [],
    outfits: outfitsRes.data ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mycloset-export-${userId}.json"`,
    },
  });
}

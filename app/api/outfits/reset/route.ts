import { NextResponse } from "next/server";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/outfits/reset — wipes every outfit for the authenticated user.
// Used during the initial 3-month setup flow so the page starts fresh.
export async function DELETE(req: Request) {
  const rateBlock = applyApiRateLimit(req, "outfits:reset", 1000, 3600000);
  if (rateBlock) return rateBlock;
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: userOutfits } = await adminClient
    .from("outfits")
    .select("id")
    .eq("user_id", session.userId);

  if (userOutfits && userOutfits.length > 0) {
    const ids = userOutfits.map((o: { id: string }) => o.id);
    await adminClient.from("outfit_items").delete().in("outfit_id", ids);
    await adminClient.from("outfits").delete().eq("user_id", session.userId);
  }

  return NextResponse.json({ ok: true });
}

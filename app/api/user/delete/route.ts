import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies, clearSessionCookie, clearRefreshTokenCookie } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";
import { auditLog } from "@/lib/security/auditLog";
import { revokeAllRefreshTokens } from "@/lib/db/refreshTokens";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// DELETE /api/user/delete
// Hard-deletes the authenticated user's account and all associated data (GDPR right to erasure).
export async function DELETE(req: NextRequest) {
  const rateBlock = applyApiRateLimit(req, "user:delete", 3, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = session.userId;

  // Resolve all garment images before deleting rows so we can clean storage
  const { data: garments } = await adminClient
    .from("garments")
    .select("id, image")
    .eq("user_id", userId);

  // Delete in dependency order: outfit_items → outfits → garments → users
  await adminClient.from("wardrobe_analysis_state").delete().eq("user_id", userId);
  await adminClient.from("outfit_items").delete().in(
    "outfit_id",
    (await adminClient.from("outfits").select("id").eq("user_id", userId)).data?.map(r => r.id) ?? []
  );
  await adminClient.from("outfits").delete().eq("user_id", userId);
  await adminClient.from("garments").delete().eq("user_id", userId);
  await adminClient.from("users").delete().eq("id", userId);

  // Best-effort: remove garment images from storage
  const storagePaths = (garments ?? [])
    .map(g => {
      if (!g.image) return null;
      // Extract relative storage path from the public URL
      const match = g.image.match(/garment-images\/(.+)$/);
      return match ? match[1] : null;
    })
    .filter(Boolean) as string[];

  if (storagePaths.length) {
    await adminClient.storage.from("garment-images").remove(storagePaths).catch(() => {});
  }

  await revokeAllRefreshTokens(userId).catch(() => {});
  auditLog("account_deleted", userId, req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? null);
  await clearSessionCookie();
  await clearRefreshTokenCookie();

  return NextResponse.json({ deleted: true });
}

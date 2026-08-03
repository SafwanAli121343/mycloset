// POST /api/garments/fix-images
// Re-runs background removal for every garment image that still has a white/opaque
// background (regardless of whether it's on Supabase or a brand CDN). Items whose
// images already have significant transparency are skipped as already processed.
// Processes up to 50 garments per call; repeat until "remaining" reaches 0.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSessionFromCookies } from "@/lib/auth/session";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

export const maxDuration = 60;

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Returns the fraction of pixels that are transparent (alpha < 64).
async function transparencyRatio(buf: Buffer): Promise<number> {
  const { data: px } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] < 64) transparent++;
  }
  return transparent / (px.length / 4);
}

export async function POST() {
  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: garments, error } = await adminClient
    .from("garments")
    .select("id, image")
    .eq("user_id", session.userId)
    .not("image", "is", null)
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let processed = 0;
  let skipped = 0;
  const failed: string[] = [];
  let needsProcessing = 0;

  for (const g of garments ?? []) {
    try {
      const res = await fetch(g.image!, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const srcBuf = Buffer.from(await res.arrayBuffer());

      // Skip items that already have a properly transparent background.
      // >15% transparent pixels means bg-removal already ran successfully.
      const existingTransparency = await transparencyRatio(srcBuf);
      if (existingTransparency > 0.15) {
        skipped++;
        continue;
      }

      needsProcessing++;

      // Normalise to PNG (works for JPEG brand-CDN images and Supabase PNGs alike)
      const pngBuf = await sharp(srcBuf).png().toBuffer();

      let buffer: Buffer;
      try {
        const inputBlob = new Blob([new Uint8Array(pngBuf)], { type: "image/png" });
        const cleanBlob = await removeBackground(inputBlob, { model: "medium", output: { format: "image/png" } });
        const rawBuf = Buffer.from(await cleanBlob.arrayBuffer());

        // Snap intermediate alpha values
        const { data: px, info } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] < 25) px[i] = 0;
          else if (px[i] >= 35) px[i] = 255;
        }

        // Validate using total opacity (not a centre-crop) so items like glasses —
        // which have transparent lenses — still pass even though their centre is empty.
        // 5–90%: below 5% the model erased the garment; above 90% it removed nothing.
        let opaque = 0;
        for (let i = 3; i < px.length; i += 4) {
          if (px[i] > 128) opaque++;
        }
        const totalOpacityRatio = opaque / (px.length / 4);

        if (totalOpacityRatio >= 0.05 && totalOpacityRatio <= 0.90) {
          const { width: w, height: h } = info;
          buffer = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
        } else {
          buffer = await sharp(pngBuf).toBuffer();
        }
      } catch {
        buffer = await sharp(pngBuf).toBuffer();
      }

      await adminClient.storage.createBucket("garment-images", { public: true }).catch(() => {});
      const storagePath = `${session.userId}/${g.id}.png`;
      const { data: uploaded, error: uploadErr } = await adminClient.storage
        .from("garment-images")
        .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

      if (uploadErr || !uploaded) throw new Error("Upload failed: " + uploadErr?.message);

      const url = adminClient.storage.from("garment-images").getPublicUrl(uploaded.path).data.publicUrl;
      await adminClient.from("garments").update({ image: url }).eq("id", g.id);
      processed++;
    } catch (e) {
      failed.push(`${g.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    total: needsProcessing,
    processed,
    skipped,
    failed,
    remaining: needsProcessing - processed - failed.length,
  });
}

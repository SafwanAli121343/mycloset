#!/usr/bin/env node
// Reprocesses background removal for all garments belonging to a user.
// Downloads each garment's current image, runs AI bg removal with the
// quality fallback from the production route, then overwrites the file
// in Supabase Storage (same path → same public URL, no DB update needed).
//
// Run: npx tsx --env-file=.env.local scripts/remove-wardrobe-backgrounds.mts

import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212"; // Supabase UUID (migrated from Clerk ID)

// ── Fetch garments ────────────────────────────────────────────────────────────
const { data: garments, error: garmentErr } = await sb
  .from("garments")
  .select("id, title, brand, image, pattern")
  .eq("user_id", USER_ID);

if (garmentErr) { console.error("DB error:", garmentErr.message); process.exit(1); }
if (!garments?.length) { console.log("No garments found."); process.exit(0); }

console.log(`Found ${garments.length} garments for user ${USER_ID}. Processing...\n`);

let ok = 0, skipped = 0, failed = 0;

for (const g of garments) {
  const label = `${g.brand ?? "?"} — ${g.title ?? g.id}`;

  if (!g.image) {
    console.log(`  ⚪ SKIP  ${label} (no image)`);
    skipped++;
    continue;
  }

  // Skip novelty/photo-print items — model can't separate print from background
  const pat = (g.pattern as string | null) ?? "";
  if (["photo-print", "novelty-print", "all-over-graphic"].includes(pat)) {
    console.log(`  ⚪ SKIP  ${label} (novelty pattern)`);
    skipped++;
    continue;
  }

  try {
    // Get image as raw buffer.
    // Stored images are data: URLs; removeBackground's internal fetch can't handle
    // the data: protocol in plain Node.js — extract binary and pass as ArrayBuffer instead.
    let srcBuf: Buffer;
    if (g.image.startsWith("data:")) {
      const b64 = g.image.split(",")[1];
      srcBuf = Buffer.from(b64, "base64");
    } else {
      const srcRes = await fetch(g.image);
      if (!srcRes.ok) throw new Error(`fetch failed: ${srcRes.status}`);
      srcBuf = Buffer.from(await srcRes.arrayBuffer());
    }

    // Run AI background removal — pass as Blob so the library knows the MIME type
    const mime = g.image.startsWith("data:") ? (g.image.split(";")[0].split(":")[1] || "image/jpeg") : "image/jpeg";
    const imageBlob = new Blob([new Uint8Array(srcBuf)], { type: mime });
    const cleanBlob = await removeBackground(imageBlob, { model: "medium", output: { format: "image/png" } });
    const rawBuf = Buffer.from(await cleanBlob.arrayBuffer());

    // Snap alpha: near-transparent → fully transparent, near-opaque → fully opaque
    const { data: px, info } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 25)       px[i] = 0;
      else if (px[i] >= 35) px[i] = 255;
    }

    // Quality check: if the centre is <50% opaque, the model ate the garment — keep original
    const w = info.width, h = info.height;
    const x0 = Math.floor(w * 0.3), x1 = Math.floor(w * 0.7);
    const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.8);
    let opaque = 0, total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (px[(y * w + x) * 4 + 3] > 128) opaque++;
        total++;
      }
    }
    const centerOpacity = opaque / total;

    let buffer: Buffer;
    if (centerOpacity >= 0.50) {
      buffer = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    } else {
      // Model ate the item — keep original as PNG
      buffer = await sharp(srcBuf).png().toBuffer();
      console.log(`  ⚠️  KEPT  ${label} (model ate garment, opacity=${(centerOpacity * 100).toFixed(0)}%)`);
      skipped++;
      continue;
    }

    // Upload to same path (upsert overwrites the existing file)
    const storagePath = `${USER_ID}/${g.id}.png`;
    const { error: uploadErr } = await sb.storage
      .from("garment-images")
      .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

    if (uploadErr) throw new Error(`upload failed: ${uploadErr.message}`);

    // Update image URL in DB (path is the same but the URL is deterministic from the path)
    const cleanUrl = sb.storage.from("garment-images").getPublicUrl(storagePath).data.publicUrl;
    await sb.from("garments").update({ image: cleanUrl }).eq("id", g.id);

    console.log(`  ✔ DONE  ${label} (opacity=${(centerOpacity * 100).toFixed(0)}%)`);
    ok++;
  } catch (err) {
    console.log(`  ✘ FAIL  ${label}: ${(err as Error).message}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(55)}`);
console.log(`  Done: ${ok} processed  ${skipped} skipped  ${failed} failed`);

#!/usr/bin/env node
// Fixes garments that still have external (non-Supabase) image URLs.
// Downloads the external image, runs AI background removal, uploads to storage,
// and updates the garments table. Skips items already on Supabase storage.
//
// Run: npx tsx --env-file=.env.local scripts/fix-external-images.mts

import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
const SUPABASE_HOST = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;

const { data: garments, error } = await sb
  .from("garments")
  .select("id, title, brand, image, pattern")
  .eq("user_id", USER_ID);

if (error) { console.error("DB error:", error.message); process.exit(1); }

const external = (garments ?? []).filter(g => {
  if (!g.image) return false;
  if (g.image.startsWith("data:")) return false;
  try { return new URL(g.image).hostname !== SUPABASE_HOST; }
  catch { return false; }
});

console.log(`Found ${external.length} garment(s) with external image URLs:\n`);
for (const g of external) console.log(`  ${g.brand} — ${g.title}`);
console.log();

if (!external.length) { console.log("Nothing to fix."); process.exit(0); }

let ok = 0, skipped = 0, failed = 0;

for (const g of external) {
  const label = `${g.brand ?? "?"} — ${g.title ?? g.id}`;

  const pat = (g.pattern as string | null) ?? "";
  if (["photo-print", "novelty-print", "all-over-graphic"].includes(pat)) {
    console.log(`  ⚪ SKIP  ${label} (novelty pattern)`);
    skipped++;
    continue;
  }

  try {
    console.log(`  ⏳ Fetching  ${label}  ...`);
    const res = await fetch(g.image, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    const srcBuf = Buffer.from(await res.arrayBuffer());
    const imageBlob = new Blob([srcBuf], { type: mime });

    console.log(`  🎨 Removing background  ...`);
    const cleanBlob = await removeBackground(imageBlob, { model: "medium", output: { format: "image/png" } });
    const rawBuf = Buffer.from(await cleanBlob.arrayBuffer());

    // Alpha snap
    const { data: px, info } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 25) px[i] = 0;
      else if (px[i] >= 35) px[i] = 255;
    }

    // Centre-opacity quality check
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
    const opacity = opaque / total;

    let buffer: Buffer;
    if (opacity >= 0.35) {
      buffer = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
      console.log(`     Background removed (opacity=${(opacity * 100).toFixed(0)}%)`);
    } else {
      // Model ate the garment — use original image as PNG
      buffer = await sharp(srcBuf).png().toBuffer();
      console.log(`  ⚠️  Kept original (model ate garment, opacity=${(opacity * 100).toFixed(0)}%)`);
    }

    const storagePath = `${USER_ID}/${g.id}.png`;
    const { error: uploadErr } = await sb.storage
      .from("garment-images")
      .upload(storagePath, buffer, { contentType: "image/png", upsert: true });
    if (uploadErr) throw new Error(`upload: ${uploadErr.message}`);

    const cleanUrl = sb.storage.from("garment-images").getPublicUrl(storagePath).data.publicUrl;
    const { error: dbErr } = await sb.from("garments").update({ image: cleanUrl }).eq("id", g.id);
    if (dbErr) throw new Error(`db update: ${dbErr.message}`);

    console.log(`  ✔ DONE  ${label}`);
    ok++;
  } catch (err) {
    console.log(`  ✘ FAIL  ${label}: ${(err as Error).message}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(55)}`);
console.log(`  Done: ${ok} fixed  ${skipped} skipped  ${failed} failed`);

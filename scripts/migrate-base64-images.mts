#!/usr/bin/env node
// Migrates garments that still have base64 data URIs in the `image` column to
// Supabase Storage. After this runs, every garment's image will be a public URL
// and the DB column will no longer hold raw image data.
//
// Run: npx tsx --env-file=.env.local scripts/migrate-base64-images.mts

import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const BUCKET = "garment-images";

// Ensure bucket exists and is public
await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});

const { data: garments, error } = await sb
  .from("garments")
  .select("id, user_id, title, brand, image")
  .like("image", "data:%");

if (error) { console.error("DB error:", error.message); process.exit(1); }

const rows = garments ?? [];
console.log(`Found ${rows.length} garment(s) with base64 images to migrate.\n`);
if (!rows.length) { console.log("Nothing to migrate."); process.exit(0); }

let ok = 0, failed = 0;

for (const g of rows) {
  const label = `${g.brand ?? "?"} — ${g.title ?? g.id}`;

  try {
    // Parse the data URI: data:<mime>;base64,<data>
    const dataUri = g.image as string;
    const semi = dataUri.indexOf(";base64,");
    if (!dataUri.startsWith("data:") || semi === -1) throw new Error("Unrecognised data URI format");
    const mime = dataUri.slice(5, semi);
    const b64  = dataUri.slice(semi + 8);
    const buffer = Buffer.from(b64, "base64");
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const storagePath = `${g.user_id}/${g.id}.${ext}`;

    const { error: uploadErr } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, buffer, { contentType: mime, upsert: true });
    if (uploadErr) throw new Error(`upload: ${uploadErr.message}`);

    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;

    const { error: dbErr } = await sb
      .from("garments")
      .update({ image: publicUrl })
      .eq("id", g.id);
    if (dbErr) throw new Error(`db update: ${dbErr.message}`);

    console.log(`  ✔  ${label}`);
    ok++;
  } catch (err) {
    console.log(`  ✘  ${label}: ${(err as Error).message}`);
    failed++;
  }
}

console.log(`\n${"─".repeat(55)}`);
console.log(`  Done: ${ok} migrated  ${failed} failed`);

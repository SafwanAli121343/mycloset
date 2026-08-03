#!/usr/bin/env node
// Re-runs background removal (large model) on a garment without requiring re-upload.
// Searches by title keyword, downloads the stored image, strips the background,
// re-uploads, and patches the garment record.
//
// Run: npx tsx --env-file=.env.local scripts/reprocess-bg.mts <keyword>
// Example: npx tsx --env-file=.env.local scripts/reprocess-bg.mts birkenstock

import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";
const keyword = process.argv[2]?.toLowerCase();
if (!keyword) { console.error("Usage: reprocess-bg.mts <keyword>"); process.exit(1); }

const { data: garments, error } = await sb
  .from("garments")
  .select("id, title, brand, image")
  .eq("user_id", USER_ID)
  .ilike("title", `%${keyword}%`);

if (error) { console.error("DB error:", error.message); process.exit(1); }
if (!garments?.length) { console.log(`No garments matching "${keyword}".`); process.exit(0); }

console.log(`Found ${garments.length} garment(s):`);
for (const g of garments) console.log(`  ${g.id.slice(0, 8)}  ${g.brand ?? ""} ${g.title}  ${g.image ? "has image" : "NO IMAGE"}`);

for (const g of garments) {
  if (!g.image) { console.log(`\nSkipping ${g.title} — no image URL`); continue; }

  process.stdout.write(`\nProcessing ${g.brand ?? ""} ${g.title} … `);

  // Download current image
  const res = await fetch(g.image);
  if (!res.ok) { console.log(`✘ fetch failed: ${res.status}`); continue; }
  const srcBuf = Buffer.from(await res.arrayBuffer());
  const mime   = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";

  // Flatten onto a pure white background so the model has a neutral high-contrast canvas.
  // White avoids colour bleed (magenta/green tinge) at the edges of tan/suede items.
  const meta  = await sharp(srcBuf).metadata();
  const w     = meta.width  ?? 800;
  const h     = meta.height ?? 800;
  const whiteBg = await sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .jpeg({ quality: 92 }).toBuffer();
  const flatBuf   = await sharp(whiteBg).composite([{ input: srcBuf, blend: "over" }]).jpeg({ quality: 92 }).toBuffer();
  const inputBlob = new Blob([new Uint8Array(flatBuf)], { type: "image/jpeg" });

  let outputPng: Buffer;
  try {
    const cleanBlob = await removeBackground(inputBlob, { model: "medium", output: { format: "image/png" } });
    const rawBuf    = Buffer.from(await cleanBlob.arrayBuffer());

    // Hard midpoint alpha snap: anything below 50% opacity → fully transparent, above → fully opaque.
    const { data: px, info } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < px.length; i += 4) {
      px[i] = px[i] < 128 ? 0 : 255;
    }

    // Connected-component cleanup: keep only the largest contiguous opaque region.
    // Isolated background patches (wood grain, shadows) that the model mis-classified
    // as foreground are disconnected from the main subject and get zeroed out here.
    const W = info.width, H = info.height, TOTAL = W * H;
    const visited = new Uint8Array(TOTAL);
    let largestComp: number[] = [];
    for (let start = 0; start < TOTAL; start++) {
      if (visited[start] || px[start * 4 + 3] === 0) continue;
      // BFS using head pointer (O(n), avoids Array.shift cost)
      const comp: number[] = [];
      const q: number[] = [start];
      let head = 0;
      visited[start] = 1;
      while (head < q.length) {
        const p = q[head++];
        comp.push(p);
        const x = p % W, y = Math.floor(p / W);
        const ns = [y > 0 ? p - W : -1, y < H-1 ? p + W : -1, x > 0 ? p-1 : -1, x < W-1 ? p+1 : -1];
        for (const n of ns) {
          if (n >= 0 && !visited[n] && px[n * 4 + 3] > 0) { visited[n] = 1; q.push(n); }
        }
      }
      if (comp.length > largestComp.length) largestComp = comp;
    }
    const keepSet = new Set(largestComp);
    for (let i = 0; i < TOTAL; i++) {
      if (px[i * 4 + 3] > 0 && !keepSet.has(i)) px[i * 4 + 3] = 0;
    }

    // Safety check: if the centre became transparent the model ate the subject — abort
    const cx = Math.floor(W / 2), cy = Math.floor(H / 2);
    const r  = Math.floor(Math.min(W, H) * 0.15);
    let opaque = 0, total = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const row = cy + dy, col = cx + dx;
      if (row < 0 || row >= H || col < 0 || col >= W) continue;
      total++;
      if (px[(row * W + col) * 4 + 3] > 127) opaque++;
    }
    if (total > 0 && opaque / total < 0.1) {
      console.log("✘ model removed the subject — aborting");
      continue;
    }

    outputPng = await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  } catch (err) {
    console.log(`✘ bg removal error: ${(err as Error).message}`);
    continue;
  }

  // Upload new image
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
  const { data: uploaded, error: upErr } = await sb.storage
    .from("garment-images")
    .upload(path, outputPng, { contentType: "image/png" });

  if (upErr || !uploaded) { console.log(`✘ upload failed: ${upErr?.message}`); continue; }

  const newUrl = sb.storage.from("garment-images").getPublicUrl(uploaded.path).data.publicUrl;

  // Patch garment record
  const { error: patchErr } = await sb.from("garments").update({ image: newUrl }).eq("id", g.id);
  if (patchErr) { console.log(`✘ DB patch failed: ${patchErr.message}`); continue; }

  console.log(`✓  new URL: ${newUrl}`);
}

console.log("\nDone.");

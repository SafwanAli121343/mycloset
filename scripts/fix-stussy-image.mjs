// Repairs the Stussy DSM Los Angeles Hood image.
// Strategy: download clean product image from DSM CDN, try AI removal, fall back to BFS.
//
// Usage: node scripts/fix-stussy-image.mjs

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const SUPABASE_URL = "https://jhnwystsohdgzuvqnouy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impobnd5c3Rzb2hkZ3p1dnFub3V5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTYwMTE5NiwiZXhwIjoyMDkxMTc3MTk2fQ.2ehQaVyAroIJ6zMw7dGGmXGwa7-dwXV3Xg0aFes2t3g";
const GARMENT_ID  = "7f0051e7-140a-4b1b-ac79-d209344a604d";
const USER_ID     = "dd03be59-8301-4f91-9bda-533f26650212";

// Clean product image from Dover Street Market CDN
const DSM_IMAGE_URL = "https://shop-us.doverstreetmarket.com/cdn/shop/files/3973817_ASHH_1_1.jpg?v=1733253956&width=2000";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// BFS flood-fill background removal with proper bounds checking.
async function floodFillRemoveBg(srcBuf, tolerance = 38, feather = 12) {
  const { data: px, info } = await sharp(srcBuf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h } = info;

  // Background color = average of edge samples
  const edgeSamples = [
    [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)],
    [3, 3], [w - 4, 3], [3, h - 4], [w - 4, h - 4],
  ];
  let tr = 0, tg = 0, tb = 0, count = 0;
  for (const [x, y] of edgeSamples) {
    const off = (y * w + x) * 4;
    if (px[off + 3] > 200) { tr += px[off]; tg += px[off + 1]; tb += px[off + 2]; count++; }
  }
  if (count === 0) { console.log("All edges transparent — skipping fill"); return srcBuf; }
  const bgR = tr / count, bgG = tg / count, bgB = tb / count;
  console.log(`  BFS background color: rgb(${Math.round(bgR)}, ${Math.round(bgG)}, ${Math.round(bgB)})`);

  const visited = new Uint8Array(w * h);
  const qx = new Int16Array(w * h);
  const qy = new Int16Array(w * h);
  let qHead = 0, qTail = 0;

  function enqueue(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    const idx = y * w + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    qx[qTail] = x; qy[qTail] = y; qTail++;
  }

  for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { enqueue(0, y); enqueue(w - 1, y); }

  const DX = [-1, 1, 0, 0];
  const DY = [0, 0, -1, 1];

  while (qHead < qTail) {
    const x = qx[qHead], y = qy[qHead]; qHead++;
    const off = (y * w + x) * 4;
    const r = px[off], g = px[off + 1], b = px[off + 2], a = px[off + 3];

    if (a < 30) {
      for (let d = 0; d < 4; d++) enqueue(x + DX[d], y + DY[d]);
      continue;
    }

    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    if (dist > tolerance) continue;

    if (dist <= tolerance - feather) {
      px[off + 3] = 0;
    } else {
      const t = (dist - (tolerance - feather)) / feather;
      px[off + 3] = Math.round(t * a);
    }

    for (let d = 0; d < 4; d++) enqueue(x + DX[d], y + DY[d]);
  }

  return sharp(Buffer.from(px), { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

// Check what fraction of center pixels are opaque — used to detect if removal ate the item.
async function centerOpacity(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Middle 40% of image
  const x0 = Math.floor(w * 0.3), x1 = Math.floor(w * 0.7);
  const y0 = Math.floor(h * 0.2), y1 = Math.floor(h * 0.8);
  let opaque = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 128) opaque++;
      total++;
    }
  }
  return opaque / total;
}

async function main() {
  console.log("Downloading clean product image from DSM CDN...");
  const res = await fetch(DSM_IMAGE_URL);
  if (!res.ok) { console.error("Download failed:", res.status); process.exit(1); }
  const rawBuf = Buffer.from(await res.arrayBuffer());
  console.log(`  Downloaded ${rawBuf.length} bytes`);

  // Resize to 1000px wide for processing (keeps aspect ratio, still high quality for display)
  console.log("Resizing to 1000px...");
  const resizedBuf = await sharp(rawBuf)
    .resize(1000, null, { fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 95 })
    .toBuffer();

  // Try @imgly AI background removal first
  let cleanBuf = null;
  try {
    console.log("Attempting AI background removal (@imgly)...");
    const { removeBackground } = await import("@imgly/background-removal-node");
    const blob = new Blob([resizedBuf], { type: "image/jpeg" });
    const resultBlob = await removeBackground(blob, {
      model: "isnet",
      output: { format: "image/png", quality: 1.0 },
    });
    const aiResult = Buffer.from(await resultBlob.arrayBuffer());

    const opacity = await centerOpacity(aiResult);
    console.log(`  AI center opacity: ${(opacity * 100).toFixed(1)}%`);

    if (opacity > 0.65) {
      console.log("  AI removal looks good — using it.");
      cleanBuf = aiResult;
    } else {
      console.log("  AI removal ate too much of the item — falling back to BFS.");
    }
  } catch (err) {
    console.log("  AI removal failed:", err.message?.slice(0, 80));
    console.log("  Falling back to BFS.");
  }

  // BFS fallback
  if (!cleanBuf) {
    console.log("Running BFS flood-fill (tolerance=38, feather=12)...");
    cleanBuf = await floodFillRemoveBg(resizedBuf, 38, 12);
    const opacity = await centerOpacity(cleanBuf);
    console.log(`  BFS center opacity: ${(opacity * 100).toFixed(1)}%`);

    if (opacity < 0.5) {
      // Both methods failed — just do a tight center crop, keep background
      console.log("  BFS also ate the item. Falling back to tight crop (keeping background).");
      cleanBuf = await sharp(resizedBuf)
        .resize(800, 800, { fit: "contain", background: { r: 245, g: 245, b: 245, alpha: 1 } })
        .png()
        .toBuffer();
    }
  }

  // Upload to Supabase Storage
  console.log("Uploading...");
  const storagePath = `${USER_ID}/${GARMENT_ID}.png`;
  const { error: uploadErr } = await sb.storage
    .from("garment-images")
    .update(storagePath, cleanBuf, { contentType: "image/png", upsert: true });
  if (uploadErr) { console.error("Upload failed:", uploadErr); process.exit(1); }

  const { data: { publicUrl } } = sb.storage.from("garment-images").getPublicUrl(storagePath);
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;
  await sb.from("garments").update({ image: versionedUrl }).eq("id", GARMENT_ID);

  console.log("Done. Stussy hoodie image repaired.");
  console.log("New URL:", versionedUrl);
}

main().catch(console.error);

import { createClient } from "@supabase/supabase-js";
import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USER_ID = "dd03be59-8301-4f91-9bda-533f26650212";

const { data } = await sb.from("garments").select("id,brand,title,image")
  .eq("user_id", USER_ID).ilike("brand", "%Birkenstock%");

for (const g of (data ?? []) as { id: string; brand: string; title: string; image: string }[]) {
  console.log(`⏳ ${g.brand} — ${g.title}`);
  const srcRes = await fetch(g.image, { signal: AbortSignal.timeout(15000) });
  if (!srcRes.ok) { console.log("  ✘ fetch failed"); continue; }
  const srcBuf = Buffer.from(await srcRes.arrayBuffer());

  // Try both models; pick whichever gives better shoe coverage.
  async function tryModel(model: "small" | "medium"): Promise<{ buf: Buffer; opacity: number }> {
    const blob = new Blob([new Uint8Array(srcBuf)], { type: "image/jpeg" });
    const clean = await removeBackground(blob, { model, output: { format: "image/png" } });
    const raw = Buffer.from(await clean.arrayBuffer());

    const { data: px, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;

    // ── Pass 1: aggressive alpha threshold ──────────────────────────────
    // Raise to >= 60 (was 35) so borderline edge pixels near a similar-colored
    // background are cut rather than rounded up to fully opaque.
    for (let i = 3; i < px.length; i += 4) {
      if (px[i] < 30)  px[i] = 0;
      else if (px[i] >= 60) px[i] = 255;
      // 30-59 range: keep as-is (smooth edges near clear subject boundaries)
    }

    // ── Pass 2: isolated-pixel erosion ──────────────────────────────────
    // Remove any opaque pixel that has ≤ 1 opaque 4-directional neighbor.
    // This eliminates the white-splatter artifact blobs that appear when the
    // BG model partially includes background patches near the shoe edges.
    const copy = new Uint8Array(px);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4 + 3;
        if (copy[idx] === 0) continue;
        const n = (copy[((y-1)*w+x)*4+3] > 0 ? 1 : 0)
                + (copy[((y+1)*w+x)*4+3] > 0 ? 1 : 0)
                + (copy[(y*w+(x-1))*4+3] > 0 ? 1 : 0)
                + (copy[(y*w+(x+1))*4+3] > 0 ? 1 : 0);
        if (n <= 1) px[idx] = 0;
      }
    }

    // ── Pass 3: second erosion sweep (removes newly-exposed isolated pixels) ─
    const copy2 = new Uint8Array(px);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4 + 3;
        if (copy2[idx] === 0) continue;
        const n = (copy2[((y-1)*w+x)*4+3] > 0 ? 1 : 0)
                + (copy2[((y+1)*w+x)*4+3] > 0 ? 1 : 0)
                + (copy2[(y*w+(x-1))*4+3] > 0 ? 1 : 0)
                + (copy2[(y*w+(x+1))*4+3] > 0 ? 1 : 0);
        if (n <= 1) px[idx] = 0;
      }
    }

    // Measure coverage in the bottom-center region (where shoes typically sit)
    const rx0 = Math.floor(w * 0.2), rx1 = Math.floor(w * 0.8);
    const ry0 = Math.floor(h * 0.3), ry1 = Math.floor(h * 0.95);
    let op = 0, tot = 0;
    for (let y = ry0; y < ry1; y++) for (let x = rx0; x < rx1; x++) {
      if (px[(y * w + x) * 4 + 3] > 128) op++;
      tot++;
    }
    const opacity = tot > 0 ? op / tot : 0;

    const outBuf = await sharp(
      Buffer.from(px.buffer), { raw: { width: w, height: h, channels: 4 } }
    ).png().toBuffer();

    return { buf: outBuf, opacity };
  }

  console.log("  Running small model...");
  const small = await tryModel("small");
  console.log(`  small  opacity: ${(small.opacity * 100).toFixed(0)}%`);

  console.log("  Running medium model...");
  const medium = await tryModel("medium");
  console.log(`  medium opacity: ${(medium.opacity * 100).toFixed(0)}%`);

  // Pick model with better coverage; fall back to original if both are terrible.
  const best = medium.opacity >= small.opacity ? medium : small;
  const bestName = medium.opacity >= small.opacity ? "medium" : "small";

  let finalBuf: Buffer;
  if (best.opacity >= 0.18) {
    finalBuf = best.buf;
    console.log(`  ✔ using ${bestName} model (${(best.opacity * 100).toFixed(0)}% coverage)`);
  } else {
    finalBuf = await sharp(srcBuf).png().toBuffer();
    console.log(`  ⚠ both models too sparse — kept original`);
  }

  const path = `${USER_ID}/${g.id}.png`;
  await sb.storage.from("garment-images").upload(path, finalBuf, { contentType: "image/png", upsert: true });
  const url = sb.storage.from("garment-images").getPublicUrl(path).data.publicUrl;
  await sb.from("garments").update({ image: url }).eq("id", g.id);
  console.log(`  ✔ DONE\n`);
}

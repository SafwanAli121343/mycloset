import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  const arrayBuffer = await file.arrayBuffer();
  const srcBuf = Buffer.from(arrayBuffer);

  let buffer: Buffer;
  try {
    // Convert to JPEG first so the bg-removal model works with any input format (AVIF, HEIC, etc.)
    const jpegBuf   = await sharp(srcBuf).jpeg({ quality: 90 }).toBuffer();
    const inputBlob = new Blob([new Uint8Array(jpegBuf)], { type: "image/jpeg" });
    const cleanBlob = await removeBackground(inputBlob, { model: "medium", output: { format: "image/png" } });
    const rawBuf = Buffer.from(await cleanBlob.arrayBuffer());

    // Snap intermediate alpha values: near-transparent → fully transparent, near-opaque → fully opaque
    const { data: rpx, info: rinfo } = await sharp(rawBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 3; i < rpx.length; i += 4) {
      if (rpx[i] < 25) rpx[i] = 0;
      else if (rpx[i] >= 35) rpx[i] = 255;
    }

    // Safety check: if centre of result is <40% opaque the model ate the garment — fall back to original
    const cx = Math.floor(rinfo.width / 2);
    const cy = Math.floor(rinfo.height / 2);
    const checkRadius = Math.floor(Math.min(rinfo.width, rinfo.height) * 0.15);
    let opaquePixels = 0, totalPixels = 0;
    for (let dy = -checkRadius; dy <= checkRadius; dy++) {
      for (let dx = -checkRadius; dx <= checkRadius; dx++) {
        const px = cy + dy, py = cx + dx;
        if (px < 0 || px >= rinfo.height || py < 0 || py >= rinfo.width) continue;
        totalPixels++;
        if (rpx[(px * rinfo.width + py) * 4 + 3] > 127) opaquePixels++;
      }
    }
    const centerOpacity = totalPixels > 0 ? opaquePixels / totalPixels : 0;

    if (centerOpacity < 0.4) {
      // Model removed the garment itself — keep original as PNG
      buffer = await sharp(srcBuf).png().toBuffer();
    } else {
      buffer = await sharp(rpx, { raw: { width: rinfo.width, height: rinfo.height, channels: 4 } }).png().toBuffer();
    }
  } catch {
    // On any removal error keep the original
    buffer = await sharp(srcBuf).png().toBuffer();
  }

  await adminClient.storage.createBucket("garment-images", { public: true }).catch(() => {});
  const path = `uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
  const { data: uploaded, error } = await adminClient.storage
    .from("garment-images")
    .upload(path, buffer, { contentType: "image/png" });

  if (error || !uploaded) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const url = adminClient.storage.from("garment-images").getPublicUrl(uploaded.path).data.publicUrl;
  return NextResponse.json({ url });
}

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { removeBackground } from "@imgly/background-removal-node";
import { getSessionFromCookies } from "@/lib/auth/session";
import { applyApiRateLimit } from "@/lib/security/rateLimit";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 10 MB hard cap on uploads
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Background removal + storage upload — require auth and limit to 30/hour per IP
  const rateBlock = applyApiRateLimit(req, "upload-image", 30, 60 * 60 * 1000);
  if (rateBlock) return rateBlock;

  const session = await getSessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  // @types/node's undici-derived FormData type and the DOM lib's FormData type disagree on
  // this method's shape depending on lib/tsconfig resolution order — same class of collision as
  // the `outfit_items` casts elsewhere in this codebase (see app/api/outfits/route.ts), worked
  // around the same way rather than fighting the global type declarations.
  const file = (formData as unknown as { get(key: string): File | null }).get("file");
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });

  // Reject oversized uploads before reading the bytes
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum 10 MB." }, { status: 413 });
  }

  // Accept only image MIME types
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are accepted." }, { status: 415 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const srcBuf = Buffer.from(arrayBuffer);

  // Verify actual image format by magic bytes — rejects any file spoofing its Content-Type
  const h = srcBuf.slice(0, 12);
  const isJPEG = h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF;
  const isPNG  = h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47;
  const isWebP = h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46
              && h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50;
  if (!isJPEG && !isPNG && !isWebP) {
    return NextResponse.json({ error: "Invalid image. Only JPEG, PNG, and WebP are accepted." }, { status: 415 });
  }

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
  // Scope path to the authenticated user — prevents cross-user path collisions and makes
  // it possible to enumerate/delete a user's own uploads at the storage level.
  const path = `${session.userId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
  const { data: uploaded, error } = await adminClient.storage
    .from("garment-images")
    .upload(path, buffer, { contentType: "image/png" });

  if (error || !uploaded) return NextResponse.json({ error: "Upload failed" }, { status: 500 });

  const url = adminClient.storage.from("garment-images").getPublicUrl(uploaded.path).data.publicUrl;
  return NextResponse.json({ url });
}

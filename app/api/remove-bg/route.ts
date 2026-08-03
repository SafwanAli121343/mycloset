import { removeBackground } from "@imgly/background-removal-node";
import sharp from "sharp";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { url } = await req.json();
  if (!url || typeof url !== "string") {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  try {
    let inputBlob: Blob;
    if (url.startsWith("data:")) {
      const [header, b64] = url.split(",");
      const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
      const raw  = Buffer.from(b64, "base64");
      // Convert to JPEG — AVIF and other exotic formats can't be passed directly
      const jpegBuf = await sharp(raw).jpeg({ quality: 90 }).toBuffer();
      inputBlob = new Blob([new Uint8Array(jpegBuf)], { type: "image/jpeg" });
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`fetch: ${res.status}`);
      const buf  = await res.arrayBuffer();
      const mime = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
      inputBlob  = new Blob([buf], { type: mime });
    }

    const blob   = await removeBackground(inputBlob, { model: "medium", output: { format: "image/png" as const } });
    const buffer = Buffer.from(await blob.arrayBuffer());
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=604800",
      },
    });
  } catch {
    return Response.json({ error: "Background removal failed" }, { status: 500 });
  }
}
